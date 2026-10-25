import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { plans: serviceRef('flow-plans', 'flowPlans', serviceContracts.FlowPlans) };
