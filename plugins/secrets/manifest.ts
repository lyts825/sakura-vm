import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'secrets',
  name: '私密配置',
  description: '主机私密配置存储与项目环境变量引用。',
  category: 'operations',
  optional: [pin('projects')],
  services: ['secrets'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.secrets","method":"GET","path":"/api/vms/{vmId}/secrets","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.secrets","method":"PUT","path":"/api/vms/{vmId}/secrets","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.delete.vms.vmId.secrets","method":"DELETE","path":"/api/vms/{vmId}/secrets","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.secret-rotation","method":"GET","path":"/api/vms/{vmId}/secret-rotation","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.patch.vms.vmId.secret-rotation","method":"PATCH","path":"/api/vms/{vmId}/secret-rotation","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/vms/:vmId/secrets', ['GET', 'PUT', 'DELETE'], true),
      http('/api/vms/:vmId/secret-rotation', ['GET', 'PATCH'], true),
    ],
    tabs: ['development'],
    developmentSections: ['secrets'],
  },
});
