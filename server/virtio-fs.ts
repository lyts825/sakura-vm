/**
 * 模块职责：探测并管理 Virtio-FS 宿主共享与客户机挂载，核对后端支持及辅助进程资源。
 * Module purpose: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
 */
import { hostProcess } from './host-process.ts';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { BootAttachment } from './machines.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { DATA, ROOT } from './paths.ts';
import { type VMRecord } from '../shared/contracts/vm.ts';
import { quote } from './shell.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';
import { processSupervisor, type ManagedHelper } from './process-supervisor.ts';

type BinaryResult = { ok: boolean; output: string };
/**
 * 签名 / Signature: BinaryProbe.BinaryProbe.
 * 功能：为探测并管理 Virtio-FS 宿主共享与客户机挂载声明 BinaryProbe 的输入与结果契约，所属容器为 BinaryProbe。
 * Purpose: Declares the input/result contract for BinaryProbe in BinaryProbe. Module responsibility: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
 * 输入 / Inputs: file: string; args: string[]
 * 输出 / Returns: Promise<BinaryResult>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type BinaryProbe = (file: string, args: string[]) => Promise<BinaryResult>;
type Paths = { qemu: string; virtiofsd: string };
/**
 * 入口 / Entry: virtioFsPaths.
 * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ qemu: join( root, `qemu-system-${architecture === 'aarch64' ? 'aarch64' : 'x86_64'}${process.platform === 'win32' ? '.exe' …` 供上层消费（`virtio-fs.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `virtio-fs.ts`; this entry produces `{ qemu: join( root, `qemu-system-${architecture === 'aarch64' ? 'aarch64' : 'x86_64'}${process.platform === 'win32' ? '.exe' …` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
 * 处理：通过 `join`, `inline.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `inline.find`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: architecture: string
 * 输出 / Returns: Paths；结果来自 / values from `{ qemu: join( root, `qemu-system-${architecture === 'aarch64' ? 'aarch64' : 'x86_64'}${process.platform === 'win32' ? '.exe' …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const virtioFsPaths = (architecture: string): Paths => {
  const root = process.env.SAKURA_QEMU_DIR || join(ROOT, '.tools/qemu');
  const installedDaemon =
    process.platform === 'linux'
      ? ['/usr/libexec/virtiofsd', '/usr/lib/qemu/virtiofsd'].find(existsSync)
      : undefined;
  return {
    qemu: join(
      root,
      `qemu-system-${architecture === 'aarch64' ? 'aarch64' : 'x86_64'}${process.platform === 'win32' ? '.exe' : ''}`,
    ),
    virtiofsd: process.env.SAKURA_VIRTIOFSD_PATH || installedDaemon || 'virtiofsd',
  };
};
/**
 * 入口 / Entry: binaryProbe.
 * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` }` / `{ ok: false, output: '' }` 供上层消费（`virtio-fs.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `virtio-fs.ts`; this entry produces `{ ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` }` / `{ ok: false, output: '' }` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
 * 处理：通过 `hostProcess` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hostProcess`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file; args
 * 输出 / Returns: `{ ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` }`; `{ ok: false, output: '' }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.status === 503`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`; `return { ok: false, output: '' };`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; `return { ok: false, output: '' };`; these statements determine whether a failure is absorbed or rejected again.
 */
