import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'projects',
  name: '项目工作区',
  description: '多项目配置、开发模板、初始化命令与项目服务。',
  category: 'development',
  optional: [pin('secrets'), pin('network')],
  services: ['workspaces'],
  contributes: {
    http: [
      http('/api/vms/:vmId/projects', ['GET', 'POST'], true),
      http('/api/vms/:vmId/project', ['GET', 'PUT', 'POST'], true),
      http('/api/vms/:vmId/project-runtime', ['GET'], true),
    ],
    tabs: ['project'],
  },
});
