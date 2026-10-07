/**
 * 模块职责：“工具安装”插件的有类型服务引用（toolchains），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  toolchains: serviceRef('toolchains', 'toolchains', serviceContracts.Toolchains),
};
