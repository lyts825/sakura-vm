import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  connectors: serviceRef('flow-connectors', 'flowConnectors', serviceContracts.FlowConnectors),
};
