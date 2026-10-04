import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { ServiceHealth } from '../../server/service-health.ts';

export const services = {
  health: serviceRef<ServiceInterface<ServiceHealth>>('service-health', 'health'),
};
