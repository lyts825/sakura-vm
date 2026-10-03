import { serviceRef } from '../../server/service-ref.ts';
import type { Secrets } from '../../server/secrets.ts';

export const services = {
  secrets: serviceRef<Secrets>('secrets', 'secrets'),
};
