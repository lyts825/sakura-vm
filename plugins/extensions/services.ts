import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { ExtendedFeatures } from '../../server/extended-features.ts';

export const services = {
  extended: serviceRef<ServiceInterface<ExtendedFeatures>>('extensions', 'extended'),
};
