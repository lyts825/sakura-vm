/**
 * 模块职责：“目录同步”插件的有类型服务引用（sync），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  sync: serviceRef('sync', 'sync', serviceContracts.FolderSync),
};
