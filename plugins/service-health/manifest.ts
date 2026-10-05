import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'service-health',
  name: '服务健康检查',
  description: '持续检查已配置的项目服务。',
  category: 'operations',
  requires: [pin('projects')],
  services: ['health'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.health","method":"GET","path":"/api/vms/{vmId}/health","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"read","projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/health', ['GET'], true)] },
});
