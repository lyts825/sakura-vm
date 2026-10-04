import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'automation',
  name: '自动化与运维',
  description: '资源策略、软件包与开发任务；计划调度由独立插件运行。',
  category: 'operations',
  requires: [pin('projects')],
  optional: [pin('automation-scheduler'), pin('service-health'), pin('secrets'), pin('containers'), pin('ide')],
  systemDependencies: ["mediaDevices","hostMounts","processInterop","projectTerminals"],
  services: ['suite'],
  contributes: {
    routes: [
      {"id":"legacy.get.feature-suite","method":"GET","path":"/api/feature-suite","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.advanced","method":"GET","path":"/api/vms/{vmId}/advanced","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.advanced","method":"PUT","path":"/api/vms/{vmId}/advanced","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.advanced","method":"POST","path":"/api/vms/{vmId}/advanced","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.packages","method":"GET","path":"/api/vms/{vmId}/packages","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.packages","method":"POST","path":"/api/vms/{vmId}/packages","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.suspend","method":"POST","path":"/api/vms/{vmId}/suspend","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.resume","method":"POST","path":"/api/vms/{vmId}/resume","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/feature-suite', ['GET']),
      http('/api/vms/:vmId/advanced', ['GET', 'PUT', 'POST'], true),
      http('/api/vms/:vmId/packages', ['GET', 'POST'], true),
      http('/api/vms/:vmId/suspend', ['POST']),
      http('/api/vms/:vmId/resume', ['POST']),
    ],
    pages: ['features'],
  },
});
