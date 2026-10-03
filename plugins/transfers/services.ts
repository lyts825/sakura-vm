import { serviceRef } from '../../server/service-ref.ts';
import type { Downloads } from '../../server/downloads.ts';

export const services = {
  downloads: serviceRef<Downloads>('transfers', 'downloads'),
};
