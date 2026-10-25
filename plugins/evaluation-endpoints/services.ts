import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  endpoints: serviceRef('evaluation-endpoints', 'evaluationEndpoints', serviceContracts.EvaluationEndpoints),
};
