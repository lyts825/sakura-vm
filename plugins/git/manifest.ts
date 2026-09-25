import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'git',
  name: 'Git 工作台',
  description: '差异、暂存、提交、分支与远程仓库。',
  category: 'development',
  requires: [pin('projects')],
  services: ['git'],
  contributes: { http: [http('/api/vms/:vmId/git', ['GET', 'POST'], true)], tabs: ['git'] },
});
