import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'desktop',
  name: 'Linux 图形桌面',
  description: '按需安装 KDE Plasma、浏览器桌面、单应用窗口与中文输入法。',
  category: 'experimental',
  experimental: true,
  lifecycle: { activateMs: 30000, closeMs: 120000 },
  requires: [pin('projects')],
  services: ['desktops', 'jobs'],
  contributes: {
    http: [http('/api/vms/:vmId/desktop', ['GET', 'POST']),
      http('/api/vms/:vmId/single-app', ['GET', 'POST'], true),
      http('/api/vms/:vmId/ime', ['GET', 'POST'])],
    sockets: ['desktop'],
    tabs: ['desktop'],
  },
});
