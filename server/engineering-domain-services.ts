/**
 * 模块职责：创建工程领域的临时隧道服务，通过解析器读取可选可信启动和项目终端服务。
 * Module purpose: Creates engineering reverse tunnels and resolves optional trusted-boot and project-terminal services.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { ReverseTunnels } from './reverse-tunnels.ts';
import type { VmAccess } from './vm-access.ts';

import type { HostServiceResolver } from './host-service-contracts.ts';

export class EngineeringDomainServices {
  readonly tunnels: ReverseTunnels;
  /**
   * 入口 / Entry: EngineeringDomainServices.constructor.
   * 功能：建立 EngineeringDomainServices 的创建工程领域的临时隧道服务上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the EngineeringDomainServices context for this module's responsibility: Creates engineering reverse tunnels and resolves optional trusted-boot and project-terminal services. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: VmAccess; workspaces: WorkspacesV1; dependencies: HostServiceResolver
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.tunnels`.
   */
  constructor(machines: VmAccess, workspaces: WorkspacesV1, private dependencies: HostServiceResolver) {
    this.tunnels = new ReverseTunnels(machines, workspaces);
  }
  /**
   * 入口 / Entry: EngineeringDomainServices.trustedBoot.
   * 功能：把本层请求转交 `this.dependencies.optional`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.optional` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.optional('trustedBoot')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get trustedBoot() { return this.dependencies.optional('trustedBoot'); }
  /**
   * 入口 / Entry: EngineeringDomainServices.projectTerminals.
   * 功能：把本层请求转交 `this.dependencies.optional`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.optional` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.optional('projectTerminals')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get projectTerminals() { return this.dependencies.optional('projectTerminals'); }
  /**
   * 入口 / Entry: EngineeringDomainServices.close.
   * 功能：把本层请求转交 `this.tunnels.close`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.tunnels.close` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.tunnels.close()`.
   * 副作用 / Effects: `this.tunnels.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() { return this.tunnels.close(); }
}
