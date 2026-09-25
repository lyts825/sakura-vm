import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'pipelines',
  name: '项目流水线',
  description: '构建步骤、运行记录与产物下载。',
  category: 'development',
  requires: [pin('projects'), pin('files'), pin('transfers')],
  services: ['pipelines'],
  contributes: {
    http: [
      http('/api/vms/:vmId/pipelines', ['GET', 'PUT', 'DELETE', 'POST'], true),
      http('/api/vms/:vmId/pipeline-artifact', ['POST'], true),
    ],
    tabs: ['development'],
    developmentSections: ['pipelines'],
  },
});
