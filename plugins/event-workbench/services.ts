import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  workbench: serviceRef('event-workbench', 'eventWorkbench', serviceContracts.EventWorkbench),
};
