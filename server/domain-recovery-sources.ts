/**
 * 模块职责：把备份、冷迁移和同步的持久领域票据接入恢复目录，依据原日志判断恢复状态。
 * Module purpose: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
 */
import type { DomainRecoveryPort, DomainRecoveryTicket } from '../shared/contracts/domain-recovery.ts';
import { recoveryBinding, type RecoveryBinding } from '../shared/contracts/recovery.ts';
import { AppError } from '../shared/errors.ts';
import { discoverBackupRecoveryTickets } from './backups.ts';
import { discoverColdMigrationRecoveryTickets } from './cold-migration.ts';
import { discoverSyncRecoveryTickets } from './sync.ts';
import type { RecoverySource } from './recovery-catalog.ts';

type Options = {
  /**
   * 签名 / Signature: Options.vmIds.
   * 功能：为把备份、冷迁移和同步的持久领域票据接入恢复目录声明 vmIds 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for vmIds in Options. Module responsibility: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: readonly string[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  vmIds(): readonly string[];
  /**
   * 签名 / Signature: Options.backups.
   * 功能：为把备份、冷迁移和同步的持久领域票据接入恢复目录声明 backups 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for backups in Options. Module responsibility: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: DomainRecoveryPort | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  backups?(): DomainRecoveryPort | undefined;
  /**
   * 签名 / Signature: Options.coldMigrations.
   * 功能：为把备份、冷迁移和同步的持久领域票据接入恢复目录声明 coldMigrations 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for coldMigrations in Options. Module responsibility: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: DomainRecoveryPort | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  coldMigrations?(): DomainRecoveryPort | undefined;
  /**
   * 签名 / Signature: Options.sync.
   * 功能：为把备份、冷迁移和同步的持久领域票据接入恢复目录声明 sync 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for sync in Options. Module responsibility: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: DomainRecoveryPort | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  sync?(): DomainRecoveryPort | undefined;
};
type Definition = {
  id: string;
  action: { id: string; title: string };
  /**
   * 签名 / Signature: Definition.port.
   * 功能：为把备份、冷迁移和同步的持久领域票据接入恢复目录声明 port 的输入与结果契约，所属容器为 Definition。
   * Purpose: Declares the input/result contract for port in Definition. Module responsibility: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: DomainRecoveryPort | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  port(): DomainRecoveryPort | undefined;
  /**
   * 签名 / Signature: Definition.scan.
   * 功能：为把备份、冷迁移和同步的持久领域票据接入恢复目录声明 scan 的输入与结果契约，所属容器为 Definition。
   * Purpose: Declares the input/result contract for scan in Definition. Module responsibility: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<DomainRecoveryTicket[]>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  scan(): Promise<DomainRecoveryTicket[]>;
  exactTerminalRevision?: boolean;
};
/**
 * 入口 / Entry: binding.
 * 功能：把本层请求转交 `recoveryBinding.parse`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `recoveryBinding.parse` and propagates the provider result or rejection.
 * 输入 / Inputs: domain: string; ticket: DomainRecoveryTicket
 * 输出 / Returns: RecoveryBinding；结果来自 / values from `recoveryBinding.parse({ domain, ticketId: ticket.id, owner: origin?.owner || 'domain:' + domain, vmId: ticket.vmId, projectId…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function binding(domain: string, ticket: DomainRecoveryTicket): RecoveryBinding {
  const origin = ticket.origin;
  return recoveryBinding.parse({ domain, ticketId: ticket.id, owner: origin?.owner || 'domain:' + domain,
    vmId: ticket.vmId, projectId: ticket.projectId, pluginId: origin?.pluginId,
    pluginInstanceId: origin?.pluginInstanceId, pluginGeneration: origin?.pluginGeneration,
    artifactDigest: origin?.artifactDigest, operationId: origin?.operationId });
}
/**
 * 入口 / Entry: key.
 * 功能：从当前输入或状态计算 `JSON.stringify(value)`，供调用方后续验证或使用。
 * Purpose: Computes `JSON.stringify(value)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: RecoveryBinding
 * 输出 / Returns: `JSON.stringify(value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const key = (value: RecoveryBinding) => JSON.stringify(value);
/**
 * 入口 / Entry: source.
 * 功能：从当前输入或状态计算 `{ id: definition.id, discover: async () => { const live = port(); let current: DomainRecoveryTicket[]; if (live) { try { curr…`，供调用方后续验证或使用。
 * Purpose: Computes `{ id: definition.id, discover: async () => { const live = port(); let current: DomainRecoveryTicket[]; if (live) { try { curr…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: definition: Definition
 * 输出 / Returns: RecoverySource；结果来自 / values from `{ id: definition.id, discover: async () => { const live = port(); let current: DomainRecoveryTicket[]; if (live) { try { curr…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function source(definition: Definition): RecoverySource {
  let tickets = new Map<string, DomainRecoveryTicket>();
  let terminal = new Map<string, DomainRecoveryTicket>();
  /**
   * 入口 / Entry: source.rememberTerminal.
   * 功能：在把备份、冷迁移和同步的持久领域票据接入恢复目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`domain-recovery-sources.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-sources.ts`; the calls and state transitions below complete the operation. Module context: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 处理：通过 `current.filter().map`, `current.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `current.filter().map`, `current.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: current: DomainRecoveryTicket[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `terminal`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const rememberTerminal = (current: DomainRecoveryTicket[]) => {
    terminal = new Map(current.filter(ticket => ticket.state === 'resolved')
      .map(ticket => [key(binding(definition.id, ticket)), ticket]));
  };
  /**
   * 入口 / Entry: source.port.
   * 功能：在把备份、冷迁移和同步的持久领域票据接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `definition.port()` / `undefined` 供上层消费（`domain-recovery-sources.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-sources.ts`; this entry produces `definition.port()` / `undefined` for its caller. Module context: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
   * 处理：通过 `definition.port` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `definition.port`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `definition.port()`; `undefined`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return undefined;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return undefined;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const port = () => { try { return definition.port(); } catch { return undefined; } };
  return {
    id: definition.id,
    /**
     * 入口 / Entry: source.discover.
     * 功能：在把备份、冷迁移和同步的持久领域票据接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current.filter(ticket => ticket.state === 'pending').map(ticket => ({ binding: binding(definition.id, ticket), ticketRevision…` 供上层消费（`domain-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-sources.ts`; this entry produces `current.filter(ticket => ticket.state === 'pending').map(ticket => ({ binding: binding(definition.id, ticket), ticketRevision…` for its caller. Module context: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
     * 处理：通过 `port`, `live.recoveryTickets`, `inline.map`, `definition.scan` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `port`, `live.recoveryTickets`, `inline.map`, `definition.scan`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `live`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `current.filter(ticket => ticket.state === 'pending').map(ticket => ({ binding: binding(definition.id, ticket), ticketRevision…`.
     * 副作用 / Effects: 更新 / updates `current`, `tickets`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `current = (await definition.scan()).map(ticket => ({ ...ticket, available: false }));`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `current = (await definition.scan()).map(ticket => ({ ...ticket, available: false }));`; these statements determine whether a failure is absorbed or rejected again.
     */
    discover: async () => {
      const live = port();
      let current: DomainRecoveryTicket[];
      if (live) {
        try { current = await live.recoveryTickets(); }
        catch { current = (await definition.scan()).map(ticket => ({ ...ticket, available: false })); }
      } else current = await definition.scan();
      rememberTerminal(current);
      tickets = new Map(current.map(ticket => [key(binding(definition.id, ticket)), ticket]));
      return current.filter(ticket => ticket.state === 'pending').map(ticket => ({
        binding: binding(definition.id, ticket), ticketRevision: ticket.revision, error: ticket.error,
        resourceIds: ticket.origin?.resourceIds || [],
        actions: live && ticket.available && !ticket.error ? [definition.action] : [],
      }));
    },
    /**
     * 入口 / Entry: source.recover.
     * 功能：在把备份、冷迁移和同步的持久领域票据接入恢复目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`domain-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-sources.ts`; the calls and state transitions below complete the operation. Module context: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
     * 处理：通过 `port`, `tickets.get`, `key`, `live.recoverTicket` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `port`, `tickets.get`, `key`, `live.recoverTicket`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: candidate; action
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!live || !ticket || !ticket.available || ticket.error || action !== definition.action.id || ticket.revision !== candidate.tic…`; 异常 / errors `new AppError('原领域票据或恢复服务当前不可用', 409, 'DOMAIN_RECOVERY_UNAVAILABLE')`.
     */
    recover: async (candidate, action) => {
      const live = port(), ticket = tickets.get(key(candidate.binding));
      if (!live || !ticket || !ticket.available || ticket.error || action !== definition.action.id ||
          ticket.revision !== candidate.ticketRevision)
        throw new AppError('原领域票据或恢复服务当前不可用', 409, 'DOMAIN_RECOVERY_UNAVAILABLE');
      await live.recoverTicket(ticket);
      // Read durable domain state once. Catalog confirmation never infers success from a missing file.
      rememberTerminal(await definition.scan());
    },
    /**
     * 入口 / Entry: source.confirmed.
     * 功能：在把备份、冷迁移和同步的持久领域票据接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!!ticket && (!definition.exactTerminalRevision || ticket.revision === record.ticketRevision)` 供上层消费（`domain-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-sources.ts`; this entry produces `!!ticket && (!definition.exactTerminalRevision || ticket.revision === record.ticketRevision)` for its caller. Module context: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
     * 处理：通过 `terminal.get`, `key` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `terminal.get`, `key`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: record
     * 输出 / Returns: `!!ticket && (!definition.exactTerminalRevision || ticket.revision === record.ticketRevision)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    confirmed: record => {
      const ticket = terminal.get(key(record.binding));
      return !!ticket && (!definition.exactTerminalRevision || ticket.revision === record.ticketRevision);
    },
  };
}

/** Static discovery survives disabled plugins; mutations always return to the owning domain. */
/**
 * 入口 / Entry: domainRecoverySources.
 * 功能：从当前输入或状态计算 `[ source({ id: 'backup-publication', action: { id: 'reconcile', title: '核对原备份发布日志' }, port: () => options.backups?.(), scan: …`，供调用方后续验证或使用。
 * Purpose: Computes `[ source({ id: 'backup-publication', action: { id: 'reconcile', title: '核对原备份发布日志' }, port: () => options.backups?.(), scan: …` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: options: Options
 * 输出 / Returns: RecoverySource[]；结果来自 / values from `[ source({ id: 'backup-publication', action: { id: 'reconcile', title: '核对原备份发布日志' }, port: () => options.backups?.(), scan: …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function domainRecoverySources(options: Options): RecoverySource[] {
  return [
    source({ id: 'backup-publication', action: { id: 'reconcile', title: '核对原备份发布日志' },
      /**
       * 入口 / Entry: domainRecoverySources.port.
       * 功能：把本层请求转交 `options.backups`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `options.backups` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `options.backups?.()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      port: () => options.backups?.(), scan: discoverBackupRecoveryTickets, exactTerminalRevision: true }),
    source({ id: 'cold-migration', action: { id: 'retry-copy', title: '重试原迁移复制并保留源实例' },
      /**
       * 入口 / Entry: domainRecoverySources.port.
       * 功能：把本层请求转交 `options.coldMigrations`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `options.coldMigrations` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `options.coldMigrations?.()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      port: () => options.coldMigrations?.(), scan: discoverColdMigrationRecoveryTickets }),
    source({ id: 'sync-checkpoint', action: { id: 'rollback', title: '回滚原同步检查点' },
      /**
       * 入口 / Entry: domainRecoverySources.port.
       * 功能：把本层请求转交 `options.sync`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `options.sync` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `options.sync?.()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      port: () => options.sync?.(),
      /**
       * 入口 / Entry: domainRecoverySources.scan.
       * 功能：在把备份、冷迁移和同步的持久领域票据接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `discoverSyncRecoveryTickets(options.vmIds())` 供上层消费（`domain-recovery-sources.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `domain-recovery-sources.ts`; this entry produces `discoverSyncRecoveryTickets(options.vmIds())` for its caller. Module context: Adapts durable backup, cold-migration and sync tickets to the recovery catalogue, using original journals as authority.
       * 处理：通过 `discoverSyncRecoveryTickets`, `options.vmIds` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `discoverSyncRecoveryTickets`, `options.vmIds`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `discoverSyncRecoveryTickets(options.vmIds())`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      scan: () => discoverSyncRecoveryTickets(options.vmIds()) }),
  ];
}
