import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'sync',
  name: '目录同步',
  description: '主机与 Linux 双向同步、变更预览与冲突决策。',
  category: 'operations',
  requires: [pin('projects')],
  services: ['sync'],
  contributes: {
    http: [
      http('/api/vms/:vmId/sync', ['GET', 'PUT', 'POST'], true),
      http('/api/vms/:vmId/sync-preview', ['POST'], true),
      http('/api/vms/:vmId/sync-queue', ['POST', 'DELETE'], true),
      http('/api/vms/:vmId/sync-rollback', ['POST'], true),
    ],
    tabs: ['sync'],
  },
});
