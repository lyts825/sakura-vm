import { basename, join } from 'node:path';
import { readlink, readdir, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';

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
