/** 交付规则的独立版本公共服务引用。
 * Expose this plugin through its independently versioned public service contract. */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { gates: serviceRef('delivery-gates', 'gates', serviceContracts.DeliveryGates) };
