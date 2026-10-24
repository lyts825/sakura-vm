/** 独立版本领域服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  licenses: serviceRef('supply-licenses', 'supplyLicenses', serviceContracts.SupplyLicenses),
};
