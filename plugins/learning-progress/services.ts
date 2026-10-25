import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  progress: serviceRef('learning-progress', 'learningProgress', serviceContracts.LearningProgress),
};
