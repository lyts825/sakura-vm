import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  changes: serviceRef('database-changes', 'databaseChanges', serviceContracts.DatabaseChanges),
};
