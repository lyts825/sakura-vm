import { definePlugin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'sandbox',
  name: '沙箱工作台',
  description: '隔离 Linux 环境、资源配额、限时命令与到期清理。',
  category: 'development',
  services: ['sandboxes'],
  contributes: {
    pages: ['sandbox'],
    http: [
      http('/api/sandboxes', ['GET', 'POST']),
      http('/api/vms/:vmId/sandbox', ['GET', 'POST', 'DELETE']),
    ],
    operations: [
      operation('list', 'GET', '/api/sandboxes'),
      operation('artifact', 'GET', '/api/sandboxes/artifact'),
      operation('create', 'POST', '/api/sandboxes', 201),
      operation('inspect', 'GET', '/api/vms/:vmId/sandbox'),
      operation('control', 'POST', '/api/vms/:vmId/sandbox'),
      operation('destroy', 'DELETE', '/api/vms/:vmId/sandbox'),
      operation('run', 'POST', '/api/vms/:vmId/sandbox/run', 202),
    ],
  },
});
