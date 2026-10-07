/**
 * 模块职责（中文）：校验虚拟硬件配置并生成 QEMU 参数，报告架构、CPU、设备及资源组合的兼容问题。
 * Module responsibility (English): Validating virtual-hardware combinations and producing QEMU arguments.
 * 详细范围（中文）：公开入口包括 qemuCpuModel, cpuTopologySchema, deviceProfileSchema, hardwareSchema, Hardware, HardwareVM, hardwareIssues, hardwareArguments, deviceArguments, audioArguments, diskOptions；职责覆盖校验虚拟硬件组合并生成 QEMU 启动参数，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include qemuCpuModel, cpuTopologySchema, deviceProfileSchema, hardwareSchema, Hardware, HardwareVM, hardwareIssues, hardwareArguments, deviceArguments, audioArguments, diskOptions. The scope covers Validating virtual-hardware combinations and producing QEMU arguments. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

// Keep the named x86 model stable across hosts while supporting x86-64-v2.
/**
 * 中文：ARM64 选择 cortex-a57，其他架构使用 Nehalem-v1，保证模拟 CPU 默认模型可预测。
 * English: Select cortex-a57 for ARM64 and Nehalem-v1 otherwise, keeping emulated CPU defaults predictable.
 * 中文：输入：architecture：签名所示 'x86_64' | 'aarch64' 业务值
 * English: Inputs: architecture: the 'x86_64' | 'aarch64' domain value in the signature
 */
export function qemuCpuModel(architecture?: 'x86_64' | 'aarch64') {
  return architecture === 'aarch64' ? 'cortex-a57' : 'Nehalem-v1';
}

