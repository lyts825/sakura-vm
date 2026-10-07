/**
 * 模块职责：“网络管理”插件的有类型服务引用（network、certificates、ingress、localAliases），把服务名称与运行时契约绑定，供依赖插件通过宿主获取。
 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  network: serviceRef('network', 'network', serviceContracts.NetworkProfiles),
  certificates: serviceRef('network', 'certificates', serviceContracts.IngressCertificates),
  ingress: serviceRef('network', 'ingress', serviceContracts.HttpIngress),
  localAliases: serviceRef('network', 'localAliases', serviceContracts.LocalAliases),
};
