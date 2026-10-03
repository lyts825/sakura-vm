import { serviceRef } from '../../server/service-ref.ts';
import type { Maintenance } from '../../server/maintenance.ts';

export const services = {
  maintenance: serviceRef<Maintenance>('maintenance', 'maintenance'),
};
