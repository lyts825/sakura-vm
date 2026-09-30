import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'ide',
  name: 'IDE 接入',
  description: 'VS Code Remote-SSH 配置与项目连接。',
  category: 'development',
  requires: [pin('projects')],
  services: ['ide'],
  contributes: { http: [http('/api/vms/:vmId/ide', ['GET', 'POST'], true)] },
});
