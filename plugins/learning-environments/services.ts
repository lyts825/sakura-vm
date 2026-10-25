import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  environments: serviceRef(
    'learning-environments',
    'learningEnvironments',
    serviceContracts.LearningEnvironments,
  ),
};
