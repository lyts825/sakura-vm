import { serviceRef } from '../../server/service-ref.ts';
import { serviceContracts } from '../../server/service-contracts.ts';

export const services = {
  backups: serviceRef('backups', 'backups', serviceContracts.Backups),
  backupRecovery: serviceRef('backups', 'backupRecovery', serviceContracts.BackupRecovery),
};
