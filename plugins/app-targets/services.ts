/** 本领域版本化服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { appTargets: serviceRef('app-targets', 'appTargets', serviceContracts.AppTargets) };
