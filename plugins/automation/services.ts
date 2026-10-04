import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { FeatureSuite } from '../../server/feature-suite.ts';

export const services = {
  suite: serviceRef<ServiceInterface<FeatureSuite>>('automation', 'suite'),
};
