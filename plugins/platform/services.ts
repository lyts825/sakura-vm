import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { NextFeatures } from '../../server/next-features.ts';

export const services = {
  next: serviceRef<ServiceInterface<NextFeatures>>('platform', 'next'),
};
