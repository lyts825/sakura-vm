import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'desktop',
  name: 'Linux 图形桌面',
  description: '按需安装 KDE Plasma、浏览器桌面、单应用窗口、原生 X11 剪贴板策略与中文输入法。',
  category: 'experimental',
  experimental: true,
  lifecycle: { activateMs: 30000, closeMs: 120000 },
  requires: [pin('projects')],
  services: ['desktops', 'jobs', 'x11Clipboard'],
  contributes: {
    http: [http('/api/vms/:vmId/desktop', ['GET', 'POST'], true),
      http('/api/vms/:vmId/single-app', ['GET', 'POST'], true),
      http('/api/vms/:vmId/x11-clipboard', ['GET', 'POST'], true),
      http('/api/vms/:vmId/ime', ['GET', 'POST'])],
    sockets: ['desktop'],
    operations: [operation('x11-clipboard-get', 'GET', '/api/vms/:vmId/x11-clipboard'),
      operation('x11-clipboard-action', 'POST', '/api/vms/:vmId/x11-clipboard')],
    tabs: ['desktop'],
  },
});
