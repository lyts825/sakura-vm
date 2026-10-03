import { serviceRef } from '../../server/service-ref.ts';
import type { ExtendedFeatures } from '../../server/extended-features.ts';

export const services = {
  extended: serviceRef<ExtendedFeatures>('extensions', 'extended'),
};
