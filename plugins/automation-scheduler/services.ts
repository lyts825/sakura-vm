import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { FeatureScheduler } from '../../server/feature-scheduler.ts';

export const services = {
  scheduler: serviceRef<ServiceInterface<FeatureScheduler>>('automation-scheduler', 'scheduler'),
};
