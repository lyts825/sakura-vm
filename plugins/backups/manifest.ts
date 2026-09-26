import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'backups',
  name: '备份策略',
  description: '定时、保留策略、加密与外部目录备份。',
  category: 'operations',
  requires: [pin('snapshots'), pin('secrets'), pin('transfers')],
  services: ['backups', 'backupRecovery'],
  lifecycle: { activateMs: 30000, closeMs: 180000 },
  contributes: {
    http: [
      http('/api/vms/:vmId/backups', ['GET', 'PUT', 'POST']),
      http('/api/vms/:vmId/backup-download', ['POST']),
      http('/api/vms/:vmId/backup-recovery', ['GET', 'POST']),
    ],
    operations: [
      operation('recovery-view', 'GET', '/api/vms/:vmId/backup-recovery'),
      operation('recovery-run', 'POST', '/api/vms/:vmId/backup-recovery', 202),
      operation('recovery-artifact', 'GET', '/api/vms/:vmId/backup-recovery/artifact'),
    ],
  },
});
