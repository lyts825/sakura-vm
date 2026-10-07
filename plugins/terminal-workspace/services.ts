/**
 * 模块职责：“多终端工作区”插件的有类型服务引用（terminals），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  terminals: serviceRef('terminal-workspace', 'terminals', serviceContracts.ProjectTerminals),
};
