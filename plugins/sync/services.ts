import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  sync: serviceRef('sync', 'sync', serviceContracts.FolderSync),
};
