import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import type { Machines } from './machines.ts';
import { distroInfo } from './images.ts';
import { readStore, writeStore } from './local-store.ts';

const policySchema = z.object({
  enabled: z.boolean(),
  minMiB: z.number().int().min(256).max(8192),
}).strict();
type Policy = z.infer<typeof policySchema>;
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('sample') }).strict(),
]);
export { requestSchema as memoryReclaimRequest };
type Sample = { totalMiB: number; availableMiB: number };
type Observation = { at: string; totalMiB: number; availableMiB: number;
  targetMiB: number; decision: 'shrink' | 'restore' | 'hold' | 'disabled';
  reason: string; error?: string };

export function parseGuestMemory(output: string): Sample {
  const values = Object.fromEntries([...output.matchAll(/^(MemTotal|MemAvailable):\s+(\d+) kB$/gm)]
    .map((entry) => [entry[1], Number(entry[2])]));
  const totalMiB = Math.floor(values.MemTotal / 1024);
  const availableMiB = Math.floor(values.MemAvailable / 1024);
  if (!Number.isFinite(totalMiB) || !Number.isFinite(availableMiB) || totalMiB < 128 ||
    availableMiB < 0 || availableMiB > totalMiB)
    throw new AppError('客户机内存压力数据无效', 502);
  return { totalMiB, availableMiB };
}

export function reclaimDecision(currentMiB: number, maxMiB: number, minMiB: number,
  sample: Sample, highSamples: number) {
  if (currentMiB < minMiB)
    return { targetMiB: minMiB, decision: 'restore' as const,
      reason: '当前目标低于策略或发行版最低内存要求' };
  const availablePercent = sample.availableMiB / sample.totalMiB;
  if (availablePercent <= 0.2 && currentMiB < maxMiB)
    return { targetMiB: Math.min(maxMiB, currentMiB + 128),
      decision: 'restore' as const, reason: '客户机可用内存低于 20%，恢复 128 MiB' };
  if (availablePercent >= 0.55 && highSamples >= 3 && currentMiB > minMiB) {
    const usedMiB = sample.totalMiB - sample.availableMiB;
    const safeFloor = usedMiB + Math.max(128, Math.ceil(currentMiB * 0.25));
    const targetMiB = Math.max(minMiB, safeFloor, currentMiB - 64);
    if (targetMiB < currentMiB)
      return { targetMiB, decision: 'shrink' as const,
        reason: '客户机连续三次可用内存超过 55%，回收至多 64 MiB' };
  }
  return { targetMiB: currentMiB, decision: 'hold' as const,
    reason: availablePercent >= 0.55 ? '等待连续三次高可用内存采样' : '内存压力处于保持区间' };
}

export class MemoryReclaim {
  private policies: Record<string, Policy> = {};
  private observations = new Map<string, Observation>();
  private highSamples = new Map<string, number>();
  private lastAdjustment = new Map<string, number>();
  private active = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private tick?: Promise<void>;
  private closed = false;
  private writes = Promise.resolve();
  constructor(private machines: Machines,
    private reader: (id: string) => Promise<Sample> = async (id) => {
      const result = await machines.exec(id,
        "grep -E '^(MemTotal|MemAvailable):' /proc/meminfo", 10_000);
      if (result.code !== 0) throw new AppError(result.stderr || '客户机内存采样失败', 502);
      return parseGuestMemory(result.stdout);
    },
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private clock: () => number = () => Date.now(),
  ) {}
  async init() {
    const saved = await readStore(join(DATA, 'memory-reclaim.json'), () => ({}));
    this.policies = z.record(z.uuid(), policySchema).parse(saved);
    this.timer = setInterval(() => {
      if (!this.tick && !this.closed) this.tick = this.sampleAll().finally(() => { this.tick = undefined; });
    }, 15_000);
    this.timer.unref();
  }
  async view(id: string) {
    const vm = this.machines.get(id);
    const current = await this.machines.view(id);
    return { policy: this.policies[id] || { enabled: false, minMiB: 256 },
      effectiveMinMiB: Math.max(this.policies[id]?.minMiB || 256,
        distroInfo(vm.distro, vm.architecture).minimumMemory),
      currentTargetMiB: current.memoryTargetMiB || vm.memoryMiB,
      observation: this.observations.get(id) || null };
  }
  async action(id: string, raw: unknown) {
    const input = requestSchema.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    if (input.operation === 'sample') {
      await this.sample(id);
      return this.view(id);
    }
    const vm = this.machines.get(id);
    if (input.policy.enabled && vm.hardware?.devices?.balloon === false)
      throw new AppError('此实例关闭了 Virtio 内存气球设备', 409);
    if (input.policy.minMiB > vm.memoryMiB)
      throw new AppError('最小目标不能超过实例配置内存', 409);
    this.mutation(1);
    try {
      const operation = this.writes.catch(() => {}).then(async () => {
        const next = { ...this.policies, [id]: input.policy };
        await writeStore(join(DATA, 'memory-reclaim.json'), next);
        this.policies = next;
      });
      this.writes = operation;
      await operation;
      this.highSamples.delete(id);
      return this.view(id);
    } finally { this.mutation(-1); }
  }
  async sample(id: string) {
    if (this.active.has(id)) return;
    this.active.add(id);
    try {
      const vm = this.machines.get(id);
      if (this.machines.state(id) !== 'running') {
        this.highSamples.delete(id);
        return;
      }
      const sample = await this.reader(id);
      const current = this.machines.live.get(id)?.memoryTargetMiB || vm.memoryMiB;
      const policy = this.policies[id];
      const minimum = Math.max(policy?.minMiB || 256,
        distroInfo(vm.distro, vm.architecture).minimumMemory);
      const high = sample.availableMiB / sample.totalMiB >= 0.55
        ? (this.highSamples.get(id) || 0) + 1 : 0;
      this.highSamples.set(id, high);
      const planned = reclaimDecision(current, vm.memoryMiB, minimum, sample, high);
      const enabled = !!policy?.enabled && !this.blocked() &&
        vm.hardware?.devices?.balloon !== false;
      const cooldown = current >= minimum &&
        this.clock() - (this.lastAdjustment.get(id) || 0) < 60_000;
      const decision = enabled && !cooldown ? planned.decision : 'disabled';
      const reason = !enabled ? '自动回收未启用或暂不可用' :
        cooldown ? '内存调整后冷却 60 秒' : planned.reason;
      let targetMiB = current;
      if (decision === 'shrink' || decision === 'restore') {
        const updated = await this.machines.setMemoryTarget(id, planned.targetMiB);
        targetMiB = updated.memoryTargetMiB || planned.targetMiB;
        this.lastAdjustment.set(id, this.clock());
        this.highSamples.set(id, 0);
      }
      this.observations.set(id, { at: new Date().toISOString(), ...sample,
        targetMiB, decision, reason });
    } catch (error) {
      const prior = this.observations.get(id);
      this.observations.set(id, { at: new Date().toISOString(), totalMiB: prior?.totalMiB || 0,
        availableMiB: prior?.availableMiB || 0, targetMiB: prior?.targetMiB || 0,
        decision: 'hold', reason: '采样或气球调整失败', error: String((error as Error).message || error) });
      throw error;
    } finally { this.active.delete(id); }
  }
  private async sampleAll() {
    if (this.blocked()) return;
    for (const id of Object.keys(this.policies)) {
      if (this.closed) break;
      if (!this.policies[id].enabled || !this.machines.records.has(id)) continue;
      await this.sample(id).catch(() => {});
    }
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.tick;
    await this.writes;
  }
}
