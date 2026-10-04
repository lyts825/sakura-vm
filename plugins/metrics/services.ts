import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Metrics } from '../../server/metrics.ts';

export const services = {
  metrics: serviceRef<ServiceInterface<Metrics>>('metrics', 'metrics'),
};
