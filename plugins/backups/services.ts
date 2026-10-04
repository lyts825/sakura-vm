import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Backups } from '../../server/backups.ts';
import type { BackupRecovery } from '../../server/backup-recovery.ts';

export const services = {
  backups: serviceRef<ServiceInterface<Backups>>('backups', 'backups'),
  backupRecovery: serviceRef<ServiceInterface<BackupRecovery>>('backups', 'backupRecovery'),
};
