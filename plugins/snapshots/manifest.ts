import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'snapshots',
  name: '磁盘快照',
  description: '快照、恢复、克隆、黄金镜像库以及独立磁盘包导入导出。',
  category: 'workspace',
  requires: [pin('transfers')],
  optional: [pin('backups')],
  services: ['bundles', 'goldenImages'],
  contributes: {
    http: [
      http('/api/golden-images', ['GET', 'POST']),
      http('/api/import', ['POST']),
      http('/api/vms/:vmId/snapshots', ['POST', 'PATCH', 'DELETE']),
      http('/api/vms/:vmId/export', ['GET']),
      http('/api/vms/:vmId/clone', ['POST']),
    ],
    operations: [
      operation('golden-list', 'GET', '/api/golden-images'),
      operation('golden-action', 'POST', '/api/golden-images'),
    ],
    tabs: ['snapshots'],
  },
});
