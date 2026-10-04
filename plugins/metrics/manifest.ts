import { definePlugin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'metrics',
  name: '资源采样',
  description: '独立采样客户机 CPU、内存、磁盘与进程，无需项目服务。',
  category: 'operations',
  services: ['metrics'],
  contributes: {
    routes: [
      {"id":"sample","method":"GET","path":"/api/vms/{vmId}/metrics","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/metrics', ['GET'])],
    operations: [operation('sample', 'GET', '/api/vms/:vmId/metrics')],
    tabs: ['metrics'],
  },
});
