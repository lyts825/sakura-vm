import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'snapshots',
  name: '磁盘快照',
  description: '快照、恢复、克隆、只读救援、黄金镜像库以及独立磁盘包导入导出。',
  category: 'workspace',
  requires: [pin('transfers')],
  optional: [pin('backups')],
  services: ['bundles', 'goldenImages', 'rescue'],
  lifecycle: { activateMs: 30000, closeMs: 180000 },
  contributes: {
    http: [
      http('/api/golden-images', ['GET', 'POST']),
      http('/api/vms/:vmId/rescue', ['GET', 'POST']),
      http('/api/import', ['POST']),
      http('/api/vms/:vmId/snapshots', ['POST', 'PATCH', 'DELETE']),
      http('/api/vms/:vmId/export', ['GET']),
      http('/api/vms/:vmId/clone', ['POST']),
    ],
    operations: [
      operation('golden-list', 'GET', '/api/golden-images'),
      operation('golden-action', 'POST', '/api/golden-images'),
      operation('rescue-view', 'GET', '/api/vms/:vmId/rescue'),
      operation('rescue-artifact', 'GET', '/api/vms/:vmId/rescue/artifact'),
      operation('rescue-run', 'POST', '/api/vms/:vmId/rescue', 202),
    ],
    tabs: ['snapshots'],
  },
});
