import { serviceRef } from '../../server/service-ref.ts';
import type { Backups } from '../../server/backups.ts';
import type { BackupRecovery } from '../../server/backup-recovery.ts';

export const services = {
  backups: serviceRef<Backups>('backups', 'backups'),
  backupRecovery: serviceRef<BackupRecovery>('backups', 'backupRecovery'),
};
