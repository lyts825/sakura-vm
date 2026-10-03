import { serviceRef } from '../../server/service-ref.ts';
import type { Files } from '../../server/files.ts';
import type { FileHistory } from '../../server/file-history.ts';
import type { FileLocks } from '../../server/file-locks.ts';

export const services = {
  files: serviceRef<Files>('files', 'files'),
  history: serviceRef<FileHistory>('files', 'history'),
  fileLocks: serviceRef<FileLocks>('files', 'fileLocks'),
};
