/**
 * 模块职责：管理宿主目录共享配置与客户机挂载状态，关闭时收回对应共享资源。
 * Module purpose: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
 */
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { quote } from './shell.ts';
import { readStore, regularDirectory, within, writeStore } from './local-store.ts';
import { serveHostMount } from './host-mount-sftp.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

const policySchema = z.object({
  enabled: z.boolean(),
  hostPath: z.string().min(1).max(1024),
  readOnly: z.boolean(),
}).strict();
type Policy = z.infer<typeof policySchema>;
export const hostMountRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('mount') }).strict(),
  z.object({ operation: z.literal('unmount') }).strict(),
]);

const GUEST_PATH = '/mnt/sakura-host';
const KEY_DIR = '/etc/sakura/host-mount';
type HostServer = Awaited<ReturnType<typeof serveHostMount>>;
type Active = { server: HostServer; hostPath: string; readOnly: boolean; boot: object };
type Observation = { at: string; mounted: boolean; error?: string };
/**
 * 入口 / Entry: hostFile.
 * 功能：把本层请求转交 `join`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `join` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `join(DATA, 'host-mount.json')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const hostFile = () => join(DATA, 'host-mount.json');

export class HostMounts {
  private policies: Record<string, Policy> = {};
  private active = new Map<string, Active>();
  private observations = new Map<string, Observation>();
  private tasks = new Map<string, Promise<unknown>>();
  private writes = Promise.resolve();
  private timer?: ScheduleHandle;
  private tick?: Promise<void>;
  private closed = false;
  /**
   * 入口 / Entry: HostMounts.constructor.
   * 功能：建立 HostMounts 的管理宿主目录共享配置与客户机挂载状态上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HostMounts context for this module's responsibility: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines,
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {}) {}

  /**
   * 入口 / Entry: HostMounts.init.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，初始化并核对当前领域状态；处理结果记录到 `this.policies`, `this.timer`（`HostMounts`）。
   * Purpose: Initializes and verifies current domain state in `HostMounts`; the outcome is recorded in `this.policies`, `this.timer`. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `z.record().parse`, `z.record`, `z.uuid`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.record().parse`, `z.record`, `z.uuid`, `readStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.policies`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.policies = z.record(z.uuid(), policySchema).parse(
      await readStore(hostFile(), () => ({})));
    this.timer = scheduler.register({ owner: 'core:host-mount', label: '宿主共享目录状态校准', intervalMs: 10000,
      overlap: 'skip',
      /**
       * 入口 / Entry: HostMounts.init.run.
       * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.tick`（`HostMounts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; the outcome is recorded in `this.tick`. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
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
        this.tick = this.reconcile().finally(() => { this.tick = undefined; });
      await this.tick;
    } });
  }

  /**
   * 入口 / Entry: HostMounts.locked.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`HostMounts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; this entry produces `task` for its caller. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
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
    void task.finally(() => { if (this.tasks.get(id) === task) this.tasks.delete(id); })
      .catch(() => {});
    return task;
  }

  /**
   * 入口 / Entry: HostMounts.save.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，校验并提交领域状态变更；处理结果记录到 `this.writes`（`HostMounts`）。
   * Purpose: Validates and commits a domain state change in `HostMounts`; the outcome is recorded in `this.writes`. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; policy: Policy
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(id: string, policy: Policy) {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = { ...this.policies, [id]: policy };
      await writeStore(hostFile(), next);
      this.policies = next;
    });
    this.writes = operation;
    await operation;
  }

  /**
   * 入口 / Entry: HostMounts.guestMountType.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result.stdout.trim()` 供上层消费（`HostMounts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; this entry produces `result.stdout.trim()` for its caller. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.machines.exec`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.exec`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `result.stdout.trim()`.
   * 副作用 / Effects: `this.machines.exec`.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError('无法读取客户机挂载状态', 502)`.
   */
  private async guestMountType(id: string) {
    const result = await this.machines.exec(id,
      `awk '$2=="${GUEST_PATH}" {print $3; exit}' /proc/mounts`, 10_000);
    if (result.code !== 0) throw new AppError('无法读取客户机挂载状态', 502);
    return result.stdout.trim();
  }

  /**
   * 入口 / Entry: HostMounts.isActive.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!!active && this.machines.state(id) === 'running' && active.boot === this.machines.live.get(id)` 供上层消费（`HostMounts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; this entry produces `!!active && this.machines.state(id) === 'running' && active.boot === this.machines.live.get(id)` for its caller. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.active.get`, `this.machines.state`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.get`, `this.machines.state`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `!!active && this.machines.state(id) === 'running' && active.boot === this.machines.live.get(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private isActive(id: string) {
    const active = this.active.get(id);
    return !!active && this.machines.state(id) === 'running' &&
      active.boot === this.machines.live.get(id);
  }

  /**
   * 入口 / Entry: HostMounts.view.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy, guestPath: GUEST_PATH, running: this.machines.state(id) === 'running', mounted: this.isActive(id), observation: thi…` 供上层消费（`HostMounts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HostMounts`; this entry produces `{ policy, guestPath: GUEST_PATH, running: this.machines.state(id) === 'running', mounted: this.isActive(id), observation: thi…` for its caller. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.machines.get`, `this.machines.state`, `this.isActive`, `this.observations.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.state`, `this.isActive`, `this.observations.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ policy, guestPath: GUEST_PATH, running: this.machines.state(id) === 'running', mounted: this.isActive(id), observation: thi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    this.machines.get(id);
    const policy = this.policies[id] || { enabled: false, hostPath: '', readOnly: true };
    return { policy, guestPath: GUEST_PATH,
      running: this.machines.state(id) === 'running',
      mounted: this.isActive(id), observation: this.observations.get(id) || null };
  }

  /**
   * 入口 / Entry: HostMounts.action.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view(id)` 供上层消费（`HostMounts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; this entry produces `this.view(id)` for its caller. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `hostMountRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.blocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `hostMountRequest.parse`, `this.machines.get`, `this.machines.requireUnlocked`, `this.blocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.view(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async action(id: string, raw: unknown) {
    const input = hostMountRequest.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    try {
      /**
       * 入口 / Entry: HostMounts.action.callback@106.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.save`; 更新 / updates `input.policy.hostPath`.
       * 拒绝 / Refusals: 条件 / conditions `input.operation === 'configure'`; `input.policy.enabled`; `!(await lstat(hostPath).catch(() => null))?.isDirectory()`; 异常 / errors `new AppError('宿主共享目录不存在', 400)`; `new AppError('不能共享 Sakura 数据目录或其上级目录', 403)`.
       */
      await this.locked(id, async () => {
        if (input.operation === 'configure') {
          if (input.policy.enabled) {
            const hostPath = await regularDirectory(input.policy.hostPath);
            if (!(await lstat(hostPath).catch(() => null))?.isDirectory())
              throw new AppError('宿主共享目录不存在', 400);
            if (within(hostPath, DATA) || within(DATA, hostPath))
              throw new AppError('不能共享 Sakura 数据目录或其上级目录', 403);
            input.policy.hostPath = hostPath;
          }
          const old = this.policies[id];
          if (this.active.has(id) && (!input.policy.enabled ||
              old?.hostPath !== input.policy.hostPath ||
              old?.readOnly !== input.policy.readOnly)) await this.unmount(id);
          await this.save(id, input.policy);
          if (input.policy.enabled && this.machines.state(id) === 'running')
            await this.mount(id);
        } else if (input.operation === 'mount') {
          if (!this.policies[id]?.enabled) throw new AppError('请先启用宿主目录挂载策略', 409);
          await this.mount(id);
        } else {
          await this.unmount(id);
          if (this.policies[id]) await this.save(id, { ...this.policies[id], enabled: false });
        }
      }).catch((error) => {
        this.observations.set(id, { at: new Date().toISOString(), mounted: this.isActive(id),
          error: (error as Error).message });
        throw error;
      });
      return this.view(id);
    } finally { this.mutation(-1); }
  }

  /**
   * 入口 / Entry: HostMounts.mount.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostMounts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; this entry produces `void` for its caller. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.isActive`, `this.active.get`, `this.active.delete`, `stale.server.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.isActive`, `this.active.get`, `this.active.delete`, `stale.server.close`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.isActive(id)`; `stale`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.active.delete`; `stale.server.close`; `this.machines.exec`; `this.machines.writeGuestFile`; `this.active.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `!policy?.enabled`; `within(hostPath, DATA) || within(DATA, hostPath)`; 异常 / errors `new AppError('请先启动发行版', 409)`; `new AppError('未启用宿主目录挂载', 409)`.
   * 失败处理：catch 分支执行 `await server.close();`; `this.observations.set(id, { at: new Date().toISOString(), mounted: false, error: (error as Error).message });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await server.close();`; `this.observations.set(id, { at: new Date().toISOString(), mounted: false, error: (error as Error).message });`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async mount(id: string) {
    if (this.isActive(id)) return;
    const stale = this.active.get(id);
    if (stale) {
      this.active.delete(id);
      await stale.server.close();
    }
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    const policy = this.policies[id];
    if (!policy?.enabled) throw new AppError('未启用宿主目录挂载', 409);
    const hostPath = await regularDirectory(policy.hostPath);
    if (within(hostPath, DATA) || within(DATA, hostPath))
      throw new AppError('不能共享 Sakura 数据目录或其上级目录', 403);
    const server = await serveHostMount(hostPath, policy.readOnly);
    try {
      const currentType = await this.guestMountType(id);
      if (currentType && currentType !== 'fuse.sshfs')
        throw new AppError(`${GUEST_PATH} 已挂载其他文件系统`, 409);
      if (currentType === 'fuse.sshfs') {
        const unmounted = await this.machines.exec(id, `umount -l ${quote(GUEST_PATH)}`, 15_000);
        if (unmounted.code !== 0) throw new AppError(unmounted.stderr || '旧共享目录卸载失败', 409);
      }
      const distro = this.machines.get(id).distro || 'alpine';
      const install = distro === 'alpine'
        ? 'apk add --no-cache sshfs'
        : 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sshfs';
      const prepared = await this.machines.exec(id,
        `command -v sshfs >/dev/null || (${install}); modprobe fuse 2>/dev/null || true; test -c /dev/fuse; mkdir -p ${quote(KEY_DIR)} ${quote(GUEST_PATH)}; chmod 700 ${quote(KEY_DIR)}`,
        180_000);
      if (prepared.code !== 0)
        throw new AppError(prepared.stderr || '客户机安装 SSHFS/FUSE 失败', 502);
      const knownHosts = `[10.0.2.2]:${server.port} ${server.hostPublic.trim()}\n`;
      await this.machines.writeGuestFile(id, `${KEY_DIR}/id_ed25519`, server.clientPrivate);
      await this.machines.writeGuestFile(id, `${KEY_DIR}/known_hosts`, knownHosts);
      const secured = await this.machines.exec(id,
        `chmod 600 ${quote(KEY_DIR)}/id_ed25519 ${quote(KEY_DIR)}/known_hosts`, 10_000);
      if (secured.code !== 0) throw new AppError('客户机挂载密钥权限设置失败', 502);
      const command = `sshfs sakura-host@10.0.2.2:/ ${quote(GUEST_PATH)} -p ${server.port}` +
        ` -o IdentityFile=${KEY_DIR}/id_ed25519,UserKnownHostsFile=${KEY_DIR}/known_hosts,` +
        `StrictHostKeyChecking=yes,PasswordAuthentication=no,IdentitiesOnly=yes,` +
        `ConnectTimeout=5,ServerAliveInterval=10,ServerAliveCountMax=1` +
        (policy.readOnly ? ',ro' : '');
      const result = await this.machines.exec(id, command, 45_000);
      if (result.code !== 0) throw new AppError(result.stderr || 'SSHFS 挂载失败', 502);
      if (await this.guestMountType(id) !== 'fuse.sshfs')
        throw new AppError('客户机未确认 SSHFS 挂载', 502);
      this.active.set(id, { server, hostPath, readOnly: policy.readOnly,
        boot: this.machines.live.get(id)! });
      this.observations.set(id, { at: new Date().toISOString(), mounted: true });
    } catch (error) {
      await server.close();
      this.observations.set(id, { at: new Date().toISOString(), mounted: false,
        error: (error as Error).message });
      throw error;
    }
  }

  /**
   * 入口 / Entry: HostMounts.unmount.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostMounts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; the calls and state transitions below complete the operation. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.active.get`, `this.machines.state`, `this.guestMountType`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.get`, `this.machines.state`, `this.guestMountType`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.machines.exec`; `this.active.delete`; `active.server.close`; `this.observations.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) === 'running'`; `currentType === 'fuse.sshfs'`; `result.code !== 0`; 异常 / errors `new AppError(result.stderr || 'SSHFS 卸载失败', 502)`.
   */
  private async unmount(id: string) {
    const active = this.active.get(id);
    if (this.machines.state(id) === 'running') {
      const currentType = await this.guestMountType(id);
      if (currentType === 'fuse.sshfs') {
        const result = await this.machines.exec(id, `umount -l ${quote(GUEST_PATH)}`, 15_000);
        if (result.code !== 0) throw new AppError(result.stderr || 'SSHFS 卸载失败', 502);
      }
    }
    this.active.delete(id);
    await active?.server.close();
    this.observations.set(id, { at: new Date().toISOString(), mounted: false });
  }

  /**
   * 入口 / Entry: HostMounts.reconcile.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostMounts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostMounts`; this entry produces `void` for its caller. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.blocked`, `this.machines.live.get`, `this.machines.state`, `this.guestMountType().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.machines.live.get`, `this.machines.state`, `this.guestMountType().catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.blocked()`; `this.closed`; `!sameBoot || !running || await this.guestMountType(id).catch(() => '') !== 'fuse.sshfs'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async reconcile() {
    if (this.blocked()) return;
    for (const [id, active] of this.active) {
      if (this.closed) return;
      const sameBoot = active.boot === this.machines.live.get(id);
      const running = this.machines.state(id) === 'running';
      if (!sameBoot || !running ||
          await this.guestMountType(id).catch(() => '') !== 'fuse.sshfs') {
        /**
         * 入口 / Entry: HostMounts.reconcile.callback@218.
         * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.locked）。
         * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.locked).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `this.active.delete`; `active.server.close`; `this.observations.set`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        await this.locked(id, async () => {
          if (this.active.get(id) !== active) return;
          this.active.delete(id);
          await active.server.close();
          this.observations.set(id, { at: new Date().toISOString(), mounted: false,
            error: sameBoot && running ? '客户机共享目录已断开，等待重试' : undefined });
        }).catch(() => {});
      }
    }
    for (const [id, policy] of Object.entries(this.policies)) {
      if (this.closed) return;
      if (!policy.enabled || !this.machines.records.has(id) ||
        this.machines.state(id) !== 'running' || this.isActive(id) || this.tasks.has(id)) continue;
      const observed = this.observations.get(id);
      if (observed?.error && Date.now() - Date.parse(observed.at) < 60_000) continue;
      await this.locked(id, () => this.mount(id)).catch(() => {});
    }
  }

  /**
   * 入口 / Entry: HostMounts.close.
   * 功能：在管理宿主目录共享配置与客户机挂载状态中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`HostMounts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostMounts`; the outcome is recorded in `this.closed`. Module context: Owns host-share configuration and guest mount state, closing the corresponding sharing resources on shutdown.
   * 处理：通过 `this.timer.close`, `Promise.allSettled`, `this.tasks.values`, `this.active.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.close`, `Promise.allSettled`, `this.tasks.values`, `this.active.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.timer.close`; `active.server.close`; `this.active.clear`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.timer?.close();
    await this.tick;
    await Promise.allSettled([...this.tasks.values()]);
    await this.writes;
    for (const active of this.active.values()) await active.server.close();
    this.active.clear();
  }
}
