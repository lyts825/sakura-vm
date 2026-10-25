import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  comparisons: serviceRef(
    'evaluation-comparisons',
    'evaluationComparisons',
    serviceContracts.EvaluationComparisons,
  ),
};
