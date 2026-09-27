import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'network',
  name: '网络管理',
  description: '端口转发、代理、软件源与网络诊断。',
  category: 'operations',
  optional: [pin('projects')],
  services: ['network', 'certificates', 'ingress'],
  contributes: {
    http: [
      http('/api/network-profiles', ['GET', 'POST', 'DELETE']),
      http('/api/vms/:vmId/network', ['GET', 'POST'], true),
      http('/api/vms/:vmId/services', ['GET', 'PATCH']),
      http('/api/ingress', ['GET', 'POST']),
      http('/api/ingress-certificate', ['GET', 'POST']),
    ],
    operations: [
      operation('ingress-view', 'GET', '/api/ingress'),
      operation('ingress-action', 'POST', '/api/ingress'),
      operation('ingress-certificate-view', 'GET', '/api/ingress-certificate'),
      operation('ingress-certificate-action', 'POST', '/api/ingress-certificate'),
    ],
    tabs: ['services', 'development'],
    developmentSections: ['network'],
  },
});
