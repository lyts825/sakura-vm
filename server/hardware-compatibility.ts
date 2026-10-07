/**
 * 模块职责：生成实例硬件兼容性检查结果，覆盖网卡、架构及所选虚拟设备组合。
 * Module purpose: Builds VM hardware compatibility checks for network devices, architecture and selected virtual device combinations.
 */
import { deviceProfileSchema, hardwareIssues } from '../shared/hardware.ts';
import type { HardwareCapabilityRow as Row, HostHardwareReport } from '../shared/contracts/hardware-compatibility.ts';
import type { VmAccess as Machines } from './vm-access.ts';

type Probe = { ok: boolean; output: string; error?: string };

/**
 * 入口 / Entry: devices.
 * 功能：在生成实例硬件兼容性检查结果中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Set([...output.matchAll(/^name "([a-zA-Z0-9_-]+)"/gm)].map((match) => match[1]))` 供上层消费（`hardware-compatibility.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `hardware-compatibility.ts`; this entry produces `new Set([...output.matchAll(/^name "([a-zA-Z0-9_-]+)"/gm)].map((match) => match[1]))` for its caller. Module context: Builds VM hardware compatibility checks for network devices, architecture and selected virtual device combinations.
 * 处理：通过 `inline.map`, `output.matchAll` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.map`, `output.matchAll`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `new Set([...output.matchAll(/^name "([a-zA-Z0-9_-]+)"/gm)].map((match) => match[1]))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function devices(output: string) {
  return new Set([...output.matchAll(/^name "([a-zA-Z0-9_-]+)"/gm)].map((match) => match[1]));
}
/**
 * 入口 / Entry: accelerators.
 * 功能：在生成实例硬件兼容性检查结果中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Set( output .split(/\r?\n/) .map((line) => line.trim()) .filter((line) => /^(tcg|whpx)$/.test(line)), )` 供上层消费（`hardware-compatibility.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `hardware-compatibility.ts`; this entry produces `new Set( output .split(/\r?\n/) .map((line) => line.trim()) .filter((line) => /^(tcg|whpx)$/.test(line)), )` for its caller. Module context: Builds VM hardware compatibility checks for network devices, architecture and selected virtual device combinations.
 * 处理：通过 `output.split().map().filter`, `output.split().map`, `output.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `output.split().map().filter`, `output.split().map`, `output.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: output: string
 * 输出 / Returns: `new Set( output .split(/\r?\n/) .map((line) => line.trim()) .filter((line) => /^(tcg|whpx)$/.test(line)), )`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function accelerators(output: string) {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^(tcg|whpx)$/.test(line)),
  );
}
/**
 * 入口 / Entry: probe.
 * 功能：在生成实例硬件兼容性检查结果中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ok: true, output: await machines.engine.run('sakura-qemu', args, { signal, timeoutMs: 10000 }) }` / `{ ok: false, output: '', error: String((error as Error).message || error).slice(0, 500) }` 供上层消费（`hardware-compatibility.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `hardware-compatibility.ts`; this entry produces `{ ok: true, output: await machines.engine.run('sakura-qemu', args, { signal, timeoutMs: 10000 }) }` / `{ ok: false, output: '', error: String((error as Error).message || error).slice(0, 500) }` for its caller. Module context: Builds VM hardware compatibility checks for network devices, architecture and selected virtual device combinations.
 * 处理：通过 `machines.engine.run`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.engine.run`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; args: string[]; signal: AbortSignal optional
 * 输出 / Returns: Promise<Probe>；结果来自 / values from `{ ok: true, output: await machines.engine.run('sakura-qemu', args, { signal, timeoutMs: 10000 }) }`; `{ ok: false, output: '', error: String((error as Error).message || error).slice(0, 500) }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `return { ok: false, output: '', error: String((error as Error).message || error).slice(0, 500) };`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `return { ok: false, output: '', error: String((error as Error).message || error).slice(0, 500) };`; these statements determine whether a failure is absorbed or rejected again.
 */
async function probe(machines: Machines, args: string[], signal?: AbortSignal): Promise<Probe> {
  try {
    return { ok: true, output: await machines.engine.run('sakura-qemu', args, { signal, timeoutMs: 10000 }) };
  } catch (error) {
    signal?.throwIfAborted();
    return { ok: false, output: '', error: String((error as Error).message || error).slice(0, 500) };
  }
}

/** Reports host QEMU support and the current VM's selected settings; guest drivers remain unverified. */
/**
 * 入口 / Entry: hardwareCompatibility.
 * 功能：针对 VM 架构、固件与设备配置汇总硬件兼容性检查。
 * Purpose: Collects hardware compatibility checks for VM architecture, firmware and device settings.
 * 设计：只读检测宿主与 QEMU 支持；预览可用不代表设备已连接，实际配置动作另行准入。
 * Design: Read-only host/QEMU detection does not imply an attached device; configuration effects use separate admission.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: Promise<HostHardwareReport>；结果来自 / values from `{ ready: complete, checkedAt: new Date().toISOString(), qemuVersion: machines.engine.version, host: { platform: process.platf…`.
 * 副作用 / Effects: `issues.push`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function hardwareCompatibility(machines: Machines, id: string, signal?: AbortSignal): Promise<HostHardwareReport> {
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
