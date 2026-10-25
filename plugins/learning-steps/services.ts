import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  steps: serviceRef('learning-steps', 'learningSteps', serviceContracts.LearningSteps),
};
