/** 独立的版本服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { releases: serviceRef('locale-releases', 'localeReleases', serviceContracts.LocaleReleases) };
