import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  network: serviceRef('network', 'network', serviceContracts.NetworkProfiles),
  certificates: serviceRef('network', 'certificates', serviceContracts.IngressCertificates),
  ingress: serviceRef('network', 'ingress', serviceContracts.HttpIngress),
  localAliases: serviceRef('network', 'localAliases', serviceContracts.LocalAliases),
};
