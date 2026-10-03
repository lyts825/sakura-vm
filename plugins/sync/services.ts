import { serviceRef } from '../../server/service-ref.ts';
import type { FolderSync } from '../../server/sync.ts';

export const services = {
  sync: serviceRef<FolderSync>('sync', 'sync'),
};