const binaryProbe: BinaryProbe = async (file, args) => {
  try {
    const result = await hostProcess('virtio-fs-probe', file, args, { timeout: 5000, maxBuffer: 256 * 1024 });
    return { ok: result.code === 0, output: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    if (error instanceof AppError && error.status === 503) throw error;
    return { ok: false, output: '' };
  }
};

export const guestVirtioFsScript = `set +e
printf 'VIRTIOFS='; if grep -qw virtiofs /proc/filesystems; then echo yes; else echo no; fi
printf '9P='; if grep -qw 9p /proc/filesystems; then echo yes; else echo no; fi
awk '($3=="virtiofs" || $3=="9p") {print "MOUNT=" $2 "|" $3 "|" $1}' /proc/mounts
`;

/**
 * 入口 / Entry: probeVirtioFsHost.
 * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ platform: process.platform, qemuVirtioFs: devices.ok && /\bvhost-user-fs-pci\b/.test(devices.output), qemuNineP: devices.ok…` 供上层消费（`virtio-fs.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `virtio-fs.ts`; this entry produces `{ platform: process.platform, qemuVirtioFs: devices.ok && /\bvhost-user-fs-pci\b/.test(devices.output), qemuNineP: devices.ok…` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
 * 处理：通过 `virtioFsPaths`, `Promise.all`, `probe`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `virtioFsPaths`, `Promise.all`, `probe`, `inline.test`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: architecture: string; paths: Paths optional; probe: BinaryProbe default=binaryProbe
 * 输出 / Returns: `{ platform: process.platform, qemuVirtioFs: devices.ok && /\bvhost-user-fs-pci\b/.test(devices.output), qemuNineP: devices.ok…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function probeVirtioFsHost(
  architecture: string,
  paths?: Paths,
  probe: BinaryProbe = binaryProbe,
) {
  const binaries = paths || virtioFsPaths(architecture);
  const [devices, memory, daemon] = await Promise.all([
    probe(binaries.qemu, ['-device', 'help']),
    probe(binaries.qemu, ['-object', 'help']),
    probe(binaries.virtiofsd, ['--version']),
  ]);
  return {
    platform: process.platform,
    qemuVirtioFs: devices.ok && /\bvhost-user-fs-pci\b/.test(devices.output),
    qemuNineP: devices.ok && /\bvirtio-9p-(?:pci|device)\b/.test(devices.output),
    sharedMemory: memory.ok && /\bmemory-backend-memfd\b/.test(memory.output),
    virtiofsd: daemon.ok,
  };
}

/**
 * 入口 / Entry: inspectVirtioFs.
 * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ready: blockers.length === 0, executed: false, checkedAt: new Date().toISOString(), host, guest, blockers, reason: blockers…` 供上层消费（`virtio-fs.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `virtio-fs.ts`; this entry produces `{ ready: blockers.length === 0, executed: false, checkedAt: new Date().toISOString(), host, guest, blockers, reason: blockers…` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
 * 处理：通过 `machines.get`, `signal.throwIfAborted`, `probeVirtioFsHost`, `machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.get`, `signal.throwIfAborted`, `probeVirtioFsHost`, `machines.state`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) === 'running'`; `result.code === 0`; `host.platform !== 'linux'`.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional; paths: Paths optional; probe: BinaryProbe default=binaryProbe
 * 输出 / Returns: `{ ready: blockers.length === 0, executed: false, checkedAt: new Date().toISOString(), host, guest, blockers, reason: blockers…`.
 * 副作用 / Effects: `machines.exec`; `blockers.push`; 更新 / updates `guest`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function inspectVirtioFs(
  machines: Machines,
  id: string,
  signal?: AbortSignal,
  paths?: Paths,
  probe: BinaryProbe = binaryProbe,
) {
  const vm = machines.get(id);
  signal?.throwIfAborted();
  const host = await probeVirtioFsHost(vm.architecture || 'x86_64', paths, probe);
  signal?.throwIfAborted();
  let guest: {
    virtioFsDriver: boolean;
    ninePDriver: boolean;
    mounts: Array<{ path: string; type: string; tag: string }>;
  } | null = null;
  if (machines.state(id) === 'running') {
    const result = await machines.exec(id, guestVirtioFsScript, 10000, signal);
    if (result.code === 0) {
      guest = {
        virtioFsDriver: /^VIRTIOFS=yes$/m.test(result.stdout),
        ninePDriver: /^9P=yes$/m.test(result.stdout),
        mounts: result.stdout
          .split(/\r?\n/)
          .filter((line) => line.startsWith('MOUNT='))
          .map((line) => line.slice(6).split('|'))
          .filter((parts) => parts.length === 3)
          .map(([path, type, tag]) => ({ path, type, tag })),
      };
    }
  }
  const blockers: string[] = [];
  if (host.platform !== 'linux') blockers.push('当前宿主平台未提供 Sakura 支持的 Virtio-FS 后端流程。');
  if (!host.qemuVirtioFs) blockers.push('当前 QEMU 构建缺少 vhost-user-fs 设备。');
  if (!host.sharedMemory) blockers.push('当前 QEMU 构建缺少共享内存后端。');
  if (!host.virtiofsd) blockers.push('未找到 virtiofsd 守护程序。');
  if (!guest) blockers.push('客户机未运行或无法读取文件系统证据。');
  else if (!guest.virtioFsDriver) blockers.push('客户机内核未声明 virtiofs 文件系统。');
  const mounted =
    guest?.mounts.some(
      (item) => item.type === 'virtiofs' && item.path === VIRTIOFS_GUEST_PATH && item.tag === VIRTIOFS_TAG,
    ) || false;
  if (!mounted) blockers.push('客户机尚未确认 Sakura Virtio-FS 挂载。');
  return {
    ready: blockers.length === 0,
    executed: false,
    checkedAt: new Date().toISOString(),
    host,
    guest,
    blockers,
    reason: blockers[0],
    message: '检查真实 Virtio-FS 挂载；SSHFS 宿主目录挂载不计入结果。',
  };
}

export const VIRTIOFS_TAG = 'sakura-host';
export const VIRTIOFS_GUEST_PATH = '/mnt/sakura-virtiofs';
const policySchema = z
  .object({ enabled: z.boolean(), hostPath: z.string().max(1024), readOnly: z.boolean() })
  .strict();
type Policy = z.infer<typeof policySchema>;
export const virtioFsRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('mount') }).strict(),
  z.object({ operation: z.literal('unmount') }).strict(),
]);
type Observation = { at: string; mounted: boolean; error?: string };
type Active = { boot: object;
/**
 * 签名 / Signature: Active.close.
 * 功能：为探测并管理 Virtio-FS 宿主共享与客户机挂载声明 close 的输入与结果契约，所属容器为 Active。
 * Purpose: Declares the input/result contract for close in Active. Module responsibility: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
close: () => Promise<void> };

/**
 * 入口 / Entry: virtioFsArguments.
 * 功能：从当前输入或状态计算 `[ '-object', `memory-backend-memfd,id=sakura-vfs-mem,size=${vm.memoryMiB}M,share=on`, '-numa', 'node,memdev=sakura-vfs-mem', …`，供调用方后续验证或使用。
 * Purpose: Computes `[ '-object', `memory-backend-memfd,id=sakura-vfs-mem,size=${vm.memoryMiB}M,share=on`, '-numa', 'node,memdev=sakura-vfs-mem', …` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: vm: Pick<VMRecord, 'memoryMiB'>; socketPath: string
 * 输出 / Returns: `[ '-object', `memory-backend-memfd,id=sakura-vfs-mem,size=${vm.memoryMiB}M,share=on`, '-numa', 'node,memdev=sakura-vfs-mem', …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function virtioFsArguments(vm: Pick<VMRecord, 'memoryMiB'>, socketPath: string) {
  /**
   * 入口 / Entry: virtioFsArguments.escape.
   * 功能：把本层请求转交 `value.replaceAll`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `value.replaceAll` and propagates the provider result or rejection.
   * 输入 / Inputs: value: string
   * 输出 / Returns: `value.replaceAll(',', ',,')`.
   * 副作用 / Effects: `value.replaceAll`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const escape = (value: string) => value.replaceAll(',', ',,');
  return [
    '-object',
    `memory-backend-memfd,id=sakura-vfs-mem,size=${vm.memoryMiB}M,share=on`,
    '-numa',
    'node,memdev=sakura-vfs-mem',
    '-chardev',
    `socket,id=sakura-vfs,path=${escape(socketPath)}`,
    '-device',
    `vhost-user-fs-pci,chardev=sakura-vfs,tag=${VIRTIOFS_TAG},queue-size=1024`,
  ];
}

export class VirtioFsShares {
  /**
   * 签名 / Signature: VirtioFsShares.unregisterBoot.
   * 功能：为探测并管理 Virtio-FS 宿主共享与客户机挂载声明 unregisterBoot 的输入与结果契约，所属容器为 VirtioFsShares。
   * Purpose: Declares the input/result contract for unregisterBoot in VirtioFsShares. Module responsibility: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unregisterBoot?: () => void;
  private policies: Record<string, Policy> = {};
  private active = new Map<string, Active>();
  private observations = new Map<string, Observation>();
  private tasks = new Map<string, Promise<unknown>>();
  private writes = Promise.resolve();
  private timer?: ScheduleHandle;
  private tick?: Promise<void>;
  private closed = false;
  private lifetime = new AbortController();
  private starting = new Set<Promise<BootAttachment | undefined>>();
  /**
   * 入口 / Entry: VirtioFsShares.constructor.
   * 功能：建立 VirtioFsShares 的探测并管理 Virtio-FS 宿主共享与客户机挂载上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the VirtioFsShares context for this module's responsibility: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
  ) {}

  /**
   * 入口 / Entry: VirtioFsShares.init.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，初始化并核对当前领域状态；处理结果记录到 `this.policies`, `this.unregisterBoot`, `this.timer`（`VirtioFsShares`）。
   * Purpose: Initializes and verifies current domain state in `VirtioFsShares`; the outcome is recorded in `this.policies`, `this.unregisterBoot`, `this.timer`. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `z.record().parse`, `z.record`, `z.uuid`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.record().parse`, `z.record`, `z.uuid`, `readStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `registerVmBootProvider`; `scheduler.register`; 更新 / updates `this.policies`, `this.unregisterBoot`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.policies = z
      .record(z.uuid(), policySchema)
      .parse(await readStore(join(DATA, 'virtio-fs.json'), () => ({})));
    this.unregisterBoot = registerVmBootProvider(this.machines, 'virtio-fs', {
    /**
     * 入口 / Entry: VirtioFsShares.init.prepare.
     * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`VirtioFsShares`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `task` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
     * 处理：通过 `this.prepare`, `this.starting.add`, `task.finally().catch`, `task.finally` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.prepare`, `this.starting.add`, `task.finally().catch`, `task.finally`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: vm; onExit
     * 输出 / Returns: `task`.
     * 副作用 / Effects: `this.starting.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    prepare: (vm, onExit) => {
      const task = this.prepare(vm, onExit);
      this.starting.add(task);
      void task.finally(() => this.starting.delete(task)).catch(() => {});
      return task;
    } });
    this.timer = scheduler.register({ owner: 'core:virtio-fs', label: 'Virtio-FS 共享目录状态校准', intervalMs: 10000,
      overlap: 'skip',
      /**
       * 入口 / Entry: VirtioFsShares.init.run.
       * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.tick`（`VirtioFsShares`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; the outcome is recorded in `this.tick`. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
       * 处理：通过 `this.reconcile().finally`, `this.reconcile` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.reconcile().finally`, `this.reconcile`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!this.tick && !this.closed`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `this.tick`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: async () => {
      if (!this.tick && !this.closed)
        this.tick = this.reconcile().finally(() => {
          this.tick = undefined;
        });
      await this.tick;
    } });
  }

  /**
   * 入口 / Entry: VirtioFsShares.locked.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `task` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.tasks.get`, `Promise.resolve`, `previous.catch().then`, `previous.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.tasks.get`, `Promise.resolve`, `previous.catch().then`, `previous.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `task`.
   * 副作用 / Effects: `this.tasks.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private locked<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tasks.get(id) || Promise.resolve();
    const task = previous.catch(() => {}).then(work);
    this.tasks.set(id, task);
    void task
      .finally(() => {
        if (this.tasks.get(id) === task) this.tasks.delete(id);
      })
      .catch(() => {});
    return task;
  }

  /**
   * 入口 / Entry: VirtioFsShares.validHostPath.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `resolved` 供上层消费（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `resolved` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `regularDirectory`, `inline.isDirectory`, `lstat().catch`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `regularDirectory`, `inline.isDirectory`, `lstat().catch`, `lstat`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: path: string
   * 输出 / Returns: `resolved`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!(await lstat(resolved).catch(() => null))?.isDirectory()`; `within(resolved, DATA) || within(DATA, resolved)`; 异常 / errors `new AppError('宿主共享目录不存在', 400)`; `new AppError('不能共享 Sakura 数据目录或其上级目录', 403)`.
   */
  private async validHostPath(path: string) {
    const resolved = await regularDirectory(path);
    if (!(await lstat(resolved).catch(() => null))?.isDirectory())
      throw new AppError('宿主共享目录不存在', 400);
    if (within(resolved, DATA) || within(DATA, resolved))
      throw new AppError('不能共享 Sakura 数据目录或其上级目录', 403);
    return resolved;
  }

  /**
   * 入口 / Entry: VirtioFsShares.save.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，校验并提交领域状态变更；处理结果记录到 `this.writes`（`VirtioFsShares`）。
   * Purpose: Validates and commits a domain state change in `VirtioFsShares`; the outcome is recorded in `this.writes`. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; policy: Policy
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(id: string, policy: Policy) {
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        const next = { ...this.policies, [id]: policy };
        await writeStore(join(DATA, 'virtio-fs.json'), next);
        this.policies = next;
      });
    this.writes = operation;
    await operation;
  }

  /**
   * 入口 / Entry: VirtioFsShares.prepare.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `{ args: virtioFsArguments(vm, socketPath), close: async () => { await close(); if (this.active.get(vm.id) === active) this.ac…` 供上层消费（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `undefined` / `{ args: virtioFsArguments(vm, socketPath), close: async () => { await close(); if (this.active.get(vm.id) === active) this.ac…` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.blocked`, `this.validHostPath`, `probeVirtioFsHost`, `mkdtemp` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.validHostPath`, `probeVirtioFsHost`, `mkdtemp`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!policy?.enabled`.
   * 输入 / Inputs: vm: VMRecord; onExit: (error: string) => void
   * 输出 / Returns: Promise<BootAttachment | undefined>；结果来自 / values from `undefined`; `{ args: virtioFsArguments(vm, socketPath), close: async () => { await close(); if (this.active.get(vm.id) === active) this.ac…`.
   * 副作用 / Effects: `AbortSignal.any`; `this.active.set`; `this.observations.set`; `close`; 更新 / updates `daemon`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.blocked()`; `process.platform !== 'linux' || vm.architecture === 'aarch64'`; `vm.hardware?.cpu?.numa || vm.hardware?.memory`; 异常 / errors `new AppError('Virtio-FS 暂不可启动', 409)`; `new AppError('Virtio-FS 目前需要 Linux x86_64 宿主和客户机', 503)`.
   * 失败处理：catch 分支执行 `try { await close(); } catch (cleanupError) { this.active.set(vm.id, { boot: boot!, close }); throw cleanupError; }`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `try { await close(); } catch (cleanupError) { this.active.set(vm.id, { boot: boot!, close }); throw cleanupError; }`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async prepare(vm: VMRecord, onExit: (error: string) => void): Promise<BootAttachment | undefined> {
    const policy = this.policies[vm.id];
    if (!policy?.enabled) return undefined;
    if (this.closed || this.blocked()) throw new AppError('Virtio-FS 暂不可启动', 409);
    if (process.platform !== 'linux' || vm.architecture === 'aarch64')
      throw new AppError('Virtio-FS 目前需要 Linux x86_64 宿主和客户机', 503);
    if (vm.hardware?.cpu?.numa || vm.hardware?.memory)
      throw new AppError('当前 Virtio-FS 配置不能与 NUMA 或内存热插拔同时使用', 409);
    const hostPath = await this.validHostPath(policy.hostPath);
    const host = await probeVirtioFsHost('x86_64');
    if (!host.qemuVirtioFs || !host.sharedMemory || !host.virtiofsd)
      throw new AppError('宿主 QEMU 或 virtiofsd 缺少 Virtio-FS 启动组件', 503);
    const dir = await mkdtemp(join(tmpdir(), 'sakura-vfs-'));
    const socketPath = join(dir, 'fs.sock');
    const boot = this.machines.live.get(vm.id);
    let daemon: ManagedHelper | undefined, cleanup: Promise<void> | undefined;
    /**
     * 入口 / Entry: VirtioFsShares.prepare.close.
     * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，结束、撤销或清理本次拥有的领域资源；本入口产生 `(cleanup ||= (async () => { await daemon?.close(); await rm(dir, { recursive: true, force: true }); })().catch((error) => { c…` 供上层消费（`VirtioFsShares`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `VirtioFsShares`; this entry produces `(cleanup ||= (async () => { await daemon?.close(); await rm(dir, { recursive: true, force: true }); })().catch((error) => { c…` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
     * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `(cleanup ||= (async () => { await daemon?.close(); await rm(dir, { recursive: true, force: true }); })().catch((error) => { c…`.
     * 副作用 / Effects: 更新 / updates `cleanup`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const close = () =>
      (cleanup ||= (async () => {
        await daemon?.close();
        await rm(dir, { recursive: true, force: true });
      })().catch((error) => {
        cleanup = undefined;
        throw error;
      }));
    try {
      daemon = await processSupervisor.helper({
        owner: `vm:${vm.id}`,
        helper: 'virtiofsd',
        label: 'Virtio-FS',
        file: virtioFsPaths('x86_64').virtiofsd,
        args: [
          '--socket-path',
          socketPath,
          '--shared-dir',
          hostPath,
          ...(policy.readOnly ? ['--readonly'] : []),
        ],
        signal: AbortSignal.any([this.lifetime.signal, ...(boot?.abort ? [boot.abort.signal] : [])]),
        /**
         * 入口 / Entry: VirtioFsShares.prepare.onExit.
         * 功能：把本层请求转交 `onExit`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `onExit` and propagates the provider result or rejection.
         * 输入 / Inputs: { code, signal, failure }
         * 输出 / Returns: `onExit(failure || `exit=${code}, signal=${signal}`)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        onExit: ({ code, signal, failure }) => onExit(failure || `exit=${code}, signal=${signal}`),
      });
      await daemon.ready(async () => !!(await lstat(socketPath).catch(() => null))?.isSocket());
      if (this.closed || this.machines.live.get(vm.id) !== boot) throw new AppError('实例启动已取消', 409);
      const active: Active = { boot: boot!, close };
      this.active.set(vm.id, active);
      this.observations.set(vm.id, { at: new Date().toISOString(), mounted: false });
      return {
        args: virtioFsArguments(vm, socketPath),
        /**
         * 入口 / Entry: VirtioFsShares.prepare.close.
         * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`VirtioFsShares`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `VirtioFsShares`; the calls and state transitions below complete the operation. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
         * 处理：通过 `close`, `this.active.get`, `this.active.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `close`, `this.active.get`, `this.active.delete`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.active.get(vm.id) === active`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `close`; `this.active.delete`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        close: async () => {
          await close();
          if (this.active.get(vm.id) === active) this.active.delete(vm.id);
        },
      };
    } catch (error) {
      try {
        await close();
      } catch (cleanupError) {
        this.active.set(vm.id, { boot: boot!, close });
        throw cleanupError;
      }
      throw error;
    }
  }

  /**
   * 入口 / Entry: VirtioFsShares.guestMount.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result.stdout.trim()` 供上层消费（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `result.stdout.trim()` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.machines.exec`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `result.stdout.trim()`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('无法读取客户机挂载状态', 502)`.
   */
  private async guestMount(id: string) {
    const result = await this.machines.exec(
      id,
      `awk '$2=="${VIRTIOFS_GUEST_PATH}" {print $1 "|" $3; exit}' /proc/mounts`,
      10_000,
    );
    if (result.code !== 0) throw new AppError('无法读取客户机挂载状态', 502);
    return result.stdout.trim();
  }

  /**
   * 入口 / Entry: VirtioFsShares.isActive.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!!active && active.boot === this.machines.live.get(id) && this.machines.state(id) === 'running'` 供上层消费（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `!!active && active.boot === this.machines.live.get(id) && this.machines.state(id) === 'running'` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.active.get`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.get`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `!!active && active.boot === this.machines.live.get(id) && this.machines.state(id) === 'running'`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private isActive(id: string) {
    const active = this.active.get(id);
    return !!active && active.boot === this.machines.live.get(id) && this.machines.state(id) === 'running';
  }

  /**
   * 入口 / Entry: VirtioFsShares.view.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy, guestPath: VIRTIOFS_GUEST_PATH, tag: VIRTIOFS_TAG, stopped: this.machines.state(id) === 'stopped', running: this.ma…` 供上层消费（`VirtioFsShares`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `VirtioFsShares`; this entry produces `{ policy, guestPath: VIRTIOFS_GUEST_PATH, tag: VIRTIOFS_TAG, stopped: this.machines.state(id) === 'stopped', running: this.ma…` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.machines.get`, `this.machines.state`, `this.isActive`, `this.observations.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.state`, `this.isActive`, `this.observations.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ policy, guestPath: VIRTIOFS_GUEST_PATH, tag: VIRTIOFS_TAG, stopped: this.machines.state(id) === 'stopped', running: this.ma…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    this.machines.get(id);
    const policy = this.policies[id] || { enabled: false, hostPath: '', readOnly: true };
    return {
      policy,
      guestPath: VIRTIOFS_GUEST_PATH,
      tag: VIRTIOFS_TAG,
      stopped: this.machines.state(id) === 'stopped',
      running: this.machines.state(id) === 'running',
      attached: this.isActive(id),
      mounted: this.isActive(id) && !!this.observations.get(id)?.mounted,
      observation: this.observations.get(id) || null,
    };
  }

  /**
   * 入口 / Entry: VirtioFsShares.action.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view(id)` 供上层消费（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `this.view(id)` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `virtioFsRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.blocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `virtioFsRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.blocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.view(id)`.
   * 副作用 / Effects: `this.observations.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `this.observations.set(id, { at: new Date().toISOString(), mounted: false, error: (error as Error).message, });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.observations.set(id, { at: new Date().toISOString(), mounted: false, error: (error as Error).message, });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async action(id: string, raw: unknown) {
    const input = virtioFsRequest.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    try {
      /**
       * 入口 / Entry: VirtioFsShares.action.callback@327.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.machines.exec`; `this.save`; `this.observations.set`.
       * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) === 'running' && this.isActive(id) && (await this.guestMount(id)) === `${VIRTIOFS_TAG}|virtiofs``; `result.code !== 0`; 异常 / errors `new AppError(result.stderr || 'Virtio-FS 卸载失败', 502)`.
       */
      await this.locked(id, async () => {
        if (input.operation === 'configure') {
          /**
           * 入口 / Entry: VirtioFsShares.action.callback@329.
           * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
           * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `this.save`; 更新 / updates `input.policy.hostPath`.
           * 拒绝 / Refusals: 条件 / conditions `input.policy.enabled`; `process.platform !== 'linux' || vm.architecture === 'aarch64'`; `vm.hardware?.cpu?.numa || vm.hardware?.memory`; 异常 / errors `new AppError('Virtio-FS 目前需要 Linux x86_64 宿主和客户机', 503)`; `new AppError('当前 Virtio-FS 配置不能与 NUMA 或内存热插拔同时使用', 409)`.
           */
          await this.machines.locked(id, async () => {
            this.machines.requireStopped(id);
            if (input.policy.enabled) {
              if (process.platform !== 'linux' || vm.architecture === 'aarch64')
                throw new AppError('Virtio-FS 目前需要 Linux x86_64 宿主和客户机', 503);
              if (vm.hardware?.cpu?.numa || vm.hardware?.memory)
                throw new AppError('当前 Virtio-FS 配置不能与 NUMA 或内存热插拔同时使用', 409);
              const host = await probeVirtioFsHost('x86_64');
              if (!host.qemuVirtioFs || !host.sharedMemory || !host.virtiofsd)
                throw new AppError('宿主 QEMU 或 virtiofsd 缺少 Virtio-FS 启动组件', 503);
              input.policy.hostPath = await this.validHostPath(input.policy.hostPath);
            }
            await this.save(id, input.policy);
          });
        } else if (input.operation === 'mount') {
          await this.mount(id);
        } else {
          if (
            this.machines.state(id) === 'running' &&
            this.isActive(id) &&
            (await this.guestMount(id)) === `${VIRTIOFS_TAG}|virtiofs`
          ) {
            const result = await this.machines.exec(id, `umount ${quote(VIRTIOFS_GUEST_PATH)}`, 15_000);
            if (result.code !== 0) throw new AppError(result.stderr || 'Virtio-FS 卸载失败', 502);
          }
          if (this.policies[id]) await this.save(id, { ...this.policies[id], enabled: false });
          this.observations.set(id, { at: new Date().toISOString(), mounted: false });
        }
      });
      return this.view(id);
    } catch (error) {
      this.observations.set(id, {
        at: new Date().toISOString(),
        mounted: false,
        error: (error as Error).message,
      });
      throw error;
    } finally {
      this.mutation(-1);
    }
  }

  /**
   * 入口 / Entry: VirtioFsShares.mount.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; the calls and state transitions below complete the operation. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.isActive`, `this.guestMount`, `this.machines.exec`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.isActive`, `this.guestMount`, `this.machines.exec`, `quote`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.machines.exec`; `this.observations.set`.
   * 拒绝 / Refusals: 条件 / conditions `!this.policies[id]?.enabled`; `!this.isActive(id)`; `current && current !== `${VIRTIOFS_TAG}|virtiofs``; 异常 / errors `new AppError('请先启用 Virtio-FS 策略', 409)`; `new AppError('请重启实例以附加 Virtio-FS 设备', 409)`.
   */
  private async mount(id: string) {
    if (!this.policies[id]?.enabled) throw new AppError('请先启用 Virtio-FS 策略', 409);
    if (!this.isActive(id)) throw new AppError('请重启实例以附加 Virtio-FS 设备', 409);
    const current = await this.guestMount(id);
    if (current && current !== `${VIRTIOFS_TAG}|virtiofs`)
      throw new AppError(`${VIRTIOFS_GUEST_PATH} 已挂载其他文件系统`, 409);
    if (!current) {
      const prepared = await this.machines.exec(
        id,
        `mkdir -p ${quote(VIRTIOFS_GUEST_PATH)}; grep -qw virtiofs /proc/filesystems || modprobe virtiofs`,
        10_000,
      );
      if (prepared.code !== 0) throw new AppError(prepared.stderr || '客户机缺少 virtiofs 驱动', 502);
      const command =
        `mount -t virtiofs ${this.policies[id].readOnly ? '-o ro ' : ''}` +
        `${VIRTIOFS_TAG} ${quote(VIRTIOFS_GUEST_PATH)}`;
      const result = await this.machines.exec(id, command, 30_000);
      if (result.code !== 0) throw new AppError(result.stderr || 'Virtio-FS 挂载失败', 502);
    }
    if ((await this.guestMount(id)) !== `${VIRTIOFS_TAG}|virtiofs`)
      throw new AppError('客户机未确认 Virtio-FS 挂载', 502);
    this.observations.set(id, { at: new Date().toISOString(), mounted: true });
  }

  /**
   * 入口 / Entry: VirtioFsShares.reconcile.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`VirtioFsShares`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `VirtioFsShares`; this entry produces `void` for its caller. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.blocked`, `this.machines.records.has`, `this.isActive`, `this.tasks.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.machines.records.has`, `this.isActive`, `this.tasks.has`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.blocked()`; `this.closed`; `!policy.enabled || !this.machines.records.has(id) || !this.isActive(id) || this.tasks.has(id)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async reconcile() {
    if (this.blocked()) return;
    for (const [id, policy] of Object.entries(this.policies)) {
      if (this.closed) return;
      if (!policy.enabled || !this.machines.records.has(id) || !this.isActive(id) || this.tasks.has(id))
        continue;
      const observed = this.observations.get(id);
      if (observed?.error && Date.now() - Date.parse(observed.at) < 60_000) continue;
      await this.locked(id, async () => {
        if ((await this.guestMount(id)) === `${VIRTIOFS_TAG}|virtiofs`) {
          this.observations.set(id, { at: new Date().toISOString(), mounted: true });
          return;
        }
        await this.mount(id);
      }).catch((error) =>
        this.observations.set(id, {
          at: new Date().toISOString(),
          mounted: false,
          error: (error as Error).message,
        }),
      );
    }
  }

  /**
   * 入口 / Entry: VirtioFsShares.close.
   * 功能：在探测并管理 Virtio-FS 宿主共享与客户机挂载中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`VirtioFsShares`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `VirtioFsShares`; the outcome is recorded in `this.closed`. Module context: Probes/owns Virtio-FS shares and guest mounts, checking backend availability and helper-process resources.
   * 处理：通过 `this.lifetime.abort`, `this.timer.close`, `Promise.allSettled`, `this.tasks.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifetime.abort`, `this.timer.close`, `Promise.allSettled`, `this.tasks.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.lifetime.abort`; `this.timer.close`; 更新 / updates `this.closed`.
   * 拒绝 / Refusals: 条件 / conditions `failed.length`; 异常 / errors `new AggregateError(failed, 'Virtio-FS 进程清理尚未确认')`.
   */
  async close() {
    this.closed = true;
    this.lifetime.abort();
    await this.timer?.close();
    await this.tick;
    await Promise.allSettled([...this.tasks.values()]);
    await this.writes;
    await Promise.allSettled([...this.starting]);
    // Machines closes its live QEMU processes after service cleanup.
    const cleanup = await Promise.allSettled(
      [...this.active].map(async ([id, entry]) => {
        await entry.close();
        if (this.active.get(id) === entry) this.active.delete(id);
      }),
    );
    this.unregisterBoot?.();
    const failed = cleanup.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (failed.length) throw new AggregateError(failed, 'Virtio-FS 进程清理尚未确认');
  }
}
import { registerVmBootProvider } from './vm-lifetime.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
