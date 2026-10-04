import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'containers',
  name: '容器工作台',
  description: 'Docker、Compose、Dev Container 与官方模板。',
  category: 'development',
  requires: [pin('projects')],
  services: ['containers'],
  contributes: { managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/containers', ['GET', 'POST'], true)], tabs: ['containers'] },
});
