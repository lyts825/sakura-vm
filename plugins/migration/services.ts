import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  migration: serviceRef('migration', 'migration', serviceContracts.DataMigration),
};
