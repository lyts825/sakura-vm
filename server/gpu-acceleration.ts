/**
 * 模块职责：检查客户机 GPU 驱动可见性并执行验证，设备配置仍依赖停机后的硬件档案。
 * Module purpose: Checks guest GPU visibility and driver support; device selection still requires stopped-VM hardware configuration.
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';

export const gpuAccelerationInput = z.object({
  mode: z.enum(['status', 'install-mesa']).default('status'),
}).strict();

/**
 * 入口 / Entry: checkGpuAcceleration.
 * 功能：在检查客户机 GPU 驱动可见性并执行验证中，核对调用资格、输入或资源归属；本入口产生 `{ ready: false, executed: false, graphics, reason: '请在停止实例后通过虚拟设备档案选择 Virtio GPU 或 VirGL，并重新启动。' }` / `{ ready: false, executed: false, graphics, reason: '请启动实例以验证客户机显卡驱动。' }` 供上层消费（`gpu-acceleration.ts`）。
 * Purpose: Checks admission, input or resource ownership in `gpu-acceleration.ts`; this entry produces `{ ready: false, executed: false, graphics, reason: '请在停止实例后通过虚拟设备档案选择 Virtio GPU 或 VirGL，并重新启动。' }` / `{ ready: false, executed: false, graphics, reason: '请启动实例以验证客户机显卡驱动。' }` for its caller. Module context: Checks guest GPU visibility and driver support; device selection still requires stopped-VM hardware configuration.
 * 处理：通过 `machines.get`, `machines.state`, `machines.exec`, `kernel.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.get`, `machines.state`, `machines.exec`, `kernel.stdout.trim`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `graphics === 'none'`; `machines.state(id) !== 'running'`; `graphics === 'virtio-gpu'`.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, graphics, reason: '请在停止实例后通过虚拟设备档案选择 Virtio GPU 或 VirGL，并重新启动。' }`; `{ ready: false, executed: false, graphics, reason: '请启动实例以验证客户机显卡驱动。' }`; `{ ready: result.code === 0, executed: false, graphics, reason: result.code === 0 ? 'Virtio GPU 的 DRM 设备已就绪；此模式不提供 VirGL 3D。' …`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: `machines.exec`; `inline.exec()[...].trim`; `inline.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function checkGpuAcceleration(machines: Machines, id: string,
  signal?: AbortSignal) {
  const vm = machines.get(id);
  const graphics = vm.hardware?.devices?.graphics || 'none';
  if (graphics === 'none')
    return { ready: false, executed: false, graphics,
      reason: '请在停止实例后通过虚拟设备档案选择 Virtio GPU 或 VirGL，并重新启动。' };
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, graphics,
      reason: '请启动实例以验证客户机显卡驱动。' };
  if (graphics === 'virtio-gpu') {
    const result = await machines.exec(id,
      'test -e /dev/dri/card0 && dmesg | grep -q "Initialized virtio_gpu"', 10000, signal);
    return { ready: result.code === 0, executed: false, graphics,
      reason: result.code === 0 ? 'Virtio GPU 的 DRM 设备已就绪；此模式不提供 VirGL 3D。' :
        '客户机尚未识别 Virtio GPU DRM 设备。' };
  }
  const drm = await machines.exec(id, 'test -e /dev/dri/renderD128', 10000, signal);
  if (drm.code !== 0) {
    const kernel = await machines.exec(id, 'uname -r', 10000, signal);
    return { ready: false, executed: false, graphics, renderer: null,
      kernel: kernel.stdout.trim(),
      reason: '客户机没有 Virtio GPU 渲染节点；Debian/Ubuntu 云内核可能缺少 virtio_gpu 模块。运行 install-mesa 安装驱动内核后重启。' };
  }
  const result = await machines.exec(id,
    'command -v eglinfo >/dev/null && EGL_PLATFORM=gbm eglinfo -p gbm -B',
    30000, signal);
  const renderer = /renderer:\s*([^\r\n]+)/i.exec(result.stdout)?.[1]?.trim();
  const direct = /^virgl\b/i.test(renderer || '');
  const gbmDriver = /GBM platform:\s*EGL API version:\s*[0-9.]+[\s\S]*?EGL driver name:\s*virtio_gpu\b/i
    .test(result.stdout);
  const virglFeature = !renderer && gbmDriver && (await machines.exec(id,
    'dmesg | grep -q "features: +virgl"', 10000, signal)).code === 0;
  const ready = direct || virglFeature;
  return { ready, executed: false, graphics, renderer: renderer || null,
    verifiedBy: direct ? 'gl-renderer' : virglFeature ? 'gbm-driver-and-virgl-device' : null,
    exitCode: result.code, diagnostic: (result.stdout + '\n' + result.stderr).slice(-2000),
    reason: direct ? '客户机 Mesa 已通过 GBM 实际使用 VirGL 渲染。' :
      virglFeature ? '客户机 GBM 使用 Virtio GPU EGL 驱动，内核设备已协商 VirGL。' :
      result.code !== 0 ? '客户机需要 Virtio GPU 驱动及 Mesa EGL 工具；可执行 install-mesa。' :
        '检测到的渲染器不是 VirGL；不会把软件渲染报告为 GPU 加速。' };
}

/**
 * 入口 / Entry: runGpuAcceleration.
 * 功能：在检查客户机 GPU 驱动可见性并执行验证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code: result.ready ? 0 : 1, ...result }` / `{ code: 0, ready: true, executed: true, verified: false, pendingReboot: true, graphics: 'virgl' as const, reason: 'Mesa 和通用内核…` 供上层消费（`gpu-acceleration.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpu-acceleration.ts`; this entry produces `{ code: result.ready ? 0 : 1, ...result }` / `{ code: 0, ready: true, executed: true, verified: false, pendingReboot: true, graphics: 'virgl' as const, reason: 'Mesa 和通用内核…` for its caller. Module context: Checks guest GPU visibility and driver support; device selection still requires stopped-VM hardware configuration.
 * 处理：通过 `gpuAccelerationInput.parse`, `checkGpuAcceleration`, `machines.requireUnlocked`, `machines.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `gpuAccelerationInput.parse`, `checkGpuAcceleration`, `machines.requireUnlocked`, `machines.get`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `options.mode === 'status'`; `!checked.ready && 'kernel' in checked && checked.kernel?.includes('cloud')`.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; signal: AbortSignal optional
 * 输出 / Returns: `{ code: result.ready ? 0 : 1, ...result }`; `{ code: 0, ready: true, executed: true, verified: false, pendingReboot: true, graphics: 'virgl' as const, reason: 'Mesa 和通用内核…`; `{ code: checked.ready ? 0 : 1, ...checked, executed: true }`.
 * 副作用 / Effects: `machines.exec`; `installed.stderr.slice`.
 * 拒绝 / Refusals: 条件 / conditions `machines.get(id).hardware?.devices?.graphics !== 'virgl'`; `machines.state(id) !== 'running'`; `installed.code !== 0`; 异常 / errors `new AppError('请先在停止实例后选择 VirGL 虚拟显卡', 409)`; `new AppError('请先启动实例', 409)`.
 */
