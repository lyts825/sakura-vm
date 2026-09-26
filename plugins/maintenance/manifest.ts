import { definePlugin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'maintenance',
  name: '磁盘与诊断',
  description: '故障诊断、磁盘扩容、空间检查与 QCOW2 整理。',
  category: 'operations',
  services: ['maintenance'],
  contributes: {
    http: [
      http('/api/storage', ['GET']),
      http('/api/vms/:vmId/diagnostics', ['GET', 'POST']),
      http('/api/vms/:vmId/resize', ['POST']),
      http('/api/vms/:vmId/compact', ['POST']),
      http('/api/vms/:vmId/disk-maintenance', ['GET', 'PUT', 'POST']),
    ],
    tabs: ['maintenance'],
  },
});
