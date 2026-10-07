/**
 * 模块职责：定义带标识及版本的服务引用，使服务查找沿用明确的公共契约。
 * Module purpose: Defines versioned service references so lookup remains bound to explicit public contracts.
 */
declare const serviceType: unique symbol;

/** 提供者选择明确版本的接口及运行时成员描述；读取者不能自行扩大可见成员。 */
export type ServiceContract<T = unknown> = Readonly<{
  id: string;
  version: number;
  members: readonly string[];
  optional?: readonly string[];
  methods?: readonly string[];
  properties?: Readonly<Record<string, string | ServiceContract<any>>>;
  returns?: Readonly<Record<string, string | ServiceContract<any>>>;
  /**
   * 签名 / Signature: ServiceContract.[serviceType].
   * 功能：为定义带标识及版本的服务引用声明 [serviceType] 的输入与结果契约，所属容器为 ServiceContract。
   * Purpose: Declares the input/result contract for [serviceType] in ServiceContract. Module responsibility: Defines versioned service references so lookup remains bound to explicit public contracts.
   * 输入 / Inputs: value: T
   * 输出 / Returns: T.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  [serviceType]?: (value: T) => T;
}>;

/** 返回类型由提供者的契约确定，消费者查找时不自行指定实现类型。 */
export type ServiceRef<T> = Readonly<{
  pluginId: string;
  key: string;
  version: number;
  contractId: string;
  contract?: ServiceContract<T>;
  /**
   * 签名 / Signature: ServiceRef.[serviceType].
   * 功能：为定义带标识及版本的服务引用声明 [serviceType] 的输入与结果契约，所属容器为 ServiceRef。
   * Purpose: Declares the input/result contract for [serviceType] in ServiceRef. Module responsibility: Defines versioned service references so lookup remains bound to explicit public contracts.
   * 输入 / Inputs: value: T
   * 输出 / Returns: T.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  [serviceType]?: (value: T) => T;
}>;

/**
 * 签名 / Signature: serviceRef.
 * 功能：为定义带标识及版本的服务引用声明 serviceRef 的输入与结果契约，所属容器为 本模块。
 * Purpose: Declares the input/result contract for serviceRef in this module. Module responsibility: Defines versioned service references so lookup remains bound to explicit public contracts.
 * 输入 / Inputs: pluginId: string; key: string; contract: ServiceContract<T>
 * 输出 / Returns: ServiceRef<T>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export function serviceRef<T>(pluginId: string, key: string, contract: ServiceContract<T>): ServiceRef<T>;
/**
 * 签名 / Signature: serviceRef.
 * 功能：为定义带标识及版本的服务引用声明 serviceRef 的输入与结果契约，所属容器为 本模块。
 * Purpose: Declares the input/result contract for serviceRef in this module. Module responsibility: Defines versioned service references so lookup remains bound to explicit public contracts.
 * 输入 / Inputs: pluginId: string; key: string; version: number optional
 * 输出 / Returns: ServiceRef<T>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export function serviceRef<T = unknown>(pluginId: string, key: string, version?: number): ServiceRef<T>;
/**
 * 入口 / Entry: serviceRef.
 * 功能：在定义带标识及版本的服务引用中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Object.freeze({ pluginId, key, version: contract.version, contractId: contract.id, contract })` / `Object.freeze({ pluginId, key, version: contract || 1, contractId: '' })` 供上层消费（`service-ref.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-ref.ts`; this entry produces `Object.freeze({ pluginId, key, version: contract.version, contractId: contract.id, contract })` / `Object.freeze({ pluginId, key, version: contract || 1, contractId: '' })` for its caller. Module context: Defines versioned service references so lookup remains bound to explicit public contracts.
 * 分支 / Branches: `contract && typeof contract === 'object'`.
 * 输入 / Inputs: pluginId: string; key: string; contract: ServiceContract<T> | number optional
 * 输出 / Returns: ServiceRef<T>；结果来自 / values from `Object.freeze({ pluginId, key, version: contract.version, contractId: contract.id, contract })`; `Object.freeze({ pluginId, key, version: contract || 1, contractId: '' })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function serviceRef<T>(pluginId: string, key: string, contract?: ServiceContract<T> | number): ServiceRef<T> {
  if (contract && typeof contract === 'object')
    return Object.freeze({ pluginId, key, version: contract.version, contractId: contract.id, contract });
  // 简便查找从提供者目录解析描述；注册新服务仍必须提供显式公共契约。
  return Object.freeze({ pluginId, key, version: contract || 1, contractId: '' });
}
