import { z } from 'zod';

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

export function hardwareIssues(vm: HardwareVM) {
  const issues: string[] = [],
    cpu = vm.hardware?.cpu;
  if (vm.architecture === 'aarch64' && vm.hardware?.devices?.graphics &&
      vm.hardware.devices.graphics !== 'none')
    issues.push('当前 ARM64 机型不支持此 PCI 虚拟显卡配置');
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
export function deviceArguments(vm: HardwareVM) {
  const config = deviceProfileSchema.parse(vm.hardware?.devices || {});
  return [
    '-device',
    config.networkCard + ',netdev=sakura-net' + (config.networkCard === 'virtio-net-pci' ? ',vectors=4' : ''),
    ...(config.randomDevice ? ['-device', 'virtio-rng-pci'] : []),
    ...(config.balloon ? ['-device', 'virtio-balloon-pci'] : []),
    ...(config.graphics === 'none' ? [] : ['-device',
      config.graphics === 'virgl' ? 'virtio-gpu-gl-pci' : 'virtio-gpu-pci']),
  ];
}
export function diskOptions(vm: HardwareVM) {
  const config = deviceProfileSchema.parse(vm.hardware?.devices || {});
  return `cache=${config.diskCache},discard=${config.discard ? 'unmap' : 'ignore'},detect-zeroes=${config.discard ? 'unmap' : 'off'}`;
}
