/**
 * 模块职责：探测 QEMU GPU 后端并管理实例 GPU 档案，配置依据实际宿主支持结果。
 * Module purpose: Probes QEMU GPU backends and owns VM profiles based on measured host support.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { deviceArguments, deviceProfileSchema, hardwareSchema } from '../shared/hardware.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
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
/**
 * 入口 / Entry: initial.
 * 功能：从当前输入或状态计算 `({ version: 1, profiles: [], assignments: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, profiles: [], assignments: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, profiles: [], assignments: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const initial = (): Store => ({ version: 1, profiles: [], assignments: [] });
/**
 * 入口 / Entry: digest.
 * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(value)).digest('hex')` 供上层消费（`gpu-profiles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpu-profiles.ts`; this entry produces `createHash('sha256').update(JSON.stringify(value)).digest('hex')` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify(value)).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: probeGpuBackend.
 * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ available: true }` / `{ available: false, reason: (error || `${device} 未能启动 QMP`).slice(0, 500) }` 供上层消费（`gpu-profiles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpu-profiles.ts`; this entry produces `{ available: true }` / `{ available: false, reason: (error || `${device} 未能启动 QMP`).slice(0, 500) }` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
 * 处理：通过 `freePort`, `machines.engine.run().catch().finally`, `machines.engine.run().catch`, `machines.engine.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `freePort`, `machines.engine.run().catch().finally`, `machines.engine.run().catch`, `machines.engine.run`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!exited`.
 * 输入 / Inputs: machines: Machines; graphics: 'virtio-gpu' | 'virgl'
 * 输出 / Returns: Promise<GpuBackendSupport>；结果来自 / values from `{ available: true }`; `{ available: false, reason: (error || `${device} 未能启动 QMP`).slice(0, 500) }`.
 * 副作用 / Effects: `abort.abort`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `abort.abort();`; `await task;`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `abort.abort();`; `await task;`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `if (!exited) await delay(100);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (!exited) await delay(100);`; these statements determine whether a failure is absorbed or rejected again.
 */
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
  /**
   * 入口 / Entry: GpuProfiles.constructor.
   * 功能：建立 GpuProfiles 的探测 QEMU GPU 后端并管理实例 GPU 档案上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GpuProfiles context for this module's responsibility: Probes QEMU GPU backends and owns VM profiles based on measured host support. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: default=join(DATA, 'gpu-profiles.json'); blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; probe: typeof probeGpuBackend default=probeGpuBackend
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines,
    private file = join(DATA, 'gpu-profiles.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private probe: typeof probeGpuBackend = probeGpuBackend) {}

  /**
   * 入口 / Entry: GpuProfiles.init.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`GpuProfiles`）。
   * Purpose: Initializes and verifies current domain state in `GpuProfiles`; the outcome is recorded in `this.state`. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!info`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.state.assignments.map`; `writeStore`; 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 128 * 1024)`; `new Set(this.state.profiles.map((profile) => profile.id)).size !== this.state.profiles.length`; `new Set(this.state.assignments.map((assignment) => assignment.vmId)).size !== this.state.assignments.length`; 异常 / errors `new AppError('GPU 档案记录类型或大小无效')`; `new AppError('GPU 档案标识重复')`.
   */
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
  /**
   * 入口 / Entry: GpuProfiles.support.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.supportCache.value` / `this.supportTask` 供上层消费（`GpuProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GpuProfiles`; this entry produces `this.supportCache.value` / `this.supportTask` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `inline().finally`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().finally`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.supportCache && this.supportCache.expires > Date.now()`; `!this.supportTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.supportCache.value`; `this.supportTask`.
   * 副作用 / Effects: 更新 / updates `this.supportTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: GpuProfiles.view.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ profiles: structuredClone(this.state.profiles), support, assignments: this.state.assignments.map((assignment) => { const vm…` 供上层消费（`GpuProfiles`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `GpuProfiles`; this entry produces `{ profiles: structuredClone(this.state.profiles), support, assignments: this.state.assignments.map((assignment) => { const vm…` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `this.support`, `structuredClone`, `this.state.assignments.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.support`, `structuredClone`, `this.state.assignments.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ profiles: structuredClone(this.state.profiles), support, assignments: this.state.assignments.map((assignment) => { const vm…`.
   * 副作用 / Effects: `this.state.assignments.map`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view() {
    const support = await this.support();
    return { profiles: structuredClone(this.state.profiles), support,
      assignments: this.state.assignments.map((assignment) => {
        const vm = this.machines.records.get(assignment.vmId);
        return { ...assignment, vmName: vm?.name || null,
          drifted: !vm || digest(vm.hardware || {}) !== assignment.hardwareHash };
      }) };
  }
  /**
   * 入口 / Entry: GpuProfiles.serialized.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task.finally(() => this.mutation(-1))` 供上层消费（`GpuProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GpuProfiles`; this entry produces `task.finally(() => this.mutation(-1))` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `this.blocked`, `this.mutation`, `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.mutation`, `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task.finally(() => this.mutation(-1))`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
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
  /**
   * 入口 / Entry: GpuProfiles.save.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，校验并提交领域状态变更；处理结果记录到 `this.state`（`GpuProfiles`）。
   * Purpose: Validates and commits a domain state change in `GpuProfiles`; the outcome is recorded in `this.state`. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: next: Store
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(next: Store) {
    await writeStore(this.file, next);
    this.state = next;
  }
  /**
   * 入口 / Entry: GpuProfiles.profile.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `profile` 供上层消费（`GpuProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GpuProfiles`; this entry produces `profile` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `this.state.profiles.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.profiles.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Profile；结果来自 / values from `profile`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!profile`; 异常 / errors `new AppError('GPU 档案不存在', 404)`.
   */
  private profile(id: string): Profile {
    const profile = this.state.profiles.find((item) => item.id === id);
    if (!profile) throw new AppError('GPU 档案不存在', 404);
    return profile;
  }
  /**
   * 入口 / Entry: GpuProfiles.preview.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: reasons.length === 0, reasons, vmId, vmName: vm.name, profileId: profile.id, profileRevision: profile.revision, prev…` 供上层消费（`GpuProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GpuProfiles`; this entry produces `{ ready: reasons.length === 0, reasons, vmId, vmName: vm.name, profileId: profile.id, profileRevision: profile.revision, prev…` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `this.machines.get`, `this.machines.requireUnlocked`, `this.support`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.requireUnlocked`, `this.support`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: profile: Profile; vmId: string
   * 输出 / Returns: `{ ready: reasons.length === 0, reasons, vmId, vmName: vm.name, profileId: profile.id, profileRevision: profile.revision, prev…`.
   * 副作用 / Effects: `createHmac().update().digest`; `createHmac().update`; `createHmac`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: GpuProfiles.action.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.preview(this.profile(value.id), value.vmId)` / `this.serialized(async () => { if (value.operation === 'save') { const current = value.id ? this.profile(value.id) : undefined…` 供上层消费（`GpuProfiles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GpuProfiles`; this entry produces `this.preview(this.profile(value.id), value.vmId)` / `this.serialized(async () => { if (value.operation === 'save') { const current = value.id ? this.profile(value.id) : undefined…` for its caller. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `gpuProfileRequest.parse`, `this.preview`, `this.profile`, `this.serialized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `gpuProfileRequest.parse`, `this.preview`, `this.profile`, `this.serialized`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.operation === 'preview'`.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.preview(this.profile(value.id), value.vmId)`; `this.serialized(async () => { if (value.operation === 'save') { const current = value.id ? this.profile(value.id) : undefined…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(input: unknown) {
    const value = gpuProfileRequest.parse(input);
    if (value.operation === 'preview') return this.preview(this.profile(value.id), value.vmId);
    /**
     * 入口 / Entry: GpuProfiles.action.callback@183.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.serialized）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.serialized).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `profile`; `{ removed: profile.id }`; `{ ...assignment, hardware: preview.after }`.
     * 副作用 / Effects: `this.save`; `this.state.assignments.filter`.
     * 拒绝 / Refusals: 条件 / conditions `value.operation === 'save'`; `current && current.revision !== value.revision`; `!current && value.revision`; 异常 / errors `new AppError('GPU 档案已变化，请刷新', 409)`; `new AppError('新档案不能指定修订号')`.
     * 失败处理：catch 分支执行 `try { await this.machines.configureHardware(value.vmId, preview.before, { hardware: preview.after, memoryMiB: preview.memoryM…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `try { await this.machines.configureHardware(value.vmId, preview.before, { hardware: preview.after, memoryMiB: preview.memoryM…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
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
  /**
   * 入口 / Entry: GpuProfiles.close.
   * 功能：在探测 QEMU GPU 后端并管理实例 GPU 档案中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`GpuProfiles`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `GpuProfiles`; the outcome is recorded in `this.closed`. Module context: Probes QEMU GPU backends and owns VM profiles based on measured host support.
   * 处理：通过 `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() { this.closed = true; await this.queue.catch(() => {}); }
}
