import { serviceRef } from '../../server/service-ref.ts';
import type { DataMigration } from '../../server/data-migration.ts';

export const services = {
  migration: serviceRef<DataMigration>('migration', 'migration'),
};
