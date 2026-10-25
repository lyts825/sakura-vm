import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  workers: serviceRef('media-workers', 'mediaWorkers', serviceContracts.MediaWorkers),
};
