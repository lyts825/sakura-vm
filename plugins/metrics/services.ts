import { serviceRef } from '../../server/service-ref.ts';
import type { Metrics } from '../../server/metrics.ts';

export const services = {
  metrics: serviceRef<Metrics>('metrics', 'metrics'),
};
