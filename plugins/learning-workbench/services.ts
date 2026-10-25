import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  workbench: serviceRef('learning-workbench', 'learningWorkbench', serviceContracts.LearningWorkbench),
};
