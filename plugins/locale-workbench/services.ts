/** 独立的版本服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { workbench: serviceRef('locale-workbench', 'localeWorkbench', serviceContracts.LocaleWorkbench) };
