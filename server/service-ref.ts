/**
 * 模块职责：定义带标识及版本的服务引用，使服务查找沿用明确的公共契约。
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
  [serviceType]?: (value: T) => T;
}>;

/** 返回类型由提供者的契约确定，消费者查找时不自行指定实现类型。 */
export type ServiceRef<T> = Readonly<{
  pluginId: string;
  key: string;
  version: number;
  contractId: string;
  contract?: ServiceContract<T>;
  [serviceType]?: (value: T) => T;
}>;

export function serviceRef<T>(pluginId: string, key: string, contract: ServiceContract<T>): ServiceRef<T>;
export function serviceRef<T = unknown>(pluginId: string, key: string, version?: number): ServiceRef<T>;
export function serviceRef<T>(pluginId: string, key: string, contract?: ServiceContract<T> | number): ServiceRef<T> {
  if (contract && typeof contract === 'object')
    return Object.freeze({ pluginId, key, version: contract.version, contractId: contract.id, contract });
  // 简便查找从提供者目录解析描述；注册新服务仍必须提供显式公共契约。
  return Object.freeze({ pluginId, key, version: contract || 1, contractId: '' });
}
