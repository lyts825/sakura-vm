import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'transfers',
  name: '传输基础',
  description: '下载票据、流式传输与传输任务；文件与磁盘由对应插件提供。',
  category: 'foundation',
  optional: [pin('files'), pin('snapshots')],
  services: ['downloads'],
  contributes: { http: [http('/api/vms/:vmId/download', ['POST'])] },
});
