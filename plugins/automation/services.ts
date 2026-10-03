import { serviceRef } from '../../server/service-ref.ts';
import type { FeatureSuite } from '../../server/feature-suite.ts';

export const services = {
  suite: serviceRef<FeatureSuite>('automation', 'suite'),
};
