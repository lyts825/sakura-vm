/**
 * 模块职责：“平台扩展适配器”插件的有类型服务引用（next），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  next: serviceRef('platform', 'next', serviceContracts.NextFeatures),
};
