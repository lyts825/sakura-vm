/** 独立版本领域服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  sources: serviceRef('supply-sources', 'supplySources', serviceContracts.SupplySources),
};
