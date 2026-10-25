import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  runners: serviceRef('database-runners', 'databaseRunners', serviceContracts.DatabaseRunners),
};
