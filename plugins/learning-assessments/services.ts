import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  assessments: serviceRef(
    'learning-assessments',
    'learningAssessments',
    serviceContracts.LearningAssessments,
  ),
};
