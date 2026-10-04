import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'runtimes',
  name: '运行时版本',
  description: 'Node.js、Python 等项目运行时的选择和安装。',
  category: 'development',
  requires: [pin('projects')],
  services: ['runtimes'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.runtimes","method":"GET","path":"/api/vms/{vmId}/runtimes","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.runtimes","method":"POST","path":"/api/vms/{vmId}/runtimes","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/runtimes', ['GET', 'POST'], true)],
    tabs: ['development'],
    developmentSections: ['runtimes'],
  },
});
