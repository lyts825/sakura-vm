import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { deviceArguments, deviceProfileSchema, hardwareSchema } from '../shared/hardware.ts';
import type { Machines } from './machines.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';
import { freePort, qmp } from './qmp.ts';

export const gpuProfileInput = z.object({
  name: z.string().trim().min(1).max(64),
  graphics: z.enum(['virtio-gpu', 'virgl']),
  outputs: z.number().int().min(1).max(4),
  width: z.number().int().min(640).max(3840),
  height: z.number().int().min(480).max(2160),
  hostMemoryMiB: z.number().int().min(64).max(1024),
  minVmMemoryMiB: z.number().int().min(256).max(8192),
}).strict();
const profileSchema = gpuProfileInput.extend({ id: z.uuid(),
  revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string() }).strict();
const assignmentSchema = z.object({ vmId: z.uuid(), profileId: z.uuid(), profileName: z.string(),
  profileRevision: z.number().int().positive(), hardwareHash: z.string().regex(/^[a-f0-9]{64}$/),
  appliedAt: z.string() }).strict();
const storeSchema = z.object({ version: z.literal(1), profiles: z.array(profileSchema).max(32),
  assignments: z.array(assignmentSchema).max(64) }).strict();
type Store = z.infer<typeof storeSchema>;
type Profile = Store['profiles'][number];
const initial = (): Store => ({ version: 1, profiles: [], assignments: [] });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const gpuProfileRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), id: z.uuid().optional(),
    revision: z.number().int().positive().optional(), profile: gpuProfileInput }).strict(),
  z.object({ operation: z.literal('remove'), id: z.uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('preview'), id: z.uuid(), vmId: z.uuid() }).strict(),
  z.object({ operation: z.literal('apply'), id: z.uuid(), vmId: z.uuid(),
    previewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

export type GpuBackendSupport = { available: boolean; reason?: string };

/** A device listing alone does not prove the selected display backend can start. */
export async function probeGpuBackend(machines: Machines,
  graphics: 'virtio-gpu' | 'virgl'): Promise<GpuBackendSupport> {
  const port = await freePort();
  const abort = new AbortController();
  let exited = false;
  let error = '';
  const device = graphics === 'virgl' ? 'virtio-gpu-gl-pci' : 'virtio-gpu-pci';
  const task = machines.engine.run('sakura-qemu', [
    '-machine', 'q35', '-accel', 'tcg', '-nodefaults', '-m', '256',
    '-display', graphics === 'virgl' ? 'egl-headless' : 'none',
    '-S', '-device', `${device},max_outputs=1,xres=1280,yres=800,max_hostmem=256M`,
    '-qmp', `tcp:127.0.0.1:${port},server=on,wait=off`,
  ], { signal: abort.signal, timeoutMs: 5000 })
    .catch((failure) => { error = String((failure as Error).message || failure); })
    .finally(() => { exited = true; });
  try {
    const deadline = performance.now() + 4000;
    while (!exited && performance.now() < deadline) {
      try {
        await qmp(port, 'query-status', undefined, 500);
        return { available: true };
      } catch {
        if (!exited) await delay(100);
      }
    }
    return { available: false,
      reason: (error || `${device} 未能启动 QMP`).slice(0, 500) };
  } finally {
    abort.abort();
    await task;
  }
}

export class GpuProfiles {
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private reviewKey = randomBytes(32);
  private supportCache?: { expires: number; value: Record<'virtio-gpu' | 'virgl', GpuBackendSupport> };
  private supportTask?: Promise<Record<'virtio-gpu' | 'virgl', GpuBackendSupport>>;
  constructor(private machines: Machines,
    private file = join(DATA, 'gpu-profiles.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private probe: typeof probeGpuBackend = probeGpuBackend) {}

  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 128 * 1024))
      throw new AppError('GPU 档案记录类型或大小无效');
    this.state = storeSchema.parse(await readStore(this.file, initial));
    if (new Set(this.state.profiles.map((profile) => profile.id)).size !== this.state.profiles.length)
      throw new AppError('GPU 档案标识重复');
    if (new Set(this.state.assignments.map((assignment) => assignment.vmId)).size !==
      this.state.assignments.length) throw new AppError('GPU 实例分配记录重复');
    if (!info) await writeStore(this.file, this.state);
  }
  private async support() {
    if (this.supportCache && this.supportCache.expires > Date.now())
      return this.supportCache.value;
    if (!this.supportTask) this.supportTask = (async () => {
      const value = {
        'virtio-gpu': await this.probe(this.machines, 'virtio-gpu'),
        virgl: await this.probe(this.machines, 'virgl'),
      };
      this.supportCache = { expires: Date.now() + 5 * 60_000, value };
      return value;
    })().finally(() => { this.supportTask = undefined; });
    return this.supportTask;
  }
  async view() {
    const support = await this.support();
    return { profiles: structuredClone(this.state.profiles), support,
      assignments: this.state.assignments.map((assignment) => {
        const vm = this.machines.records.get(assignment.vmId);
        return { ...assignment, vmName: vm?.name || null,
          drifted: !vm || digest(vm.hardware || {}) !== assignment.hardwareHash };
      }) };
  }
  private serialized<T>(work: () => Promise<T>) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    const task = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
      return work();
    });
    this.queue = task;
    return task.finally(() => this.mutation(-1));
  }
  private async save(next: Store) {
    await writeStore(this.file, next);
    this.state = next;
  }
  private profile(id: string): Profile {
    const profile = this.state.profiles.find((item) => item.id === id);
    if (!profile) throw new AppError('GPU 档案不存在', 404);
    return profile;
  }
  private async preview(profile: Profile, vmId: string) {
    const vm = this.machines.get(vmId);
    this.machines.requireUnlocked(vmId);
    const support = await this.support();
    const available = support[profile.graphics];
    const reasons = [
      ...(vm.architecture === 'aarch64' ? ['当前 ARM64 机型不支持 PCI 虚拟显卡'] : []),
      ...(vm.sandbox ? ['临时实例不能更改硬件配置'] : []),
      ...(this.machines.state(vmId) !== 'stopped' ? ['请先停止实例'] : []),
      ...(vm.memoryMiB < profile.minVmMemoryMiB ?
        [`实例内存低于档案要求的 ${profile.minVmMemoryMiB} MiB`] : []),
      ...(!available.available ? [available.reason || '宿主 QEMU 不支持所选显卡后端'] : []),
    ];
    const devices = deviceProfileSchema.parse({ ...vm.hardware?.devices,
      graphics: profile.graphics, graphicsOutputs: profile.outputs,
      graphicsWidth: profile.width, graphicsHeight: profile.height,
      graphicsMemoryMiB: profile.hostMemoryMiB });
    const hardware = hardwareSchema.parse({ ...vm.hardware, devices });
    const token = createHmac('sha256', this.reviewKey).update(JSON.stringify({
      vmId, memoryMiB: vm.memoryMiB, architecture: vm.architecture,
      hardwareBefore: vm.hardware || {}, profile,
    })).digest('hex');
    return { ready: reasons.length === 0, reasons, vmId, vmName: vm.name,
      profileId: profile.id, profileRevision: profile.revision, previewToken: token,
      before: vm.hardware || {}, memoryMiB: vm.memoryMiB, architecture: vm.architecture,
      after: hardware,
      qemuDeviceArguments: deviceArguments({ ...vm, hardware }).slice(-2) };
  }
  async action(input: unknown) {
    const value = gpuProfileRequest.parse(input);
    if (value.operation === 'preview') return this.preview(this.profile(value.id), value.vmId);
    return this.serialized(async () => {
      if (value.operation === 'save') {
        const current = value.id ? this.profile(value.id) : undefined;
        if (current && current.revision !== value.revision)
          throw new AppError('GPU 档案已变化，请刷新', 409);
        if (!current && value.revision) throw new AppError('新档案不能指定修订号');
        if (!current && this.state.profiles.length >= 32)
          throw new AppError('GPU 档案已达上限', 409);
        if (this.state.profiles.some((item) => item.name === value.profile.name &&
          item.id !== current?.id)) throw new AppError('GPU 档案名称重复', 409);
        const timestamp = new Date().toISOString();
        const profile: Profile = { ...value.profile, id: current?.id || randomUUID(),
          revision: (current?.revision || 0) + 1,
          createdAt: current?.createdAt || timestamp, updatedAt: timestamp };
        await this.save({ ...this.state, profiles: current
          ? this.state.profiles.map((item) => item.id === current.id ? profile : item)
          : [...this.state.profiles, profile] });
        return profile;
      }
      if (value.operation === 'remove') {
        const profile = this.profile(value.id);
        if (profile.revision !== value.revision) throw new AppError('GPU 档案已变化，请刷新', 409);
        await this.save({ ...this.state, profiles: this.state.profiles.filter((item) => item.id !== profile.id) });
        return { removed: profile.id };
      }
      const profile = this.profile(value.id);
      const preview = await this.preview(profile, value.vmId);
      if (value.previewToken !== preview.previewToken)
        throw new AppError('GPU 预览已过期，请重新检查', 409);
      if (!preview.ready) throw new AppError(preview.reasons.join('；'), 409);
      await this.machines.configureHardware(value.vmId, preview.after,
        { hardware: preview.before, memoryMiB: preview.memoryMiB,
          architecture: preview.architecture });
      const assignment = { vmId: value.vmId, profileId: profile.id,
        profileName: profile.name, profileRevision: profile.revision,
        hardwareHash: digest(preview.after), appliedAt: new Date().toISOString() };
      try {
        await this.save({ ...this.state, assignments: [assignment,
          ...this.state.assignments.filter((item) => item.vmId !== value.vmId)].slice(0, 64) });
      } catch (error) {
        try {
          await this.machines.configureHardware(value.vmId, preview.before,
            { hardware: preview.after, memoryMiB: preview.memoryMiB,
              architecture: preview.architecture });
        } catch (rollbackError) {
          throw new AppError(`GPU 配置已应用，但登记和回滚均失败：${String(error)}；${String(rollbackError)}`, 500);
        }
        throw error;
      }
      return { ...assignment, hardware: preview.after };
    });
  }
  async close() { this.closed = true; await this.queue.catch(() => {}); }
}
