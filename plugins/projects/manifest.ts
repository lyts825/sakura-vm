import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'projects',
  name: '项目工作区',
  description: '多项目配置、开发模板、初始化命令与项目服务。',
  category: 'development',
  optional: [pin('secrets'), pin('network')],
  services: ['workspaces'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.projects","method":"GET","path":"/api/vms/{vmId}/projects","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.projects","method":"POST","path":"/api/vms/{vmId}/projects","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.project","method":"GET","path":"/api/vms/{vmId}/project","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"read","projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.project","method":"PUT","path":"/api/vms/{vmId}/project","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"write","projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"project-change","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.project","method":"POST","path":"/api/vms/{vmId}/project","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"execute","projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.project-runtime","method":"GET","path":"/api/vms/{vmId}/project-runtime","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"read","projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.project-directory-migration","method":"GET","path":"/api/vms/{vmId}/project-directory-migration","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.project-directory-migration","method":"POST","path":"/api/vms/{vmId}/project-directory-migration","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/vms/:vmId/projects', ['GET', 'POST'], true),
      http('/api/vms/:vmId/project', ['GET', 'PUT', 'POST'], true),
      http('/api/vms/:vmId/project-runtime', ['GET'], true),
      http('/api/vms/:vmId/project-directory-migration', ['GET', 'POST'], true),
    ],
    tabs: ['project'],
  },
});
