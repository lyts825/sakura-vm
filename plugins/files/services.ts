/**
 * 模块职责：“文件工作台”插件的有类型服务引用（files、history、fileLocks），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  files: serviceRef('files', 'files', serviceContracts.Files),
  history: serviceRef('files', 'history', serviceContracts.FileHistory),
  fileLocks: serviceRef('files', 'fileLocks', serviceContracts.FileLocks),
};
