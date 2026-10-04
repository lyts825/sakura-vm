import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Containers } from '../../server/containers.ts';

export const services = {
  containers: serviceRef<ServiceInterface<Containers>>('containers', 'containers'),
};
