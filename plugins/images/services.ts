/**
 * 模块职责：“发行版镜像”插件的有类型服务引用（images、diskImports），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  images: serviceRef('images', 'images', serviceContracts.Images),
  diskImports: serviceRef('images', 'diskImports', serviceContracts.DiskImports),
};
