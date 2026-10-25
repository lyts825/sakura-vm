import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = { journal: serviceRef('flow-journal', 'flowJournal', serviceContracts.FlowJournal) };
