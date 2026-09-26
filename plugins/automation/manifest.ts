import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'automation',
  name: '自动化与运维',
  description: '资源策略、软件包与开发任务；计划调度由独立插件运行。',
  category: 'operations',
  requires: [pin('projects')],
  optional: [pin('automation-scheduler'), pin('service-health')],
  services: ['suite'],
  contributes: {
    http: [
      http('/api/feature-suite', ['GET']),
      http('/api/vms/:vmId/advanced', ['GET', 'PUT', 'POST'], true),
      http('/api/vms/:vmId/suspend', ['POST']),
      http('/api/vms/:vmId/resume', ['POST']),
    ],
    pages: ['features'],
  },
});
