import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  captions: serviceRef('media-captions', 'mediaCaptions', serviceContracts.MediaCaptions),
};
