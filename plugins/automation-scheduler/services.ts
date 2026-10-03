import { serviceRef } from '../../server/service-ref.ts';
import type { FeatureScheduler } from '../../server/feature-scheduler.ts';

export const services = {
  scheduler: serviceRef<FeatureScheduler>('automation-scheduler', 'scheduler'),
};
