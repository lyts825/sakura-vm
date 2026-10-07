/**
 * 模块职责：把资源能力请求分派到对应动作入口，校验目标和策略等动作必要输入。
 * Module purpose: Dispatches resource capability actions after checking required target/policy inputs.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import { createSchema } from '../shared/contracts/vm.ts';
import type { VmAccess as Machines } from './vm-access.ts';
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
/**
 * 入口 / Entry: resourceAction.
 * 功能：按资源能力选择在线热插拔、策略保存、内存目标或预留检查。
 * Purpose: Dispatches resource capabilities to hotplug, policy saves, memory targets or admission checks.
 * 设计：目标及模式先验证，宿主与发行版额度共同限制变更；配置效果由持锁实例领域执行。
 * Design: Targets/modes are validated and host/distribution limits constrain changes performed by the locked VM domain.
 * 输入 / Inputs: machines: Machines; id: string; feature: string; p: any; signal: AbortSignal
 * 输出 / Returns: `{ vm: await machines.configureHardware(id, hardware), nextBoot: true }`; `machines.hotplug( id, feature === 'vcpu-hotplug' ? 'cpu' : 'memory', p.mode === 'add' ? p.target : undefined, signal, )`; `machines.locked('launch', async () => { if (p.mode === 'save') { for (const key of Object.keys(p.policy?.priorities || {})) m…`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: `machines.exec`; 更新 / updates `hardware.cpu`, `hardware.memory`.
 * 拒绝 / Refusals: 条件 / conditions `feature === 'vcpu-hotplug' || feature === 'memory-hotplug'`; `p.mode === 'add' && p.target === undefined`; `feature === 'ipv6'`; 异常 / errors `new AppError('在线添加需要 target')`; `new AppError('隔离沙箱不允许 IPv6 外网')`.
 */
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
    /**
     * 入口 / Entry: resourceAction.callback@62.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked / launch）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked / launch).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ policy: await resourcePolicy(), host: hostResources(), running: [...machines.live.keys()].map((key) => { const record = mac…`.
     * 副作用 / Effects: `saveResourcePolicy`.
     * 拒绝 / Refusals: 条件 / conditions `p.mode === 'save'`; `!p.policy`; 异常 / errors `new AppError('保存需要 policy')`.
     */
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
    /**
     * 入口 / Entry: resourceAction.callback@112.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked / device-profiles）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked / device-profiles).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ profiles: entries, current: machines.get(id).hardware?.devices || deviceProfileSchema.parse({}), nextBoot: p.mode === 'appl…`.
     * 副作用 / Effects: `entries.push`; `writeStore`; `entries.splice`; 更新 / updates `entry.profile`.
     * 拒绝 / Refusals: 条件 / conditions `p.mode === 'save'`; `!p.name || !p.profile`; `entries.length >= 32`; 异常 / errors `new AppError('保存需要 name 和 profile')`; `new AppError('最多保存 32 个设备档案')`.
     */
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
    /**
     * 入口 / Entry: resourceAction.callback@146.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked / resource-presets）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked / resource-presets).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ presets: [...builtins, ...custom], recommended, host, current: { memoryMiB: vm.memoryMiB, cpus: vm.cpus, diskGiB: vm.diskGi…`.
     * 副作用 / Effects: `custom.push`; `writeStore`; `custom.splice`; `createSchema.parse`; `machines.update`; 更新 / updates `custom[index]`, `hardware.memory`, `config.diskGiB`.
     * 拒绝 / Refusals: 条件 / conditions `p.mode === 'save'`; `builtins.some((entry) => entry.name === value.name)`; `custom.length >= 32`; 异常 / errors `new AppError('请为自定义预设选择其他名称')`; `new AppError('最多保存 32 个资源预设')`.
     */
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
