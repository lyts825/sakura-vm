import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'library',
  name: '实例整理',
  description: '分组、标签、收藏与批量启停。',
  category: 'workspace',
  optional: [pin('recipes')],
  contributes: {
    routes: [
      {"id":"legacy.post.vms.batch","method":"POST","path":"/api/vms/batch","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.organization","method":"PUT","path":"/api/vms/{vmId}/organization","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/batch', ['POST']), http('/api/vms/:vmId/organization', ['PUT'])],
    pages: ['library'],
  },
});
