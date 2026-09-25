import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'network',
  name: '网络管理',
  description: '端口转发、代理、软件源与网络诊断。',
  category: 'operations',
  optional: [pin('projects')],
  services: ['network'],
  contributes: {
    http: [
      http('/api/vms/:vmId/network', ['GET', 'POST'], true),
      http('/api/vms/:vmId/services', ['GET', 'PATCH']),
    ],
    tabs: ['services', 'development'],
    developmentSections: ['network'],
  },
});
