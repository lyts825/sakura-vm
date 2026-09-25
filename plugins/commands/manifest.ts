import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'commands',
  name: '收藏命令',
  description: '参数化项目命令、执行与日志。',
  category: 'development',
  requires: [pin('projects')],
  services: ['commands'],
  contributes: {
    http: [http('/api/vms/:vmId/commands', ['GET', 'PUT', 'DELETE', 'POST'], true)],
    operations: [
      operation('list', 'GET', '/api/vms/:vmId/commands'),
      operation('save', 'PUT', '/api/vms/:vmId/commands'),
      operation('remove', 'DELETE', '/api/vms/:vmId/commands'),
      operation('run', 'POST', '/api/vms/:vmId/commands', 202),
    ],
    tabs: ['development'],
    developmentSections: ['commands'],
  },
});
