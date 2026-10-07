/**
 * 模块职责：探测 QEMU 音频后端并配置实例媒体设备，校验架构对所选设备的支持。
 * Module purpose: Probes QEMU audio backends and configures media devices after checking architecture support.
 */
import type { UsbHotplugV1 } from './service-contracts/v1.ts';
import { createHmac, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { audioArguments, deviceProfileSchema, hardwareSchema } from '../shared/hardware.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { AppError } from '../shared/errors.ts';
import { freePort, qmp } from './qmp.ts';

const audioMode = z.enum(['off', 'virtual', 'host']);
export const mediaDeviceRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('preview-audio'), mode: audioMode }).strict(),
  z.object({ operation: z.literal('apply-audio'), mode: audioMode,
    previewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ operation: z.literal('save-usb'), kind: z.enum(['camera', 'microphone', 'headset']),
    vendorId: z.number().int().min(1).max(0xffff),
    productId: z.number().int().min(1).max(0xffff) }).strict(),
  z.object({ operation: z.literal('remove-usb'), ruleId: z.uuid() }).strict(),
  z.object({ operation: z.literal('attach-usb'), ruleId: z.uuid() }).strict(),
  z.object({ operation: z.literal('detach-usb'), deviceId: z.string()
    .regex(/^sakura-usb-[0-9a-f-]{36}$/) }).strict(),
]);

