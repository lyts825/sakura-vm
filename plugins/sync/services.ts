import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { FolderSync } from '../../server/sync.ts';

export const services = {
  sync: serviceRef<ServiceInterface<FolderSync>>('sync', 'sync'),
};
