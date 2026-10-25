import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  inspect: serviceRef('media-inspect', 'mediaInspect', serviceContracts.MediaInspect),
};
