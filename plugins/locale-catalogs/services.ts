/** 独立的版本服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { catalogs: serviceRef('locale-catalogs', 'localeCatalogs', serviceContracts.LocaleCatalogs) };
