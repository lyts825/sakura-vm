import { join } from 'node:path';
import { z } from 'zod';
import { DATA, AppError, createSchema } from './model.ts';
import type { Machines } from './machines.ts';
import { readStore, writeStore } from './local-store.ts';
import { deviceProfileSchema, hardwareArguments } from '../shared/hardware.ts';
import { hostResources, resourcePolicy, saveResourcePolicy } from './resource-policies.ts';
import { distroInfo } from './images.ts';

const presetSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    memoryMiB: z.number().int().min(256).max(8192),
    cpus: z.number().int().min(1).max(8),
    diskGiB: z.number().int().min(2).max(128),
  })
  .strict();
const builtins = [
  { name: 'light', memoryMiB: 512, cpus: 1, diskGiB: 4 },
  { name: 'development', memoryMiB: 2048, cpus: 2, diskGiB: 16 },
  { name: 'build', memoryMiB: 4096, cpus: 4, diskGiB: 32 },
  { name: 'desktop', memoryMiB: 2048, cpus: 2, diskGiB: 16 },
];
export const resourceCapabilities = new Set([
  'resource-presets',
  'cpu-topology',
  'device-profiles',
  'resource-reservation',
  'vcpu-hotplug',
  'memory-hotplug',
  'ipv6',
]);
export async function resourceAction(
  machines: Machines,
  id: string,
  feature: string,
  p: any,
  signal: AbortSignal,
) {
  const vm = machines.get(id);
  if (feature === 'vcpu-hotplug' || feature === 'memory-hotplug') {
    if (p.mode === 'add' && p.target === undefined) throw new AppError('在线添加需要 target');
    if (p.mode === 'configure') {
      const hardware = { ...vm.hardware };
      if (feature === 'vcpu-hotplug') hardware.cpu = { sockets: 1, cores: p.maximum, threads: 1 };
      else hardware.memory = { maxMiB: p.maximum, slots: p.slots };
      return { vm: await machines.configureHardware(id, hardware), nextBoot: true };
    }
    return machines.hotplug(
      id,
      feature === 'vcpu-hotplug' ? 'cpu' : 'memory',
      p.mode === 'add' ? p.target : undefined,
      signal,
    );
  }
  if (feature === 'resource-reservation')
    return machines.locked('launch', async () => {
      if (p.mode === 'save') {
        for (const key of Object.keys(p.policy?.priorities || {})) machines.get(key);
        if (!p.policy) throw new AppError('保存需要 policy');
        await saveResourcePolicy(p.policy);
      }
      return {
        policy: await resourcePolicy(),
        host: hostResources(),
        running: [...machines.live.keys()].map((key) => {
          const record = machines.get(key);
          return { id: key, name: record.name, memoryMiB: record.memoryMiB, cpus: record.cpus };
        }),
      };
    });
  if (feature === 'ipv6') {
    if (p.mode === 'save') {
      if (vm.sandbox?.network === 'isolated' && p.enabled) throw new AppError('隔离沙箱不允许 IPv6 外网');
      await machines.configureHardware(id, { ...vm.hardware, ipv6: p.enabled });
    }
    const guest =
      machines.state(id) === 'running'
        ? await machines.exec(
            id,
            'ip -6 address show; ip -6 route show; cat /proc/sys/net/ipv6/conf/all/disable_ipv6',
            10000,
            signal,
          )
        : undefined;
    return {
      enabled: machines.get(id).hardware?.ipv6 !== false,
      isolated: vm.sandbox?.network === 'isolated',
      nextBoot: p.mode === 'save',
      guest,
    };
  }
  if (feature === 'cpu-topology') {
    if (p.mode === 'save' && !p.topology) throw new AppError('保存需要 topology');
    if (p.mode !== 'view')
      await machines.configureHardware(id, {
        ...vm.hardware,
        cpu: p.mode === 'reset' ? undefined : p.topology,
      });
    return {
      topology: machines.get(id).hardware?.cpu || null,
      arguments: hardwareArguments(machines.get(id)),
      nextBoot: p.mode !== 'view',
    };
  }
  if (feature === 'device-profiles')
    return machines.locked('device-profiles', async () => {
      const file = join(DATA, 'device-profiles.json');
      const entries = z
        .array(z.object({ name: z.string(), profile: deviceProfileSchema }).strict())
        .max(32)
        .parse(await readStore(file, () => []));
      if (p.mode === 'save') {
        if (!p.name || !p.profile) throw new AppError('保存需要 name 和 profile');
        const entry = entries.find((item) => item.name === p.name);
        if (entry) entry.profile = p.profile;
        else {
          if (entries.length >= 32) throw new AppError('最多保存 32 个设备档案');
          entries.push({ name: p.name, profile: p.profile });
        }
        await writeStore(file, entries);
      } else if (p.mode === 'delete') {
        if (!entries.some((entry) => entry.name === p.name)) throw new AppError('设备档案不存在', 404);
        entries.splice(
          entries.findIndex((entry) => entry.name === p.name),
          1,
        );
        await writeStore(file, entries);
      } else if (p.mode === 'apply') {
        const entry = entries.find((item) => item.name === p.name);
        if (!entry) throw new AppError('设备档案不存在', 404);
        await machines.configureHardware(id, { ...vm.hardware, devices: entry.profile });
      }
      return {
        profiles: entries,
        current: machines.get(id).hardware?.devices || deviceProfileSchema.parse({}),
        nextBoot: p.mode === 'apply',
      };
    });
  if (feature === 'resource-presets')
    return machines.locked('resource-presets', async () => {
      const file = join(DATA, 'resource-presets.json'),
        host = hostResources(),
        distro = distroInfo(vm.distro);
      const custom = z
        .array(presetSchema)
        .max(32)
        .parse(await readStore(file, () => []));
      if (p.mode === 'save') {
        const value = presetSchema.parse(p.preset);
        if (builtins.some((entry) => entry.name === value.name))
          throw new AppError('请为自定义预设选择其他名称');
        const index = custom.findIndex((entry) => entry.name === value.name);
        if (index >= 0) custom[index] = value;
        else {
          if (custom.length >= 32) throw new AppError('最多保存 32 个资源预设');
          custom.push(value);
        }
        await writeStore(file, custom);
      } else if (p.mode === 'delete') {
        const index = custom.findIndex((entry) => entry.name === p.name);
        if (index < 0) throw new AppError('自定义预设不存在', 404);
        custom.splice(index, 1);
        await writeStore(file, custom);
      } else if (p.mode === 'apply') {
        const preset = [...builtins, ...custom].find((entry) => entry.name === p.name);
        if (!preset) throw new AppError('资源预设不存在', 404);
        const hardware = { ...vm.hardware, cpu: undefined };
        if (hardware.memory && hardware.memory.maxMiB < preset.memoryMiB) hardware.memory = undefined;
        const config = createSchema.parse({
          name: vm.name,
          memoryMiB: Math.max(distro.minimumMemory, preset.memoryMiB),
          cpus: preset.cpus,
          diskGiB: vm.diskGiB,
          accelerator: vm.accelerator,
          distro: vm.distro,
          template: vm.template,
          forwards: vm.forwards,
          hardware,
        });
        machines.requireStopped(id);
        if (p.growDisk && preset.diskGiB > vm.diskGiB) {
          await machines.resize(id, preset.diskGiB, signal);
          config.diskGiB = preset.diskGiB;
        }
        await machines.update(id, config);
      }
      const desired = builtins.find((entry) => entry.name === p.workload) || builtins[1];
      const recommended = {
        ...desired,
        memoryMiB: Math.max(
          distro.minimumMemory,
          Math.min(desired.memoryMiB, Math.floor(host.totalMemoryMiB / 4 / 128) * 128),
        ),
        cpus: Math.min(desired.cpus, host.logicalCpus),
        diskGiB: Math.max(desired.diskGiB, distro.minimumDisk),
      };
      return {
        presets: [...builtins, ...custom],
        recommended,
        host,
        current: { memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGiB },
        note: '推荐按工作负载和宿主机容量计算；扩容需显式 growDisk，已有磁盘不会缩小。应用资源预设会重置 CPU 拓扑。',
      };
    });
  throw new AppError('未知资源操作');
}
