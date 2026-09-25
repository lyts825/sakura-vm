import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'extensions',
  name: '工程扩展适配器',
  description: '工程操作与能力检查；只依赖项目，不启动自动化调度。',
  category: 'experimental',
  experimental: true,
  requires: [pin('projects')],
  services: ['extended'],
  contributes: {
    http: [
      http('/api/extended-features', ['GET']),
      http('/api/vms/:vmId/extended-features', ['GET', 'POST'], true),
    ],
    pages: ['features'],
  },
});
