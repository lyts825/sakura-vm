import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'runtimes',
  name: '运行时版本',
  description: 'Node.js、Python 等项目运行时的选择和安装。',
  category: 'development',
  requires: [pin('projects')],
  services: ['runtimes'],
  contributes: {
    http: [http('/api/vms/:vmId/runtimes', ['GET', 'POST'], true)],
    tabs: ['development'],
    developmentSections: ['runtimes'],
  },
});
