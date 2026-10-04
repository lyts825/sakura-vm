import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'sync',
  name: '目录同步',
  description: '主机与 Linux 双向同步、变更预览与冲突决策。',
  category: 'operations',
  requires: [pin('projects')],
  services: ['sync'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.sync","method":"GET","path":"/api/vms/{vmId}/sync","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.sync","method":"PUT","path":"/api/vms/{vmId}/sync","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.sync","method":"POST","path":"/api/vms/{vmId}/sync","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.sync-preview","method":"POST","path":"/api/vms/{vmId}/sync-preview","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.sync-merge","method":"POST","path":"/api/vms/{vmId}/sync-merge","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.sync-queue","method":"POST","path":"/api/vms/{vmId}/sync-queue","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.delete.vms.vmId.sync-queue","method":"DELETE","path":"/api/vms/{vmId}/sync-queue","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.sync-rollback","method":"POST","path":"/api/vms/{vmId}/sync-rollback","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/vms/:vmId/sync', ['GET', 'PUT', 'POST'], true),
      http('/api/vms/:vmId/sync-preview', ['POST'], true),
      http('/api/vms/:vmId/sync-merge', ['POST'], true),
      http('/api/vms/:vmId/sync-queue', ['POST', 'DELETE'], true),
      http('/api/vms/:vmId/sync-rollback', ['POST'], true),
    ],
    tabs: ['sync'],
  },
});
