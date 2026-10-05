import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'toolchains',
  name: '工具安装',
  description: '检查和安装客户机开发工具。',
  category: 'development',
  requires: [pin('projects')],
  services: ['toolchains'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.tools","method":"GET","path":"/api/vms/{vmId}/tools","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.tools","method":"POST","path":"/api/vms/{vmId}/tools","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/tools', ['GET', 'POST'], true)],
    tabs: ['development'],
    developmentSections: ['tools'],
  },
});