export type AudioBackendSupport = { available: boolean; reason?: string };
/** Tests the actual host audio backend with a paused, diskless QEMU instance. */
/**
 * 入口 / Entry: probeAudioBackend.
 * 功能：在探测 QEMU 音频后端并配置实例媒体设备中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ available: true }` / `{ available: false, reason: (error || '音频后端未能启动 QMP').slice(0, 500) }` 供上层消费（`media-devices.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `media-devices.ts`; this entry produces `{ available: true }` / `{ available: false, reason: (error || '音频后端未能启动 QMP').slice(0, 500) }` for its caller. Module context: Probes QEMU audio backends and configures media devices after checking architecture support.
 * 处理：通过 `freePort`, `machines.engine.run().catch().finally`, `machines.engine.run().catch`, `machines.engine.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `freePort`, `machines.engine.run().catch().finally`, `machines.engine.run().catch`, `machines.engine.run`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!exited`.
 * 输入 / Inputs: machines: Machines; backend: 'none' | 'dsound'
 * 输出 / Returns: Promise<AudioBackendSupport>；结果来自 / values from `{ available: true }`; `{ available: false, reason: (error || '音频后端未能启动 QMP').slice(0, 500) }`.
 * 副作用 / Effects: `abort.abort`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `abort.abort();`; `await task;`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `abort.abort();`; `await task;`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `if (!exited) await delay(100);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (!exited) await delay(100);`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function probeAudioBackend(machines: Machines,
  backend: 'none' | 'dsound'): Promise<AudioBackendSupport> {
  const port = await freePort(), abort = new AbortController();
  let exited = false, error = '';
  const task = machines.engine.run('sakura-qemu', [
    '-machine', 'q35', '-accel', 'tcg', '-nodefaults', '-m', '256', '-display', 'none',
    '-S', '-audiodev', `${backend},id=sakura-audio`,
    '-device', 'ich9-intel-hda', '-device', 'hda-duplex,audiodev=sakura-audio',
    '-qmp', `tcp:127.0.0.1:${port},server=on,wait=off`,
  ], { signal: abort.signal, timeoutMs: 5000 })
    .catch((failure) => { error = String((failure as Error).message || failure); })
    .finally(() => { exited = true; });
  try {
    const deadline = performance.now() + 4000;
    while (!exited && performance.now() < deadline) {
      try { await qmp(port, 'query-status', undefined, 500); return { available: true }; }
      catch { if (!exited) await delay(100); }
    }
    return { available: false, reason: (error || '音频后端未能启动 QMP').slice(0, 500) };
  } finally { abort.abort(); await task; }
}

export class MediaDevices {
  private key = randomBytes(32);
  private closed = false;
  private cache?: { expires: number; value: Record<'none' | 'dsound', AudioBackendSupport> };
  private supportTask?: Promise<Record<'none' | 'dsound', AudioBackendSupport>>;
  /**
   * 入口 / Entry: MediaDevices.constructor.
   * 功能：建立 MediaDevices 的探测 QEMU 音频后端并配置实例媒体设备上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the MediaDevices context for this module's responsibility: Probes QEMU audio backends and configures media devices after checking architecture support. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; usb: UsbHotplugV1; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; probe: typeof probeAudioBackend default=probeAudioBackend
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private usb: UsbHotplugV1,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private probe: typeof probeAudioBackend = probeAudioBackend) {}

  /**
   * 入口 / Entry: MediaDevices.support.
   * 功能：在探测 QEMU 音频后端并配置实例媒体设备中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.cache.value` / `this.supportTask` 供上层消费（`MediaDevices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MediaDevices`; this entry produces `this.cache.value` / `this.supportTask` for its caller. Module context: Probes QEMU audio backends and configures media devices after checking architecture support.
   * 处理：通过 `inline().finally`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().finally`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.cache && this.cache.expires > Date.now()`; `!this.supportTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.cache.value`; `this.supportTask`.
   * 副作用 / Effects: 更新 / updates `this.supportTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async support() {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.value;
    if (!this.supportTask) this.supportTask = (async () => {
      const value = { none: await this.probe(this.machines, 'none'),
        dsound: await this.probe(this.machines, 'dsound') };
      this.cache = { expires: Date.now() + 5 * 60_000, value };
      return value;
    })().finally(() => { this.supportTask = undefined; });
    return this.supportTask;
  }
  /**
   * 入口 / Entry: MediaDevices.view.
   * 功能：在探测 QEMU 音频后端并配置实例媒体设备中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ vmId: id, vmName: vm.name, status: this.machines.state(id), audio: vm.hardware?.devices?.audio || 'none', audioBackend: vm.…` 供上层消费（`MediaDevices`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `MediaDevices`; this entry produces `{ vmId: id, vmName: vm.name, status: this.machines.state(id), audio: vm.hardware?.devices?.audio || 'none', audioBackend: vm.…` for its caller. Module context: Probes QEMU audio backends and configures media devices after checking architecture support.
   * 处理：通过 `this.machines.get`, `Promise.all`, `this.support`, `this.usb.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `Promise.all`, `this.support`, `this.usb.view`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) === 'running'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ vmId: id, vmName: vm.name, status: this.machines.state(id), audio: vm.hardware?.devices?.audio || 'none', audioBackend: vm.…`.
   * 副作用 / Effects: `this.machines.exec().catch`; `this.machines.exec`; `audio.replace().slice`; `audio.replace`; 更新 / updates `guest`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    const vm = this.machines.get(id);
    const [support, usb] = await Promise.all([this.support(), this.usb.view(id)]);
    let guest: { audio: string; video: string; error?: string } | null = null;
    if (this.machines.state(id) === 'running') {
      const result = await this.machines.exec(id,
        'printf "AUDIO\\n"; cat /proc/asound/cards 2>/dev/null || true; printf "VIDEO\\n"; ls /dev/video* 2>/dev/null || true',
        10000).catch((error) => ({ code: -1, stdout: '', stderr: String(error) }));
      const [audio = '', video = ''] = result.stdout.split('VIDEO\n');
      guest = { audio: audio.replace(/^AUDIO\n/, '').slice(0, 2000),
        video: video.slice(0, 2000), ...(result.code ? { error: result.stderr.slice(0, 500) } : {}) };
    }
    return { vmId: id, vmName: vm.name, status: this.machines.state(id),
      audio: vm.hardware?.devices?.audio || 'none',
      audioBackend: vm.hardware?.devices?.audioBackend || 'none',
      support, guest, usb };
  }
  /**
   * 入口 / Entry: MediaDevices.preview.
   * 功能：在探测 QEMU 音频后端并配置实例媒体设备中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: reasons.length === 0, reasons, vmId: id, vmName: vm.name, mode, before, after, previewToken, memoryMiB: vm.memoryMiB…` 供上层消费（`MediaDevices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MediaDevices`; this entry produces `{ ready: reasons.length === 0, reasons, vmId: id, vmName: vm.name, mode, before, after, previewToken, memoryMiB: vm.memoryMiB…` for its caller. Module context: Probes QEMU audio backends and configures media devices after checking architecture support.
   * 处理：通过 `this.machines.get`, `this.machines.requireUnlocked`, `this.support`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.requireUnlocked`, `this.support`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; mode: z.infer<typeof audioMode>
   * 输出 / Returns: `{ ready: reasons.length === 0, reasons, vmId: id, vmName: vm.name, mode, before, after, previewToken, memoryMiB: vm.memoryMiB…`.
   * 副作用 / Effects: `createHmac().update().digest`; `createHmac().update`; `createHmac`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async preview(id: string, mode: z.infer<typeof audioMode>) {
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    const support = await this.support();
    const backend = mode === 'host' ? 'dsound' : 'none';
    const reasons = [
      ...(vm.architecture === 'aarch64' && mode !== 'off'
        ? ['当前 ARM64 机型不支持 PCI HDA 声卡'] : []),
      ...(vm.sandbox ? ['临时实例不能更改硬件配置'] : []),
      ...(this.machines.state(id) !== 'stopped' ? ['请先停止实例'] : []),
      ...(mode !== 'off' && !support[backend].available
        ? [support[backend].reason || '宿主音频后端不可用'] : []),
    ];
    const before = vm.hardware || {};
    const devices = deviceProfileSchema.parse({ ...vm.hardware?.devices,
      audio: mode === 'off' ? 'none' : 'hda-duplex', audioBackend: backend });
    const after = hardwareSchema.parse({ ...vm.hardware, devices });
    const previewToken = createHmac('sha256', this.key).update(JSON.stringify({
      id, mode, memoryMiB: vm.memoryMiB, architecture: vm.architecture, before,
    })).digest('hex');
    return { ready: reasons.length === 0, reasons, vmId: id, vmName: vm.name,
      mode, before, after, previewToken, memoryMiB: vm.memoryMiB,
      architecture: vm.architecture, qemuAudioArguments: audioArguments({ ...vm, hardware: after }) };
  }
  /**
   * 入口 / Entry: MediaDevices.action.
   * 功能：在探测 QEMU 音频后端并配置实例媒体设备中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.preview(id, value.mode)` / `this.view(id)` 供上层消费（`MediaDevices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MediaDevices`; this entry produces `this.preview(id, value.mode)` / `this.view(id)` for its caller. Module context: Probes QEMU audio backends and configures media devices after checking architecture support.
   * 处理：通过 `mediaDeviceRequest.parse`, `this.preview`, `this.blocked`, `this.machines.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mediaDeviceRequest.parse`, `this.preview`, `this.blocked`, `this.machines.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.operation === 'preview-audio'`; `value.operation === 'save-usb'`; `value.operation === 'remove-usb'`.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.preview(id, value.mode)`; `this.view(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `value.operation !== 'apply-audio' && this.machines.get(id).architecture === 'aarch64'`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async action(id: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const value = mediaDeviceRequest.parse(input);
    if (value.operation === 'preview-audio') return this.preview(id, value.mode);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    if (value.operation !== 'apply-audio' && this.machines.get(id).architecture === 'aarch64')
      throw new AppError('当前 ARM64 机型未启用 USB 控制器', 409);
    this.mutation(1);
    try {
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
      if (value.operation === 'apply-audio') {
        const preview = await this.preview(id, value.mode);
        if (value.previewToken !== preview.previewToken)
          throw new AppError('音频配置预览已过期，请重新检查', 409);
        if (!preview.ready) throw new AppError(preview.reasons.join('；'), 409);
        await this.machines.configureHardware(id, preview.after,
          { hardware: preview.before, memoryMiB: preview.memoryMiB,
            architecture: preview.architecture });
        return this.view(id);
      }
      if (value.operation === 'save-usb') {
        await this.usb.action(id, { operation: 'save-rule', mediaKind: value.kind,
          vendorId: value.vendorId, productId: value.productId });
      } else if (value.operation === 'remove-usb')
        await this.usb.action(id, { operation: 'remove-rule', id: value.ruleId });
      else if (value.operation === 'attach-usb')
        await this.usb.action(id, { operation: 'apply-rule', id: value.ruleId });
      else await this.usb.action(id, { operation: 'detach', deviceId: value.deviceId });
      return this.view(id);
    } finally { this.mutation(-1); }
  }
  /**
   * 入口 / Entry: MediaDevices.close.
   * 功能：在探测 QEMU 音频后端并配置实例媒体设备中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`MediaDevices`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `MediaDevices`; the outcome is recorded in `this.closed`. Module context: Probes QEMU audio backends and configures media devices after checking architecture support.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  close() { this.closed = true; }
}
