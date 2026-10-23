/** 工坊领域的版本化公共服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  foundryChecks: serviceRef('foundry-checks', 'foundryChecks', serviceContracts.FoundryChecks),
};
