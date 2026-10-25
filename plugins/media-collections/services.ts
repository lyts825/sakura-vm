import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  collections: serviceRef('media-collections', 'mediaCollections', serviceContracts.MediaCollections),
};
