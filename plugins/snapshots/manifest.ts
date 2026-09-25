import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'snapshots',
  name: '磁盘快照',
  description: '快照、恢复、克隆以及独立磁盘包导入导出。',
  category: 'workspace',
  requires: [pin('transfers')],
  optional: [pin('backups')],
  services: ['bundles'],
  contributes: {
    http: [
      http('/api/import', ['POST']),
      http('/api/vms/:vmId/snapshots', ['POST', 'PATCH', 'DELETE']),
      http('/api/vms/:vmId/export', ['GET']),
      http('/api/vms/:vmId/clone', ['POST']),
    ],
    tabs: ['snapshots'],
  },
});
