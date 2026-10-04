import { definePlugin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'sandbox',
  name: '沙箱工作台',
  description: '隔离 Linux 环境、资源配额、限时命令与到期清理。',
  category: 'development',
  services: ['sandboxes'],
  contributes: {
    routes: [
      {"id":"list","method":"GET","path":"/api/sandboxes","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"create","method":"POST","path":"/api/sandboxes","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":201},
      {"id":"inspect","method":"GET","path":"/api/vms/{vmId}/sandbox","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"control","method":"POST","path":"/api/vms/{vmId}/sandbox","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"destroy","method":"DELETE","path":"/api/vms/{vmId}/sandbox","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"artifact","method":"GET","path":"/api/sandboxes/artifact","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"run","method":"POST","path":"/api/vms/{vmId}/sandbox/run","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    pages: ['sandbox'],
    http: [
      http('/api/sandboxes', ['GET', 'POST']),
      http('/api/vms/:vmId/sandbox', ['GET', 'POST', 'DELETE']),
    ],
    operations: [
      operation('list', 'GET', '/api/sandboxes'),
      operation('artifact', 'GET', '/api/sandboxes/artifact'),
      operation('create', 'POST', '/api/sandboxes', 201),
      operation('inspect', 'GET', '/api/vms/:vmId/sandbox'),
      operation('control', 'POST', '/api/vms/:vmId/sandbox'),
      operation('destroy', 'DELETE', '/api/vms/:vmId/sandbox'),
      operation('run', 'POST', '/api/vms/:vmId/sandbox/run', 202),
    ],
  },
});
