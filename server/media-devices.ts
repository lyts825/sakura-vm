import { createHmac, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { audioArguments, deviceProfileSchema, hardwareSchema } from '../shared/hardware.ts';
import type { Machines } from './machines.ts';
import type { UsbHotplug } from './usb-hotplug.ts';
import { AppError } from './model.ts';
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
  constructor(private machines: Machines, private usb: UsbHotplug,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private probe: typeof probeAudioBackend = probeAudioBackend) {}

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
  close() { this.closed = true; }
}
