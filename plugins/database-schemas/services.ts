import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';
export const services = {
  schemas: serviceRef('database-schemas', 'databaseSchemas', serviceContracts.DatabaseSchemas),
};
