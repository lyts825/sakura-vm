/**
 * 模块职责：管理 USB 转发与热插拔记录，校准实例设备状态并限制重复规则。
 * Module purpose: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
 */
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { qmp } from './qmp.ts';

const vendorId = z.number().int().min(1).max(0xffff);
const productId = z.number().int().min(1).max(0xffff);
const mediaKind = z.enum(['camera', 'microphone', 'headset']);
const ruleSchema = z.object({ id: z.uuid(), vmId: z.uuid(), vendorId, productId,
  mediaKind: mediaKind.optional(), createdAt: z.string() }).strict();
const eventSchema = z.object({ id: z.uuid(), vmId: z.uuid(), operation: z.enum(['attach', 'detach']),
  deviceId: z.string().min(1), vendorId, productId, source: z.enum(['manual', 'rule']),
  status: z.enum(['configured', 'requested', 'failed']), at: z.string(),
  error: z.string().max(500).optional() }).strict();
const storeSchema = z.object({ version: z.literal(1), rules: z.array(ruleSchema).max(256),
  events: z.array(eventSchema).max(200) }).strict();
type Store = z.infer<typeof storeSchema>;
type Device = { id: string; vendorId: number; productId: number; ruleId?: string };
type Runtime = { startedAt: string; devices: Device[] };
/**
 * 入口 / Entry: initial.
 * 功能：从当前输入或状态计算 `({ version: 1, rules: [], events: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, rules: [], events: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, rules: [], events: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const initial = (): Store => ({ version: 1, rules: [], events: [] });

export const usbHotplugRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save-rule'), vendorId, productId,
    mediaKind: mediaKind.optional() }).strict(),
  z.object({ operation: z.literal('remove-rule'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('apply-rule'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('attach'), vendorId, productId }).strict(),
  z.object({ operation: z.literal('detach'), deviceId: z.string().regex(/^sakura-usb-[0-9a-f-]{36}$/) }).strict(),
]);

/** Restricts physical USB forwarding to explicit VID:PID pairs and a managed QEMU bus. */
export class UsbHotplug {
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private runtime = new Map<string, Runtime>();
  private closed = false;
  /**
   * 入口 / Entry: UsbHotplug.changed.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; the calls and state transitions below complete the operation. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `this.reconcile().catch`, `this.reconcile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.reconcile().catch`, `this.reconcile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private readonly changed = () => { void this.reconcile().catch(() => {}); };
  /**
   * 入口 / Entry: UsbHotplug.constructor.
   * 功能：建立 UsbHotplug 的管理 USB 转发与热插拔记录上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the UsbHotplug context for this module's responsibility: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: default=join(DATA, 'usb-hotplug.json'); blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; executeQmp: typeof qmp default=qmp
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private file = join(DATA, 'usb-hotplug.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private executeQmp: typeof qmp = qmp) {}

  /**
   * 入口 / Entry: UsbHotplug.init.
   * 功能：在管理 USB 转发与热插拔记录中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`UsbHotplug`）。
   * Purpose: Initializes and verifies current domain state in `UsbHotplug`; the outcome is recorded in `this.state`. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!info`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 256 * 1024)`; `new Set(this.state.rules.map((rule) => rule.id)).size !== this.state.rules.length`; `new Set(this.state.rules.map((rule) => `${rule.vmId}:${rule.vendorId}:${rule.productId}`)).size !== this.state.rules.length`; 异常 / errors `new AppError('USB 热插拔记录类型或大小无效')`; `new AppError('USB 转发规则重复')`.
   */
  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 256 * 1024))
      throw new AppError('USB 热插拔记录类型或大小无效');
    this.state = storeSchema.parse(await readStore(this.file, initial));
    if (new Set(this.state.rules.map((rule) => rule.id)).size !== this.state.rules.length)
      throw new AppError('USB 转发规则重复');
    if (new Set(this.state.rules.map((rule) =>
      `${rule.vmId}:${rule.vendorId}:${rule.productId}`)).size !== this.state.rules.length)
      throw new AppError('USB 转发设备匹配重复');
    if (!info) await writeStore(this.file, this.state);
    this.machines.on('change', this.changed);
    await this.reconcile();
  }
  /**
   * 入口 / Entry: UsbHotplug.serialized.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task.finally(() => this.mutation(-1))` 供上层消费（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; this entry produces `task.finally(() => this.mutation(-1))` for its caller. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
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
   * 入口 / Entry: UsbHotplug.save.
   * 功能：在管理 USB 转发与热插拔记录中，校验并提交领域状态变更；处理结果记录到 `this.state`（`UsbHotplug`）。
   * Purpose: Validates and commits a domain state change in `UsbHotplug`; the outcome is recorded in `this.state`. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
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
   * 入口 / Entry: UsbHotplug.live.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ live, runtime }` 供上层消费（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; this entry produces `{ live, runtime }` for its caller. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `this.machines.get`, `this.machines.live.get`, `this.runtime.get`, `this.runtime.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.live.get`, `this.runtime.get`, `this.runtime.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!runtime || runtime.startedAt !== live.startedAt`.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `{ live, runtime }`.
   * 副作用 / Effects: `this.runtime.set`; 更新 / updates `runtime`.
   * 拒绝 / Refusals: 条件 / conditions `vm.architecture === 'aarch64'`; `!live || live.status !== 'running'`; 异常 / errors `new AppError('当前 ARM64 机型未启用 USB 控制器', 409)`; `new AppError('请先启动实例', 409)`.
   */
  private live(vmId: string) {
    const vm = this.machines.get(vmId);
    if (vm.architecture === 'aarch64') throw new AppError('当前 ARM64 机型未启用 USB 控制器', 409);
    const live = this.machines.live.get(vmId);
    if (!live || live.status !== 'running') throw new AppError('请先启动实例', 409);
    let runtime = this.runtime.get(vmId);
    if (!runtime || runtime.startedAt !== live.startedAt) {
      runtime = { startedAt: live.startedAt, devices: [] };
      this.runtime.set(vmId, runtime);
    }
    return { live, runtime };
  }
  /**
   * 入口 / Entry: UsbHotplug.record.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `entry` 供上层消费（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; this entry produces `entry` for its caller. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `randomUUID`, `this.save`, `inline.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `randomUUID`, `this.save`, `inline.slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; device: Device; operation: 'attach' | 'detach'; source: 'manual' | 'rule'; status: 'configured' | 'requested' | 'failed'; error: unknown optional
   * 输出 / Returns: `entry`.
   * 副作用 / Effects: `this.save`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async record(vmId: string, device: Device, operation: 'attach' | 'detach',
    source: 'manual' | 'rule', status: 'configured' | 'requested' | 'failed', error?: unknown) {
    const entry = { id: randomUUID(), vmId, operation, deviceId: device.id,
      vendorId: device.vendorId, productId: device.productId, source, status,
      at: new Date().toISOString(), ...(error ? { error: String((error as Error).message || error).slice(0, 500) } : {}) };
    await this.save({ ...this.state, events: [entry, ...this.state.events].slice(0, 200) });
    return entry;
  }
  /**
   * 入口 / Entry: UsbHotplug.attach.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.record(vmId, device, 'attach', source, 'configured')` 供上层消费（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; this entry produces `this.record(vmId, device, 'attach', source, 'configured')` for its caller. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `this.live`, `runtime.devices.some`, `randomUUID`, `this.executeQmp` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.live`, `runtime.devices.some`, `randomUUID`, `this.executeQmp`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; vendor: number; product: number; source: 'manual' | 'rule'; ruleId: string optional
   * 输出 / Returns: `this.record(vmId, device, 'attach', source, 'configured')`.
   * 副作用 / Effects: `this.executeQmp`; `runtime.devices.push`.
   * 拒绝 / Refusals: 条件 / conditions `runtime.devices.some((device) => device.vendorId === vendor && device.productId === product)`; `runtime.devices.length >= 16`; 异常 / errors `new AppError('相同 USB 设备转发已配置', 409)`; `new AppError('单实例 USB 转发已达上限', 409)`.
   * 失败处理：catch 分支执行 `await this.record(vmId, device, 'attach', source, 'failed', error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.record(vmId, device, 'attach', source, 'failed', error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async attach(vmId: string, vendor: number, product: number,
    source: 'manual' | 'rule', ruleId?: string) {
    const { live, runtime } = this.live(vmId);
    if (runtime.devices.some((device) => device.vendorId === vendor && device.productId === product))
      throw new AppError('相同 USB 设备转发已配置', 409);
    if (runtime.devices.length >= 16) throw new AppError('单实例 USB 转发已达上限', 409);
    const device: Device = { id: `sakura-usb-${randomUUID()}`, vendorId: vendor,
      productId: product, ...(ruleId ? { ruleId } : {}) };
    try {
      await this.executeQmp(live.qmpPort, 'device_add', { driver: 'usb-host',
        id: device.id, bus: 'sakura-usb.0', vendorid: vendor, productid: product });
    } catch (error) {
      await this.record(vmId, device, 'attach', source, 'failed', error);
      throw error;
    }
    runtime.devices.push(device);
    return this.record(vmId, device, 'attach', source, 'configured');
  }
  /**
   * 入口 / Entry: UsbHotplug.detach.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.record(vmId, device, 'detach', device.ruleId ? 'rule' : 'manual', 'requested')` 供上层消费（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; this entry produces `this.record(vmId, device, 'detach', device.ruleId ? 'rule' : 'manual', 'requested')` for its caller. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `this.live`, `runtime.devices.find`, `this.executeQmp`, `this.record` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.live`, `runtime.devices.find`, `this.executeQmp`, `this.record`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; deviceId: string
   * 输出 / Returns: `this.record(vmId, device, 'detach', device.ruleId ? 'rule' : 'manual', 'requested')`.
   * 副作用 / Effects: `this.executeQmp`; 更新 / updates `runtime.devices`.
   * 拒绝 / Refusals: 条件 / conditions `!device`; 异常 / errors `new AppError('USB 转发不存在或实例已重启', 404)`; `error`.
   * 失败处理：catch 分支执行 `await this.record(vmId, device, 'detach', device.ruleId ? 'rule' : 'manual', 'failed', error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.record(vmId, device, 'detach', device.ruleId ? 'rule' : 'manual', 'failed', error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async detach(vmId: string, deviceId: string) {
    const { live, runtime } = this.live(vmId);
    const device = runtime.devices.find((item) => item.id === deviceId);
    if (!device) throw new AppError('USB 转发不存在或实例已重启', 404);
    try {
      await this.executeQmp(live.qmpPort, 'device_del', { id: device.id });
    } catch (error) {
      await this.record(vmId, device, 'detach', device.ruleId ? 'rule' : 'manual', 'failed', error);
      throw error;
    }
    runtime.devices = runtime.devices.filter((item) => item.id !== device.id);
    return this.record(vmId, device, 'detach', device.ruleId ? 'rule' : 'manual', 'requested');
  }
  /**
   * 入口 / Entry: UsbHotplug.reconcile.
   * 功能：把本层请求转交 `this.serialized`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serialized` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.serialized(() => this.sync())`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async reconcile() { return this.serialized(() => this.sync()); }
  /**
   * 入口 / Entry: UsbHotplug.sync.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; the calls and state transitions below complete the operation. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `running.add`, `this.machines.get`, `this.machines.incidentLocked`, `this.runtime.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `running.add`, `this.machines.get`, `this.machines.incidentLocked`, `this.runtime.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `live.status !== 'running'`; `this.machines.get(vmId).architecture === 'aarch64'`; `this.machines.incidentLocked(vmId)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `running.add`; `this.runtime.set`; `this.runtime.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async sync() {
    const running = new Set<string>();
    for (const [vmId, live] of this.machines.live) {
      if (live.status !== 'running') continue;
      running.add(vmId);
      if (this.machines.get(vmId).architecture === 'aarch64') continue;
      if (this.machines.incidentLocked(vmId)) continue;
      if (this.runtime.get(vmId)?.startedAt === live.startedAt) continue;
      this.runtime.set(vmId, { startedAt: live.startedAt, devices: [] });
      for (const rule of this.state.rules.filter((item) => item.vmId === vmId))
        await this.attach(vmId, rule.vendorId, rule.productId, 'rule', rule.id).catch(() => {});
    }
    for (const vmId of this.runtime.keys()) if (!running.has(vmId)) this.runtime.delete(vmId);
  }
  /**
   * 入口 / Entry: UsbHotplug.view.
   * 功能：在管理 USB 转发与热插拔记录中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ready: this.machines.get(vmId).architecture !== 'aarch64' && live?.status === 'running', hostDevices, hostError, rules: thi…` 供上层消费（`UsbHotplug`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `UsbHotplug`; this entry produces `{ ready: this.machines.get(vmId).architecture !== 'aarch64' && live?.status === 'running', hostDevices, hostError, rules: thi…` for its caller. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `this.machines.get`, `this.machines.live.get`, `this.executeQmp`, `this.runtime.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.live.get`, `this.executeQmp`, `this.runtime.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `live?.status === 'running'`.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `{ ready: this.machines.get(vmId).architecture !== 'aarch64' && live?.status === 'running', hostDevices, hostError, rules: thi…`.
   * 副作用 / Effects: `this.executeQmp`; 更新 / updates `hostDevices`, `hostError`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `hostError = String((error as Error).message || error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `hostError = String((error as Error).message || error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async view(vmId: string) {
    this.machines.get(vmId);
    const live = this.machines.live.get(vmId);
    let hostDevices = '';
    let hostError = '';
    if (live?.status === 'running') {
      try {
        hostDevices = String(await this.executeQmp(live.qmpPort, 'human-monitor-command',
          { 'command-line': 'info usbhost' }));
      } catch (error) { hostError = String((error as Error).message || error); }
    }
    const runtime = this.runtime.get(vmId);
    return { ready: this.machines.get(vmId).architecture !== 'aarch64' && live?.status === 'running',
      hostDevices, hostError,
      rules: this.state.rules.filter((rule) => rule.vmId === vmId),
      configured: runtime && runtime.startedAt === live?.startedAt ? runtime.devices : [],
      events: this.state.events.filter((event) => event.vmId === vmId).slice(0, 40) };
  }
  /**
   * 入口 / Entry: UsbHotplug.action.
   * 功能：在管理 USB 转发与热插拔记录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serialized(async () => { if (value.operation === 'save-rule') { if (this.state.rules.filter((rule) => rule.vmId === vmId…` 供上层消费（`UsbHotplug`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `UsbHotplug`; this entry produces `this.serialized(async () => { if (value.operation === 'save-rule') { if (this.state.rules.filter((rule) => rule.vmId === vmId…` for its caller. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `usbHotplugRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.serialized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `usbHotplugRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.serialized`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; input: unknown
   * 输出 / Returns: `this.serialized(async () => { if (value.operation === 'save-rule') { if (this.state.rules.filter((rule) => rule.vmId === vmId…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(vmId: string, input: unknown) {
    const value = usbHotplugRequest.parse(input);
    this.machines.get(vmId);
    this.machines.requireUnlocked(vmId);
    /**
     * 入口 / Entry: UsbHotplug.action.callback@172.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.serialized）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.serialized).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view(vmId)`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `value.operation === 'save-rule'`; `this.state.rules.filter((rule) => rule.vmId === vmId).length >= 16`; `this.state.rules.some((rule) => rule.vmId === vmId && rule.vendorId === value.vendorId && rule.productId === value.productId)`; 异常 / errors `new AppError('单实例 USB 转发规则已达上限', 409)`; `new AppError('相同 USB 转发规则已存在', 409)`.
     */
    return this.serialized(async () => {
      if (value.operation === 'save-rule') {
        if (this.state.rules.filter((rule) => rule.vmId === vmId).length >= 16)
          throw new AppError('单实例 USB 转发规则已达上限', 409);
        if (this.state.rules.some((rule) => rule.vmId === vmId &&
          rule.vendorId === value.vendorId && rule.productId === value.productId))
          throw new AppError('相同 USB 转发规则已存在', 409);
        const rule = { id: randomUUID(), vmId, vendorId: value.vendorId,
          productId: value.productId, ...(value.mediaKind ? { mediaKind: value.mediaKind } : {}),
          createdAt: new Date().toISOString() };
        await this.save({ ...this.state, rules: [...this.state.rules, rule] });
        if (this.machines.state(vmId) === 'running')
          await this.attach(vmId, rule.vendorId, rule.productId, 'rule', rule.id);
        return this.view(vmId);
      }
      if (value.operation === 'remove-rule') {
        const rule = this.state.rules.find((item) => item.id === value.id && item.vmId === vmId);
        if (!rule) throw new AppError('USB 转发规则不存在', 404);
        await this.save({ ...this.state, rules: this.state.rules.filter((item) => item.id !== rule.id) });
        const device = this.runtime.get(vmId)?.devices.find((item) => item.ruleId === rule.id);
        if (device && this.machines.state(vmId) === 'running') await this.detach(vmId, device.id);
        return this.view(vmId);
      }
      if (value.operation === 'apply-rule') {
        const rule = this.state.rules.find((item) => item.id === value.id && item.vmId === vmId);
        if (!rule) throw new AppError('USB 转发规则不存在', 404);
        await this.attach(vmId, rule.vendorId, rule.productId, 'rule', rule.id);
      } else if (value.operation === 'attach')
        await this.attach(vmId, value.vendorId, value.productId, 'manual');
      else await this.detach(vmId, value.deviceId);
      return this.view(vmId);
    });
  }
  /**
   * 入口 / Entry: UsbHotplug.close.
   * 功能：在管理 USB 转发与热插拔记录中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`UsbHotplug`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `UsbHotplug`; the outcome is recorded in `this.closed`. Module context: Owns USB forwarding/hotplug records, reconciles VM device state and rejects duplicate rules.
   * 处理：通过 `this.machines.off`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.machines.off('change', this.changed);
    this.closed = true;
    await this.queue.catch(() => {});
  }
}
