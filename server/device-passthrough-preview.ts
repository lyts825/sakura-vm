/**
 * 模块职责：生成 USB 与 PCI 设备的只读安全预览；检查声明和宿主能力，不连接实际设备。
 * Module purpose: Builds read-only USB/PCI safety previews from declarations and host capabilities; it does not attach devices.
 */
import { basename, join } from 'node:path';
import { readlink, readdir, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';

const usb = z
  .object({
    kind: z.literal('usb'),
    vendorId: z.number().int().min(1).max(0xffff),
    productId: z.number().int().min(1).max(0xffff),
  })
  .strict();
const pci = z
  .object({
    kind: z.literal('pci'),
    address: z.string().regex(/^[0-9a-f]{4}:[0-9a-f]{2}:[0-1][0-9a-f]\.[0-7]$/),
  })
  .strict();
export const passthroughDevice = z.discriminatedUnion('kind', [usb, pci]);
export const devicePassthroughInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('status') }).strict(),
  z.object({ mode: z.literal('preview'), device: passthroughDevice }).strict(),
]);

/** A read-only declaration preview. USB attachment uses the separate USB hotplug service. */
/**
 * 入口 / Entry: devicePassthroughPreview.
 * 功能：在生成 USB 与 PCI 设备的只读安全预览中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: true, executed: false, usbController: vm.architecture !== 'aarch64', pciHostSupported: hostPlatform === 'linux', mes…` / `{ ready: true, executed: action === 'run', device: input.device, prerequisitesMet: supported, checks: { guestUsbController: s…` 供上层消费（`device-passthrough-preview.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `device-passthrough-preview.ts`; this entry produces `{ ready: true, executed: false, usbController: vm.architecture !== 'aarch64', pciHostSupported: hostPlatform === 'linux', mes…` / `{ ready: true, executed: action === 'run', device: input.device, prerequisitesMet: supported, checks: { guestUsbController: s…` for its caller. Module context: Builds read-only USB/PCI safety previews from declarations and host capabilities; it does not attach devices.
 * 处理：通过 `devicePassthroughInput.parse`, `machines.get`, `join`, `stat().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `devicePassthroughInput.parse`, `machines.get`, `join`, `stat().catch`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `input.mode === 'status'`; `input.device.kind === 'usb'`.
 * 输入 / Inputs: machines: Machines; id: string; raw: unknown; action: 'check' | 'run'; sysfsRoot: default='/sys/bus/pci/devices'; hostPlatform: default=process.platform
 * 输出 / Returns: `{ ready: true, executed: false, usbController: vm.architecture !== 'aarch64', pciHostSupported: hostPlatform === 'linux', mes…`; `{ ready: true, executed: action === 'run', device: input.device, prerequisitesMet: supported, checks: { guestUsbController: s…`; `{ ready: true, executed: action === 'run', device: input.device, prerequisitesMet, checks: { linuxHost: hostPlatform === 'lin…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function devicePassthroughPreview(
  machines: Machines,
  id: string,
  raw: unknown,
  action: 'check' | 'run',
  sysfsRoot = '/sys/bus/pci/devices',
  hostPlatform = process.platform,
) {
  const input = devicePassthroughInput.parse(raw);
  const vm = machines.get(id);
  if (input.mode === 'status')
    return {
      ready: true,
      executed: false,
      usbController: vm.architecture !== 'aarch64',
      pciHostSupported: hostPlatform === 'linux',
      message:
        '提交 USB VID:PID 或 PCI BDF 声明以生成只读安全预览。实际 USB 连接请使用 USB 热插拔；此功能不会修改 QEMU 或宿主驱动。',
    };
  if (input.device.kind === 'usb') {
    const supported = vm.architecture !== 'aarch64';
    return {
      ready: true,
      executed: action === 'run',
      device: input.device,
      prerequisitesMet: supported,
      checks: {
        guestUsbController: supported,
        hostDevicePresent: null,
        exclusiveAccess: null,
        guestDriver: null,
      },
      nextAction: supported ? 'usb-hotplug' : null,
      reason: supported
        ? 'VID:PID 格式有效；宿主设备存在性、独占状态及客户机驱动仍需在 USB 热插拔时验证。'
        : '此 ARM64 机型尚未启用 USB 控制器。',
      message: '这是只读预览，未连接设备。',
    };
  }
  const address = input.device.address;
  const hostDevice = join(sysfsRoot, address);
  const exists = hostPlatform === 'linux' && Boolean(await stat(hostDevice).catch(() => null));
  const groupLink = exists ? await readlink(join(hostDevice, 'iommu_group')).catch(() => null) : null;
  const group = groupLink ? basename(groupLink) : null;
  const members =
    group && exists
      ? await readdir(join(hostDevice, 'iommu_group', 'devices')).catch(() => [] as string[])
      : [];
  const drivers = await Promise.all(
    members.map(async (member) => ({
      address: member,
      driver: basename(await readlink(join(sysfsRoot, member, 'driver')).catch(() => 'unbound')),
    })),
  );
  const prerequisitesMet =
    hostPlatform === 'linux' &&
    vm.architecture !== 'aarch64' &&
    exists &&
    !!group &&
    members.includes(address) &&
    drivers.every((item) => item.driver === 'vfio-pci');
  return {
    ready: true,
    executed: action === 'run',
    device: input.device,
    prerequisitesMet,
    checks: {
      linuxHost: hostPlatform === 'linux',
      guestArchitecture: vm.architecture || 'x86_64',
      hostDevicePresent: exists,
      iommuGroup: group,
      groupMembers: drivers,
    },
    reason: !exists
      ? '宿主 PCI 设备不可见；Windows 主机不支持此 Linux VFIO 预览。'
      : !group
        ? '宿主设备没有 IOMMU 分组，不可安全分配。'
        : drivers.some((item) => item.driver !== 'vfio-pci')
          ? 'IOMMU 组尚未全部绑定 vfio-pci；不可单独分配其中一个设备。'
          : 'VFIO 前置条件可见；Sakura 尚未将 PCI 设备加入 QEMU 启动配置。',
    message: '这是只读安全预览，未解绑宿主驱动，也未将 PCI 设备连接到实例。',
  };
}
