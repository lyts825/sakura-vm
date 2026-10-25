import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  assets: serviceRef('learning-assets', 'learningAssets', serviceContracts.LearningAssets),
};