export const cpuTopologySchema = z
  .object({
    sockets: z.number().int().min(1).max(8).default(1),
    cores: z.number().int().min(1).max(8).default(2),
    threads: z.number().int().min(1).max(2).default(1),
    numa: z
      .array(
        z
          .object({
            memoryMiB: z.number().int().min(128).max(8192),
            cpus: z.array(z.number().int().min(0).max(7)).min(1).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .optional(),
  })
  .strict();
export const deviceProfileSchema = z
  .object({
    graphics: z.enum(['none', 'virtio-gpu', 'virgl']).default('none'),
    graphicsOutputs: z.number().int().min(1).max(4).optional(),
    graphicsWidth: z.number().int().min(640).max(3840).optional(),
    graphicsHeight: z.number().int().min(480).max(2160).optional(),
    graphicsMemoryMiB: z.number().int().min(64).max(1024).optional(),
    audio: z.enum(['none', 'hda-duplex']).optional(),
    audioBackend: z.enum(['none', 'dsound']).optional(),
    networkCard: z.enum(['virtio-net-pci', 'e1000']).default('virtio-net-pci'),
    randomDevice: z.boolean().default(true),
    balloon: z.boolean().default(true),
    diskCache: z.enum(['writeback', 'writethrough', 'none']).default('writeback'),
    discard: z.boolean().default(false),
  })
  .strict();
export const hardwareSchema = z
  .object({
    cpu: cpuTopologySchema.optional(),
    devices: deviceProfileSchema.optional(),
    memory: z
      .object({
        maxMiB: z.number().int().min(256).max(8192),
        slots: z.number().int().min(1).max(8).default(4),
      })
      .strict()
      .optional(),
    ipv6: z.boolean().optional(),
  })
  .strict();
export type Hardware = z.infer<typeof hardwareSchema>;
export type HardwareVM = { memoryMiB: number; cpus: number; hardware?: Hardware;
  architecture?: 'x86_64' | 'aarch64' };

/**
 * 中文：收集架构设备限制、CPU 拓扑/NUMA 分配与内存对齐问题；NUMA 需无重复覆盖全部插槽且内存和启动值一致，不能与当前热插拔内存组合。
 * English: Collect architecture/device restrictions, CPU-topology/NUMA allocation and memory-alignment issues. NUMA must uniquely cover all slots and match startup memory, and cannot combine with current memory hotplug.
 * 中文：输入：vm：签名所示 HardwareVM 业务值
 * English: Inputs: vm: the HardwareVM domain value in the signature
 */
export function hardwareIssues(vm: HardwareVM) {
  const issues: string[] = [],
    cpu = vm.hardware?.cpu;
  if (vm.architecture === 'aarch64' && vm.hardware?.devices?.graphics &&
      vm.hardware.devices.graphics !== 'none')
    issues.push('当前 ARM64 机型不支持此 PCI 虚拟显卡配置');
  if (vm.architecture === 'aarch64' && vm.hardware?.devices?.audio === 'hda-duplex')
    issues.push('当前 ARM64 机型不支持此 PCI 虚拟声卡配置');
  if (cpu) {
    const maximum = cpu.sockets * cpu.cores * cpu.threads;
    if (maximum < vm.cpus || maximum > 8) issues.push('CPU 拓扑总数必须大于等于启动 vCPU 数量且不超过 8');
    if (cpu.numa) {
      const assigned = cpu.numa.flatMap((node) => node.cpus);
      if (
        assigned.length !== maximum ||
        new Set(assigned).size !== maximum ||
        assigned.some((value) => value >= maximum)
      )
        issues.push('NUMA 节点需要不重复地分配全部 CPU 插槽');
      if (cpu.numa.reduce((sum, node) => sum + node.memoryMiB, 0) !== vm.memoryMiB)
        issues.push('NUMA 内存总和必须等于实例启动内存');
      if (vm.hardware?.memory) issues.push('NUMA 与当前内存热插拔配置不能同时启用');
    }
  }
  if (
    vm.hardware?.memory &&
    (vm.hardware.memory.maxMiB < vm.memoryMiB || vm.hardware.memory.maxMiB % 128 || vm.memoryMiB % 128)
  )
    issues.push('热插拔内存上限不能小于启动内存，两者需按 128 MiB 对齐');
  return issues;
}
/**
 * 中文：生成 QEMU 启动内存、vCPU 拓扑及 NUMA 后端参数数组，保留参数独立项而不拼接 shell 命令。
 * English: Build QEMU startup memory/vCPU topology/NUMA-backend argument arrays, retaining independent arguments rather than constructing shell commands.
 * 中文：输入：vm：签名所示 HardwareVM 业务值
 * English: Inputs: vm: the HardwareVM domain value in the signature
 */
export function hardwareArguments(vm: HardwareVM) {
  const cpu = vm.hardware?.cpu,
    memory = vm.hardware?.memory;
  const args = [
    '-m',
    memory ? `${vm.memoryMiB}M,slots=${memory.slots},maxmem=${memory.maxMiB}M` : String(vm.memoryMiB),
    '-smp',
    cpu
      ? `${vm.cpus},sockets=${cpu.sockets},cores=${cpu.cores},threads=${cpu.threads},maxcpus=${cpu.sockets * cpu.cores * cpu.threads}`
      : String(vm.cpus),
  ];
  for (const [index, node] of (cpu?.numa || []).entries())
    args.push(
      '-object',
      `memory-backend-ram,id=sakura-numa-${index},size=${node.memoryMiB}M`,
      '-numa',
      `node,nodeid=${index},memdev=sakura-numa-${index},${node.cpus.map((value) => `cpus=${value}`).join(',')}`,
    );
  return args;
}
/**
 * 中文：在校验虚拟硬件组合并生成 QEMU 启动参数流程中按指定 Schema 校验并解码；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Validating virtual-hardware combinations and producing QEMU arguments, validate/decode with the specified schema. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：vm：签名所示 HardwareVM 业务值
 * English: Inputs: vm: the HardwareVM domain value in the signature
 */
export function deviceArguments(vm: HardwareVM) {
  const config = deviceProfileSchema.parse(vm.hardware?.devices || {});
  const graphics = config.graphics === 'none' ? [] : ['-device',
    `${config.graphics === 'virgl' ? 'virtio-gpu-gl-pci' : 'virtio-gpu-pci'},` +
    `max_outputs=${config.graphicsOutputs ?? 1},xres=${config.graphicsWidth ?? 1280},` +
    `yres=${config.graphicsHeight ?? 800},max_hostmem=${config.graphicsMemoryMiB ?? 256}M`];
  return [
    '-device',
    config.networkCard + ',netdev=sakura-net' + (config.networkCard === 'virtio-net-pci' ? ',vectors=4' : ''),
    ...(config.randomDevice ? ['-device', 'virtio-rng-pci'] : []),
    ...(config.balloon ? ['-device', 'virtio-balloon-pci'] : []),
    ...graphics,
  ];
}
/**
 * 中文：在校验虚拟硬件组合并生成 QEMU 启动参数流程中按指定 Schema 校验并解码；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Validating virtual-hardware combinations and producing QEMU arguments, validate/decode with the specified schema. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：vm：签名所示 HardwareVM 业务值
 * English: Inputs: vm: the HardwareVM domain value in the signature
 */
export function audioArguments(vm: HardwareVM) {
  const config = deviceProfileSchema.parse(vm.hardware?.devices || {});
  if (config.audio !== 'hda-duplex') return [];
  return ['-audiodev', `${config.audioBackend || 'none'},id=sakura-audio`,
    '-device', 'ich9-intel-hda', '-device', 'hda-duplex,audiodev=sakura-audio'];
}
/**
 * 中文：在校验虚拟硬件组合并生成 QEMU 启动参数流程中按指定 Schema 校验并解码；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Validating virtual-hardware combinations and producing QEMU arguments, validate/decode with the specified schema. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：vm：签名所示 HardwareVM 业务值
 * English: Inputs: vm: the HardwareVM domain value in the signature
 */
export function diskOptions(vm: HardwareVM) {
  const config = deviceProfileSchema.parse(vm.hardware?.devices || {});
  return `cache=${config.diskCache},discard=${config.discard ? 'unmap' : 'ignore'},detect-zeroes=${config.discard ? 'unmap' : 'off'}`;
}
