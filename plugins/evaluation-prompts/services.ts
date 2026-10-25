import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  prompts: serviceRef('evaluation-prompts', 'evaluationPrompts', serviceContracts.EvaluationPrompts),
};
