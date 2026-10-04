import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'commands',
  name: '收藏命令',
  description: '参数化项目命令、执行与日志。',
  category: 'development',
  requires: [pin('projects')],
  services: ['commands'],
  contributes: {
    routes: [
      {"id":"list","method":"GET","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"save","method":"PUT","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"remove","method":"DELETE","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"run","method":"POST","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/commands', ['GET', 'PUT', 'DELETE', 'POST'], true)],
    operations: [
      operation('list', 'GET', '/api/vms/:vmId/commands'),
      operation('save', 'PUT', '/api/vms/:vmId/commands'),
      operation('remove', 'DELETE', '/api/vms/:vmId/commands'),
      operation('run', 'POST', '/api/vms/:vmId/commands', 202),
    ],
    tabs: ['development'],
    developmentSections: ['commands'],
  },
});
