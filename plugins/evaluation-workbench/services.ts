import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  workbench: serviceRef('evaluation-workbench', 'evaluationWorkbench', serviceContracts.EvaluationWorkbench),
};
