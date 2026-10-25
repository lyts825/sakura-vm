import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  sessions: serviceRef('learning-sessions', 'learningSessions', serviceContracts.LearningSessions),
};
