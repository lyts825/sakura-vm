import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Files } from '../../server/files.ts';
import type { FileHistory } from '../../server/file-history.ts';
import type { FileLocks } from '../../server/file-locks.ts';

export const services = {
  files: serviceRef<ServiceInterface<Files>>('files', 'files'),
  history: serviceRef<ServiceInterface<FileHistory>>('files', 'history'),
  fileLocks: serviceRef<ServiceInterface<FileLocks>>('files', 'fileLocks'),
};
