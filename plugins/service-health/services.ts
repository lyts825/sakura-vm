import { serviceRef } from '../../server/service-ref.ts';
import type { ServiceHealth } from '../../server/service-health.ts';

export const services = {
  health: serviceRef<ServiceHealth>('service-health', 'health'),
};
