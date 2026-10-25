import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  courses: serviceRef('learning-courses', 'learningCourses', serviceContracts.LearningCourses),
};
