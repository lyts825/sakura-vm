import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'toolchains',
  name: '工具安装',
  description: '检查和安装客户机开发工具。',
  category: 'development',
  requires: [pin('projects')],
  services: ['toolchains'],
  contributes: {
    http: [http('/api/vms/:vmId/tools', ['GET', 'POST'], true)],
    tabs: ['development'],
    developmentSections: ['tools'],
  },
});
