import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'recipes',
  name: '环境配方',
  description: '导入、导出及应用 sakura.json 项目环境配方。',
  category: 'development',
  requires: [pin('projects')],
  services: ['recipes'],
  contributes: {
    http: [http('/api/recipes', ['POST']), http('/api/vms/:vmId/recipe', ['GET', 'PUT', 'POST'], true)],
    tabs: ['project'],
  },
});
