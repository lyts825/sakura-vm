import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'platform',
  name: '平台扩展适配器',
  description: '远程、灾备、安全与协作适配器；按实际就绪状态提供。',
  category: 'experimental',
  experimental: true,
  requires: [pin('projects')],
  services: ['next'],
  contributes: {
    http: [http('/api/next-features', ['GET']), http('/api/vms/:vmId/next-features', ['GET', 'POST'], true)],
    pages: ['features'],
  },
});
