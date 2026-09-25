import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'project-search',
  name: '项目搜索',
  description: '项目文件索引、文件名与内容搜索。',
  category: 'development',
  requires: [pin('projects'), pin('files')],
  services: ['projectFiles'],
  contributes: { http: [http('/api/vms/:vmId/project-files', ['GET'], true)] },
});
