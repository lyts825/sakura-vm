/**
 * 模块职责：创建自动化领域的软件包工作台，并通过解析器读取可选宿主服务。
 * Module purpose: Creates the automation package workbench and resolves optional host services through the declared resolver.
 */
import { PackageWorkbench } from './package-workbench.ts';
import type { VmAccess } from './vm-access.ts';
import type { HostServiceResolver } from './host-service-contracts.ts';

export class AutomationDomainServices {
  readonly packageWorkbench: PackageWorkbench;
  /**
   * 入口 / Entry: AutomationDomainServices.constructor.
   * 功能：建立 AutomationDomainServices 的创建自动化领域的软件包工作台上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the AutomationDomainServices context for this module's responsibility: Creates the automation package workbench and resolves optional host services through the declared resolver. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: VmAccess; task: ConstructorParameters<typeof PackageWorkbench>[1]; dependencies: HostServiceResolver
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.packageWorkbench`.
   */
  constructor(machines: VmAccess, task: ConstructorParameters<typeof PackageWorkbench>[1], private dependencies: HostServiceResolver) {
    this.packageWorkbench = new PackageWorkbench(machines, task);
  }
  /**
   * 入口 / Entry: AutomationDomainServices.processInterop.
   * 功能：把本层请求转交 `this.dependencies.optional`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.optional` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.optional('processInterop')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get processInterop() { return this.dependencies.optional('processInterop'); }
  /**
   * 入口 / Entry: AutomationDomainServices.mediaDevices.
   * 功能：把本层请求转交 `this.dependencies.optional`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.optional` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.optional('mediaDevices')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get mediaDevices() { return this.dependencies.optional('mediaDevices'); }
  /**
   * 入口 / Entry: AutomationDomainServices.hostMounts.
   * 功能：把本层请求转交 `this.dependencies.optional`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.optional` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.optional('hostMounts')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get hostMounts() { return this.dependencies.optional('hostMounts'); }
  /**
   * 入口 / Entry: AutomationDomainServices.projectTerminals.
   * 功能：把本层请求转交 `this.dependencies.optional`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.optional` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.dependencies.optional('projectTerminals')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get projectTerminals() { return this.dependencies.optional('projectTerminals'); }
}
