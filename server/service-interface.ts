/**
 * 模块职责：保留服务接口类型的兼容入口，公共契约定义统一来自 ServiceRef 模块。
 * Module purpose: Preserves the service-interface compatibility export; the ServiceRef module owns public contract types.
 */
/** Public service interfaces are owned independently of implementations in service-contracts/v1.ts. */
export type { ServiceContract } from './service-ref.ts';
