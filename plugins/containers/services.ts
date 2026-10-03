import { serviceRef } from '../../server/service-ref.ts';
import type { Containers } from '../../server/containers.ts';

export const services = {
  containers: serviceRef<Containers>('containers', 'containers'),
};
