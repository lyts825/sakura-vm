import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Maintenance } from '../../server/maintenance.ts';

export const services = {
  maintenance: serviceRef<ServiceInterface<Maintenance>>('maintenance', 'maintenance'),
};