export async function runGpuAcceleration(machines: Machines, id: string, input: unknown,
  signal?: AbortSignal) {
  const options = gpuAccelerationInput.parse(input);
  if (options.mode === 'status') {
    const result = await checkGpuAcceleration(machines, id, signal);
    return { code: result.ready ? 0 : 1, ...result };
  }
  machines.requireUnlocked(id);
  if (machines.get(id).hardware?.devices?.graphics !== 'virgl')
    throw new AppError('请先在停止实例后选择 VirGL 虚拟显卡', 409);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  const setup = [
    'set -e',
    'if command -v apk >/dev/null; then',
    '  apk add --no-cache mesa-utils mesa-dri-gallium mesa-egl libdrm',
    'elif command -v apt-get >/dev/null; then',
    '  . /etc/os-release',
    '  apt-get update',
    '  if [ "$ID" = ubuntu ]; then',
    '    DEBIAN_FRONTEND=noninteractive apt-get install -y mesa-utils-extra libegl1 libgl1-mesa-dri linux-image-generic',
    '  else',
    '    DEBIAN_FRONTEND=noninteractive apt-get install -y mesa-utils-extra libegl1-mesa libgl1-mesa-dri linux-image-amd64',
    '    kernel=$(basename "$(ls /boot/vmlinuz-*-amd64 | grep -v cloud | sort -V | tail -1)")',
    '    kernel=${kernel#vmlinuz-}',
    '    case "$kernel" in ""|*[!a-zA-Z0-9._+-]*) exit 1;; esac',
    '    grep -Fq "with Linux $kernel" /boot/grub/grub.cfg',
    '    cp -n /etc/default/grub /etc/default/grub.sakura-gpu.bak',
    '    sed -i "/^GRUB_DEFAULT=/d" /etc/default/grub',
    `    printf 'GRUB_DEFAULT="Advanced options for Debian GNU/Linux>Debian GNU/Linux, with Linux %s"\\n' "$kernel" >> /etc/default/grub`,
    '    update-grub',
    '  fi',
    'else exit 1; fi',
  ].join('\n');
  const installed = await machines.exec(id,
    setup,
    600000, signal);
  if (installed.code !== 0)
    throw new AppError('客户机 Mesa 安装失败：' + installed.stderr.slice(-1000), 409);
  const checked = await checkGpuAcceleration(machines, id, signal);
  if (!checked.ready && 'kernel' in checked && checked.kernel?.includes('cloud'))
    return { code: 0, ready: true, executed: true, verified: false,
      pendingReboot: true, graphics: 'virgl' as const,
      reason: 'Mesa 和通用内核已安装；请重启实例，再运行 status 验证 VirGL 渲染器。' };
  return { code: checked.ready ? 0 : 1, ...checked, executed: true };
}
