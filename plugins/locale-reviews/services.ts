/** 独立的版本服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { reviews: serviceRef('locale-reviews', 'localeReviews', serviceContracts.LocaleReviews) };
