/**
 * 模块职责：“自动化与运维”插件的有类型服务引用（suite），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  suite: serviceRef('automation', 'suite', serviceContracts.FeatureSuite),
};
