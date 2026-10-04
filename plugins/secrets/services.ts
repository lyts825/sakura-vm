import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Secrets } from '../../server/secrets.ts';

export const services = {
  secrets: serviceRef<ServiceInterface<Secrets>>('secrets', 'secrets'),
};
