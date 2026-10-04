import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { DataMigration } from '../../server/data-migration.ts';

export const services = {
  migration: serviceRef<ServiceInterface<DataMigration>>('migration', 'migration'),
};
