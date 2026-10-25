import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { runs: serviceRef('flow-runs', 'flowRuns', serviceContracts.FlowRuns) };
