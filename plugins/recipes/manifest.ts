import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'recipes',
  name: '环境配方',
  description: '导入、导出及应用 sakura.json 项目环境配方。',
  category: 'development',
  requires: [pin('projects')],
  services: ['recipes'],
  contributes: {
    routes: [
      {"id":"legacy.post.recipes","method":"POST","path":"/api/recipes","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.recipe","method":"GET","path":"/api/vms/{vmId}/recipe","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.recipe","method":"PUT","path":"/api/vms/{vmId}/recipe","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.recipe","method":"POST","path":"/api/vms/{vmId}/recipe","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/recipes', ['POST']), http('/api/vms/:vmId/recipe', ['GET', 'PUT', 'POST'], true)],
    tabs: ['project'],
  },
});
