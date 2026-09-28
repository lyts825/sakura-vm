import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';
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
  private readonly changed = () => { void this.reconcile().catch(() => {}); };
  constructor(private machines: Machines, private file = join(DATA, 'usb-hotplug.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private executeQmp: typeof qmp = qmp) {}

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
  private async record(vmId: string, device: Device, operation: 'attach' | 'detach',
    source: 'manual' | 'rule', status: 'configured' | 'requested' | 'failed', error?: unknown) {
    const entry = { id: randomUUID(), vmId, operation, deviceId: device.id,
      vendorId: device.vendorId, productId: device.productId, source, status,
      at: new Date().toISOString(), ...(error ? { error: String((error as Error).message || error).slice(0, 500) } : {}) };
    await this.save({ ...this.state, events: [entry, ...this.state.events].slice(0, 200) });
    return entry;
  }
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
  async reconcile() { return this.serialized(() => this.sync()); }
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
    return { ready: this.machines.get(vmId).architecture !== 'aarch64' && live?.status === 'running',
      hostDevices, hostError,
      rules: this.state.rules.filter((rule) => rule.vmId === vmId),
      configured: this.runtime.get(vmId)?.startedAt === live?.startedAt
        ? this.runtime.get(vmId)!.devices : [],
      events: this.state.events.filter((event) => event.vmId === vmId).slice(0, 40) };
  }
  async action(vmId: string, input: unknown) {
    const value = usbHotplugRequest.parse(input);
    this.machines.get(vmId);
    this.machines.requireUnlocked(vmId);
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
  async close() {
    this.machines.off('change', this.changed);
    this.closed = true;
    await this.queue.catch(() => {});
  }
}
