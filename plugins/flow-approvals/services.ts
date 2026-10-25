import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  approvals: serviceRef('flow-approvals', 'flowApprovals', serviceContracts.FlowApprovals),
};
