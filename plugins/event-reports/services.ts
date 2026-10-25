import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  reports: serviceRef('event-reports', 'eventReports', serviceContracts.EventReports),
};
