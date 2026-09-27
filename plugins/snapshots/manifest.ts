import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'snapshots',
  name: '磁盘快照',
  description: '快照、恢复、差异比较、克隆、只读救援、黄金镜像库以及独立磁盘包导入导出。',
  category: 'workspace',
  requires: [pin('transfers')],
  optional: [pin('backups')],
  services: ['bundles', 'signedBundles', 'goldenImages', 'rescue', 'snapshotDiff'],
  lifecycle: { activateMs: 30000, closeMs: 180000 },
  contributes: {
    http: [
      http('/api/golden-images', ['GET', 'POST']),
      http('/api/vms/:vmId/rescue', ['GET', 'POST']),
      http('/api/import', ['POST']),
      http('/api/signed-bundles', ['GET', 'POST']),
      http('/api/vms/:vmId/snapshots', ['POST', 'PATCH', 'DELETE']),
      http('/api/vms/:vmId/snapshot-diff', ['GET', 'POST']),
      http('/api/vms/:vmId/export', ['GET']),
      http('/api/vms/:vmId/clone', ['POST']),
    ],
    operations: [
      operation('golden-list', 'GET', '/api/golden-images'),
      operation('signed-bundles-view', 'GET', '/api/signed-bundles'),
      operation('signed-bundles-action', 'POST', '/api/signed-bundles'),
      operation('golden-action', 'POST', '/api/golden-images'),
      operation('rescue-view', 'GET', '/api/vms/:vmId/rescue'),
      operation('rescue-artifact', 'GET', '/api/vms/:vmId/rescue/artifact'),
      operation('rescue-run', 'POST', '/api/vms/:vmId/rescue', 202),
      operation('snapshot-diff-view', 'GET', '/api/vms/:vmId/snapshot-diff'),
      operation('snapshot-diff-run', 'POST', '/api/vms/:vmId/snapshot-diff', 202),
    ],
    tabs: ['snapshots'],
  },
});
