import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { NetworkProfiles } from '../../server/network-profiles.ts';
import type { IngressCertificates } from '../../server/ingress-certificates.ts';
import type { HttpIngress } from '../../server/http-ingress.ts';
import type { LocalAliases } from '../../server/local-aliases.ts';

export const services = {
  network: serviceRef<ServiceInterface<NetworkProfiles>>('network', 'network'),
  certificates: serviceRef<ServiceInterface<IngressCertificates>>('network', 'certificates'),
  ingress: serviceRef<ServiceInterface<HttpIngress>>('network', 'ingress'),
  localAliases: serviceRef<ServiceInterface<LocalAliases>>('network', 'localAliases'),
};
