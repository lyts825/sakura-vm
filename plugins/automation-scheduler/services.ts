/**
 * 模块职责：“自动化调度”插件的有类型服务引用（scheduler），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  scheduler: serviceRef('automation-scheduler', 'scheduler', serviceContracts.FeatureScheduler),
};
