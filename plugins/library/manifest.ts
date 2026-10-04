import { definePlugin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'library',
  name: '实例整理',
  description: '分组、标签、收藏与批量启停。',
  category: 'workspace',
  contributes: { managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/batch', ['POST']), http('/api/vms/:vmId/organization', ['PUT'])],
    pages: ['library'],
  },
});
