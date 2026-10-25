import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  sources: serviceRef('media-sources', 'mediaSources', serviceContracts.MediaSources),
};
