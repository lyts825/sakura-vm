import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'files',
  name: '文件工作台',
  description: '文件浏览、上传下载、文本编辑、历史版本与回收站。',
  category: 'workspace',
  requires: [pin('transfers')],
  optional: [pin('projects'), pin('migration')],
  services: ['files', 'history'],
  contributes: {
    http: [
      http('/api/vms/:vmId/files', ['GET']),
      http('/api/vms/:vmId/file', ['GET', 'PUT']),
      http('/api/vms/:vmId/history', ['GET', 'POST'], true),
      http('/api/vms/:vmId/transfer', ['GET', 'PUT']),
      http('/api/vms/:vmId/file-operation', ['POST']),
    ],
    tabs: ['files'],
  },
});
