/** 固定领域版本的服务引用。 */
import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  evidence: serviceRef('incident-evidence', 'incidentEvidence', serviceContracts.IncidentEvidence),
};
