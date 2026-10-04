import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Downloads } from '../../server/downloads.ts';

export const services = {
  downloads: serviceRef<ServiceInterface<Downloads>>('transfers', 'downloads'),
};
