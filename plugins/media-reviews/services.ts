import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  reviews: serviceRef('media-reviews', 'mediaReviews', serviceContracts.MediaReviews),
};
