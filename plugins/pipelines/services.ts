/**
 * 模块职责：“项目流水线”插件的有类型服务引用（pipelines），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  pipelines: serviceRef('pipelines', 'pipelines', serviceContracts.Pipelines),
};
