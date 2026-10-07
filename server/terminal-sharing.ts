/**
 * 模块职责：管理终端共享授权、查看者和撤销，共享连接依据当前有效的运行会话绑定。
 * Module purpose: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority.
 */
import type { ProjectTerminalsV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectIdSchema } from './project-catalog.ts';

const sessionId = z.string().regex(/^[a-z0-9-]{1,48}$/);
const grant = z
  .object({
    id: z.uuid(),
    vmId: z.uuid(),
    session: sessionId,
    viewerId: z.uuid(),
    projectId: projectIdSchema.optional(),
    terminalId: z.uuid().optional(),
    createdAt: z.iso.datetime(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
const state = z.object({ version: z.literal(1), grants: z.array(grant).max(64) }).strict();
type Grant = z.infer<typeof grant>;

export const terminalShareInput = z
  .object({
    vmId: z.uuid(),
    session: sessionId,
    viewerId: z.uuid(),
    projectId: projectIdSchema.optional(),
    minutes: z.number().int().min(1).max(480).default(60),
  })
  .strict();

/** Explicit, expiring grants for read-only tmux attachments. */
export class TerminalSharing {
  private grants: Grant[] = [];
  private writes = Promise.resolve();
  private closed = false;
  /**
   * 入口 / Entry: TerminalSharing.terminals.
   * 功能：把本层请求转交 `this.resolveTerminals`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.resolveTerminals` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.resolveTerminals()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get terminals() {
    return this.resolveTerminals();
  }

  /**
   * 入口 / Entry: TerminalSharing.constructor.
   * 功能：建立 TerminalSharing 的管理终端共享授权、查看者和撤销上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the TerminalSharing context for this module's responsibility: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: default=join(DATA, 'terminal-sharing.json'); now: default=Date.now; resolveTerminals: () => ProjectTerminalsV1 | undefined default=() => undefined
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private file = join(DATA, 'terminal-sharing.json'),
    private now = Date.now,
    private resolveTerminals: () => ProjectTerminalsV1 | undefined = () => undefined,
  ) {}

  /**
   * 入口 / Entry: TerminalSharing.init.
   * 功能：在管理终端共享授权、查看者和撤销中，初始化并核对当前领域状态；处理结果记录到 `this.grants`（`TerminalSharing`）。
   * Purpose: Initializes and verifies current domain state in `TerminalSharing`; the outcome is recorded in `this.grants`. Module context: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority.
   * 处理：通过 `state.parse`, `readStore`, `this.grants.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `state.parse`, `readStore`, `this.grants.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.grants`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(this.grants.map((item) => item.id)).size !== this.grants.length`; 异常 / errors `new AppError('共享终端目录包含重复授权', 503)`.
   */
  async init() {
    this.grants = state.parse(await readStore(this.file, () => ({ version: 1, grants: [] }))).grants;
    if (new Set(this.grants.map((item) => item.id)).size !== this.grants.length)
      throw new AppError('共享终端目录包含重复授权', 503);
  }

  /**
   * 入口 / Entry: TerminalSharing.serial.
   * 功能：在管理终端共享授权、查看者和撤销中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`TerminalSharing`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TerminalSharing`; this entry produces `operation` for its caller. Module context: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `operation.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `operation.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('共享终端服务正在关闭', 503);
        return work();
      });
    this.writes = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  /**
   * 入口 / Entry: TerminalSharing.list.
   * 功能：从当前输入或状态计算 `this.grants.filter( (item) => item.expiresAt > this.now() && (!accountId || item.viewerId === accountId) && (!vmId || item.vm…`，供调用方后续验证或使用。
   * Purpose: Computes `this.grants.filter( (item) => item.expiresAt > this.now() && (!accountId || item.viewerId === accountId) && (!vmId || item.vm…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: accountId: string optional; vmId: string optional; projectId: string optional
   * 输出 / Returns: `this.grants.filter( (item) => item.expiresAt > this.now() && (!accountId || item.viewerId === accountId) && (!vmId || item.vm…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  list(accountId?: string, vmId?: string, projectId?: string) {
    return this.grants.filter(
      (item) =>
        item.expiresAt > this.now() &&
        (!accountId || item.viewerId === accountId) &&
        (!vmId || item.vmId === vmId) &&
        (projectId === undefined || item.projectId === projectId),
    );
  }

  /**
   * 入口 / Entry: TerminalSharing.find.
   * 功能：在管理终端共享授权、查看者和撤销中，执行此领域的具体处理步骤并返回其结果；本入口产生 `( this.list(viewerId, vmId).find( (item) => item.session === session && item.projectId === (projectId || undefined), ) || nul…` 供上层消费（`TerminalSharing`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TerminalSharing`; this entry produces `( this.list(viewerId, vmId).find( (item) => item.session === session && item.projectId === (projectId || undefined), ) || nul…` for its caller. Module context: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority.
   * 处理：通过 `this.list().find`, `this.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.list().find`, `this.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: viewerId: string; vmId: string; session: string; projectId: string | null optional
   * 输出 / Returns: `( this.list(viewerId, vmId).find( (item) => item.session === session && item.projectId === (projectId || undefined), ) || nul…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  find(viewerId: string, vmId: string, session: string, projectId?: string | null) {
    return (
      this.list(viewerId, vmId).find(
        (item) => item.session === session && item.projectId === (projectId || undefined),
      ) || null
    );
  }

  /**
   * 入口 / Entry: TerminalSharing.create.
   * 功能：在管理终端共享授权、查看者和撤销中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (this.machines.state(value.vmId) !== 'running') throw new AppError('请先启动实例和要共享的终端会话', 409); let …` 供上层消费（`TerminalSharing`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TerminalSharing`; this entry produces `this.serial(async () => { if (this.machines.state(value.vmId) !== 'running') throw new AppError('请先启动实例和要共享的终端会话', 409); let …` for its caller. Module context: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority.
   * 处理：通过 `terminalShareInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `terminalShareInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { if (this.machines.state(value.vmId) !== 'running') throw new AppError('请先启动实例和要共享的终端会话', 409); let …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async create(input: unknown) {
    const value = terminalShareInput.parse(input);
    /**
     * 入口 / Entry: TerminalSharing.create.callback@96.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `next`.
     * 副作用 / Effects: `this.machines.exec`; `writeStore`; 更新 / updates `{ projectId, terminalId }`, `this.grants`.
     * 拒绝 / Refusals: 条件 / conditions `this.machines.state(value.vmId) !== 'running'`; `value.projectId`; `found.code !== 0`; 异常 / errors `new AppError('请先启动实例和要共享的终端会话', 409)`; `new AppError('项目终端服务不可用', 503)`.
     */
    return this.serial(async () => {
      if (this.machines.state(value.vmId) !== 'running')
        throw new AppError('请先启动实例和要共享的终端会话', 409);
      let projectId: string | undefined;
      let terminalId: string | undefined;
      if (this.terminals)
        ({ projectId, terminalId } = await this.terminals.validate(
          value.vmId,
          value.projectId,
          value.session,
        ));
      else {
        if (value.projectId) throw new AppError('项目终端服务不可用', 503);
        const name = `sakura-terminal-${value.session}`;
        const found = await this.machines.exec(
          value.vmId,
          `command -v tmux >/dev/null && tmux has-session -t =${name}`,
          10_000,
        );
        if (found.code !== 0) throw new AppError('客户机中没有运行中的 tmux 终端会话；请先打开该终端', 409);
      }
      const current = this.grants.filter((item) => item.expiresAt > this.now());
      const existing = current.find(
        (item) =>
          item.vmId === value.vmId &&
          item.session === value.session &&
          item.viewerId === value.viewerId &&
          item.projectId === projectId,
      );
      if (!existing && current.length >= 64) throw new AppError('共享终端授权已达上限', 409);
      const next: Grant = {
        id: existing?.id || randomUUID(),
        vmId: value.vmId,
        session: value.session,
        viewerId: value.viewerId,
        ...(projectId ? { projectId } : {}),
        ...(terminalId ? { terminalId } : {}),
        createdAt: existing?.createdAt || new Date(this.now()).toISOString(),
        expiresAt: this.now() + value.minutes * 60_000,
      };
      const grants = [...current.filter((item) => item.id !== existing?.id), next];
      await writeStore(this.file, { version: 1, grants });
      this.grants = grants;
      return next;
    });
  }

  /**
   * 入口 / Entry: TerminalSharing.revoke.
   * 功能：在管理终端共享授权、查看者和撤销中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (!this.grants.some((item) => item.id === id)) throw new AppError('共享终端授权不存在', 404); const grants…` 供上层消费（`TerminalSharing`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TerminalSharing`; this entry produces `this.serial(async () => { if (!this.grants.some((item) => item.id === id)) throw new AppError('共享终端授权不存在', 404); const grants…` for its caller. Module context: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.serial(async () => { if (!this.grants.some((item) => item.id === id)) throw new AppError('共享终端授权不存在', 404); const grants…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async revoke(id: string) {
    z.uuid().parse(id);
    /**
     * 入口 / Entry: TerminalSharing.revoke.callback@145.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ revoked: id }`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.grants`.
     * 拒绝 / Refusals: 条件 / conditions `!this.grants.some((item) => item.id === id)`; 异常 / errors `new AppError('共享终端授权不存在', 404)`.
     */
    return this.serial(async () => {
      if (!this.grants.some((item) => item.id === id)) throw new AppError('共享终端授权不存在', 404);
      const grants = this.grants.filter((item) => item.id !== id);
      await writeStore(this.file, { version: 1, grants });
      this.grants = grants;
      return { revoked: id };
    });
  }

  /**
   * 入口 / Entry: TerminalSharing.revokeViewer.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: viewerId: string
   * 输出 / Returns: `this.serial(async () => { const grants = this.grants.filter((item) => item.viewerId !== viewerId); if (grants.length === this…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async revokeViewer(viewerId: string) {
    /**
     * 入口 / Entry: TerminalSharing.revokeViewer.callback@155.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.grants`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.serial(async () => {
      const grants = this.grants.filter((item) => item.viewerId !== viewerId);
      if (grants.length === this.grants.length) return;
      await writeStore(this.file, { version: 1, grants });
      this.grants = grants;
    });
  }

  /**
   * 入口 / Entry: TerminalSharing.close.
   * 功能：在管理终端共享授权、查看者和撤销中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`TerminalSharing`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `TerminalSharing`; the outcome is recorded in `this.closed`. Module context: Owns terminal shares/viewers/revocation, binding connections to currently valid runtime session authority.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() {
    this.closed = true;
    await this.writes;
  }
}
