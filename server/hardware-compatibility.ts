import { deviceProfileSchema, hardwareIssues } from '../shared/hardware.ts';
import type { Machines } from './machines.ts';

type Probe = { ok: boolean; output: string; error?: string };
type Row = { id: string; name: string; available: boolean; evidence: string; reason?: string };

function devices(output: string) {
  return new Set([...output.matchAll(/^name "([a-zA-Z0-9_-]+)"/gm)].map((match) => match[1]));
}
function accelerators(output: string) {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^(tcg|whpx)$/.test(line)),
  );
}
async function probe(machines: Machines, args: string[], signal?: AbortSignal): Promise<Probe> {
  try {
    return { ok: true, output: await machines.engine.run('sakura-qemu', args, { signal, timeoutMs: 10000 }) };
  } catch (error) {
    signal?.throwIfAborted();
    return { ok: false, output: '', error: String((error as Error).message || error).slice(0, 500) };
  }
}

/** Reports host QEMU support and the current VM's selected settings; guest drivers remain unverified. */
export async function hardwareCompatibility(machines: Machines, id: string, signal?: AbortSignal) {
  const vm = machines.get(id);
  const [deviceProbe, accelProbe, machineProbe] = await Promise.all([
    probe(machines, ['-device', 'help'], signal),
    probe(machines, ['-accel', 'help'], signal),
    probe(machines, ['-machine', 'help'], signal),
  ]);
  signal?.throwIfAborted();
  const names = devices(deviceProbe.output),
    accels = accelerators(accelProbe.output),
    q35 = /^pc-q35-[^\s]+/m.test(machineProbe.output);
  const deviceRows: Row[] = [
    ['virtio-net-pci', 'Virtio 网卡'],
    ['e1000', 'Intel e1000 网卡'],
    ['virtio-rng-pci', 'Virtio 随机数设备'],
    ['virtio-balloon-pci', 'Virtio 内存气球'],
    ['pc-dimm', '内存热插拔 DIMM'],
    ['virtio-gpu-pci', 'Virtio GPU 2D'],
    ['virtio-gpu-gl-pci', 'VirGL 3D 显卡'],
  ].map(([device, name]) => ({
    id: device,
    name,
    available: names.has(device),
    evidence: 'QEMU -device help',
    ...(!deviceProbe.ok ? { reason: deviceProbe.error } : {}),
  }));
  const acceleratorRows: Row[] = [
    {
      id: 'tcg',
      name: 'TCG 软件加速器',
      available: accels.has('tcg'),
      evidence: 'QEMU -accel help（编译支持）',
      ...(!accelProbe.ok ? { reason: accelProbe.error } : {}),
    },
    {
      id: 'whpx',
      name: 'WHPX 宿主加速器',
      available: accels.has('whpx') && machines.engine.whpxAvailable,
      evidence: 'QEMU -accel help 与启动时暂停虚机探测',
      ...(!accelProbe.ok
        ? { reason: accelProbe.error }
        : !machines.engine.whpxAvailable
          ? { reason: '宿主未通过 WHPX 实际启动探测' }
          : {}),
    },
  ];
  const machineRows: Row[] = [
    {
      id: 'q35',
      name: 'Q35 机器类型',
      available: q35,
      evidence: 'QEMU -machine help',
      ...(!machineProbe.ok ? { reason: machineProbe.error } : {}),
    },
  ];
  const profile = deviceProfileSchema.parse(vm.hardware?.devices || {});
  const accelerator =
    vm.accelerator === 'auto' ? (machines.engine.whpxAvailable ? 'whpx' : 'tcg') : vm.accelerator;
  const selectedDevices = [
    profile.networkCard,
    ...(profile.randomDevice ? ['virtio-rng-pci'] : []),
    ...(profile.balloon ? ['virtio-balloon-pci'] : []),
    ...(vm.hardware?.memory ? ['pc-dimm'] : []),
    ...(profile.graphics === 'none' ? [] : [profile.graphics === 'virgl'
      ? 'virtio-gpu-gl-pci' : 'virtio-gpu-pci']),
  ];
  const issues = hardwareIssues(vm);
  if (!q35) issues.push('当前 QEMU 未列出 Q35 机器类型');
  if (!accels.has(accelerator) || (accelerator === 'whpx' && !machines.engine.whpxAvailable))
    issues.push(`当前加速器 ${accelerator} 在宿主不可用`);
  for (const device of selectedDevices)
    if (!names.has(device)) issues.push(`当前配置需要的设备 ${device} 未由 QEMU 提供`);
  const complete = deviceProbe.ok && accelProbe.ok && machineProbe.ok;
  return {
    ready: complete,
    checkedAt: new Date().toISOString(),
    qemuVersion: machines.engine.version,
    host: { platform: process.platform, arch: process.arch },
    probes: {
      devices: deviceProbe.ok,
      accelerators: accelProbe.ok,
      machines: machineProbe.ok,
    },
    matrix: { devices: deviceRows, accelerators: acceleratorRows, machines: machineRows },
    current: {
      accelerator,
      networkCard: profile.networkCard,
      graphics: profile.graphics,
      selectedDevices,
      cpuTopology: vm.hardware?.cpu || null,
      memoryHotplug: vm.hardware?.memory || null,
      compatible: complete && issues.length === 0,
      issues,
    },
    limitation: '设备与 TCG 为 QEMU 二进制声明；WHPX 经宿主启动探测。客户机驱动和应用行为未在此矩阵中验证。',
  };
}
