import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  scorers: serviceRef('evaluation-scorers', 'evaluationScorers', serviceContracts.EvaluationScorers),
};
