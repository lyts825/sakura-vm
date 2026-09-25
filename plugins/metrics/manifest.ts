import { definePlugin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'metrics',
  name: '资源采样',
  description: '独立采样客户机 CPU、内存、磁盘与进程，无需项目服务。',
  category: 'operations',
  services: ['metrics'],
  contributes: {
    http: [http('/api/vms/:vmId/metrics', ['GET'])],
    operations: [operation('sample', 'GET', '/api/vms/:vmId/metrics')],
    tabs: ['metrics'],
  },
});
