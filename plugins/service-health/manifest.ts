import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'service-health',
  name: '服务健康检查',
  description: '持续检查已配置的项目服务。',
  category: 'operations',
  requires: [pin('projects')],
  services: ['health'],
  contributes: { http: [http('/api/vms/:vmId/health', ['GET'], true)], tabs: ['project'] },
});
