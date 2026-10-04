import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  files: serviceRef('files', 'files', serviceContracts.Files),
  history: serviceRef('files', 'history', serviceContracts.FileHistory),
  fileLocks: serviceRef('files', 'fileLocks', serviceContracts.FileLocks),
};
