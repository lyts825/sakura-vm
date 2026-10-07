/**
 * 模块职责：装配并关闭平台领域服务，汇总清理失败以保留未完成的资源归属。
 * Module purpose: Assembles/closes platform services, collecting cleanup failures without hiding remaining ownership.
 */
import type { SnapshotMergeV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { StorageTiering } from './storage-tiering.ts';
import { ServiceMesh } from './service-mesh.ts';
import { VtpmEnrollment } from './vtpm-enrollment.ts';
import { AcmeRenewal } from './acme-renewal.ts';
import { TeamTemplates } from './team-templates.ts';
import { HaFailureMonitor } from './ha-failure-monitor.ts';
import type { VmAccess } from './vm-access.ts';

import type { HostServiceResolver } from './host-service-contracts.ts';
import type { ObjectBackup } from './object-backup.ts';
import type { WireGuardOverlay } from './wireguard-overlay.ts';

export type PlatformDomains = { objectBackup?: ObjectBackup; wireGuardOverlay?: WireGuardOverlay;
  /**
   * 签名 / Signature: PlatformDomains.snapshotMerge.
   * 功能：为装配并关闭平台领域服务声明 snapshotMerge 的输入与结果契约，所属容器为 PlatformDomains。
   * Purpose: Declares the input/result contract for snapshotMerge in PlatformDomains. Module responsibility: Assembles/closes platform services, collecting cleanup failures without hiding remaining ownership.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: SnapshotMergeV1 | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  snapshotMerge?: () => SnapshotMergeV1 | undefined };
/** Domain ownership is separate from the API/catalog composition facade. */
export class PlatformDomainServices {
  readonly storageTiering: StorageTiering; readonly serviceMesh: ServiceMesh;
  readonly vtpmEnrollment: VtpmEnrollment; readonly acmeRenewal: AcmeRenewal;
  readonly teamTemplates: TeamTemplates; readonly haFailureMonitor: HaFailureMonitor;
  /**
   * 入口 / Entry: PlatformDomainServices.constructor.
   * 功能：建立 PlatformDomainServices 的装配并关闭平台领域服务上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PlatformDomainServices context for this module's responsibility: Assembles/closes platform services, collecting cleanup failures without hiding remaining ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: VmAccess; workspaces: WorkspacesV1; dependencies: HostServiceResolver; policy: ConstructorParameters<typeof HaFailureMonitor>[1]; enabled: (id: string) => Promise<boolean>; optional: PlatformDomains
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.storageTiering`, `this.serviceMesh`, `this.vtpmEnrollment`, `this.acmeRenewal`.
   */
  constructor(machines: VmAccess, workspaces: WorkspacesV1, dependencies: HostServiceResolver,
    policy: ConstructorParameters<typeof HaFailureMonitor>[1], enabled: (id: string) => Promise<boolean>,
    readonly optional: PlatformDomains) {
    this.storageTiering = new StorageTiering(machines);
    this.serviceMesh = new ServiceMesh(machines, workspaces, undefined, enabled);
    this.vtpmEnrollment = new VtpmEnrollment(machines);
    this.acmeRenewal = new AcmeRenewal(machines, undefined, undefined, {
      /**
       * 入口 / Entry: PlatformDomainServices.constructor.allowed.
       * 功能：在装配并关闭平台领域服务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.optional('capabilityChecks')?.acmeAllowed() || false` 供上层消费（`PlatformDomainServices`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `PlatformDomainServices`; this entry produces `dependencies.optional('capabilityChecks')?.acmeAllowed() || false` for its caller. Module context: Assembles/closes platform services, collecting cleanup failures without hiding remaining ownership.
       * 处理：通过 `dependencies.optional().acmeAllowed`, `dependencies.optional` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.optional().acmeAllowed`, `dependencies.optional`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `dependencies.optional('capabilityChecks')?.acmeAllowed() || false`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      allowed: () => dependencies.optional('capabilityChecks')?.acmeAllowed() || false,
      /**
       * 入口 / Entry: PlatformDomainServices.constructor.mutation.
       * 功能：在装配并关闭平台领域服务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.optional('capabilityChecks')?.mutation(delta)` 供上层消费（`PlatformDomainServices`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `PlatformDomainServices`; this entry produces `dependencies.optional('capabilityChecks')?.mutation(delta)` for its caller. Module context: Assembles/closes platform services, collecting cleanup failures without hiding remaining ownership.
       * 处理：通过 `dependencies.optional().mutation`, `dependencies.optional` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.optional().mutation`, `dependencies.optional`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: delta
       * 输出 / Returns: `dependencies.optional('capabilityChecks')?.mutation(delta)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      mutation: delta => dependencies.optional('capabilityChecks')?.mutation(delta),
    });
    this.teamTemplates = new TeamTemplates(machines, workspaces);
    this.haFailureMonitor = new HaFailureMonitor(machines, policy);
  }
  /**
   * 入口 / Entry: PlatformDomainServices.init.
   * 功能：在装配并关闭平台领域服务中，初始化并核对当前领域状态；完成下述调用及状态处理（`PlatformDomainServices`）。
   * Purpose: Initializes and verifies current domain state in `PlatformDomainServices`; the calls and state transitions below complete the operation. Module context: Assembles/closes platform services, collecting cleanup failures without hiding remaining ownership.
   * 处理：通过 `this.storageTiering.init`, `this.serviceMesh.init`, `this.vtpmEnrollment.init`, `this.acmeRenewal.init` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.storageTiering.init`, `this.serviceMesh.init`, `this.vtpmEnrollment.init`, `this.acmeRenewal.init`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.close().catch`; `this.close`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `await this.close().catch(() => {});`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.close().catch(() => {});`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init() {
    try {
      await this.storageTiering.init(); await this.serviceMesh.init(); await this.vtpmEnrollment.init();
      await this.acmeRenewal.init(); await this.haFailureMonitor.init();
    } catch (error) { await this.close().catch(() => {}); throw error; }
  }
  /**
   * 入口 / Entry: PlatformDomainServices.close.
   * 功能：在装配并关闭平台领域服务中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`PlatformDomainServices`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PlatformDomainServices`; the calls and state transitions below complete the operation. Module context: Assembles/closes platform services, collecting cleanup failures without hiding remaining ownership.
   * 处理：通过 `Promise.allSettled`, `this.storageTiering.close`, `this.serviceMesh.close`, `this.vtpmEnrollment.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.allSettled`, `this.storageTiering.close`, `this.serviceMesh.close`, `this.vtpmEnrollment.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.storageTiering.close`; `this.serviceMesh.close`; `this.vtpmEnrollment.close`; `this.acmeRenewal.close`; `this.haFailureMonitor.close`.
   * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError(failures.map(item => item.reason), '平台领域服务清理未完成')`.
   */
  async close() {
    const outcomes = await Promise.allSettled([this.storageTiering.close(), this.serviceMesh.close(), this.vtpmEnrollment.close(),
      this.acmeRenewal.close(), this.haFailureMonitor.close(), this.optional.objectBackup?.close(), this.optional.wireGuardOverlay?.close()]);
    const failures = outcomes.filter(item => item.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(item => item.reason), '平台领域服务清理未完成');
  }
}
