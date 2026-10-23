/** 本领域版本化服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { appDeploy: serviceRef('app-deploy', 'appDeploy', serviceContracts.AppDeploy) };
