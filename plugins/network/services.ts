import { serviceRef } from '../../server/service-ref.ts';
import type { NetworkProfiles } from '../../server/network-profiles.ts';
import type { IngressCertificates } from '../../server/ingress-certificates.ts';
import type { HttpIngress } from '../../server/http-ingress.ts';
import type { LocalAliases } from '../../server/local-aliases.ts';

export const services = {
  network: serviceRef<NetworkProfiles>('network', 'network'),
  certificates: serviceRef<IngressCertificates>('network', 'certificates'),
  ingress: serviceRef<HttpIngress>('network', 'ingress'),
  localAliases: serviceRef<LocalAliases>('network', 'localAliases'),
};
