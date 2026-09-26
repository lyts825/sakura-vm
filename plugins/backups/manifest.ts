import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'backups',
  name: '备份策略',
  description: '定时、保留策略、加密与外部目录备份。',
  category: 'operations',
  requires: [pin('snapshots'), pin('secrets'), pin('transfers')],
  services: ['backups'],
  contributes: {
    http: [
      http('/api/vms/:vmId/backups', ['GET', 'PUT', 'POST']),
      http('/api/vms/:vmId/backup-download', ['POST']),
    ],
  },
});
