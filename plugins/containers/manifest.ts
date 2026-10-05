import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'containers',
  name: '容器工作台',
  description: 'Docker、Compose、Dev Container 与官方模板。',
  category: 'development',
  requires: [pin('projects')],
  services: ['containers'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.containers","method":"GET","path":"/api/vms/{vmId}/containers","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.containers","method":"POST","path":"/api/vms/{vmId}/containers","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/containers', ['GET', 'POST'], true)], tabs: ['containers'] },
});
