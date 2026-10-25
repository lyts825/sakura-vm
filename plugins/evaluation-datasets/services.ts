import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  datasets: serviceRef('evaluation-datasets', 'evaluationDatasets', serviceContracts.EvaluationDatasets),
};
