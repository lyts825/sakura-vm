import { definePlugin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'migration',
  name: '数据目录迁移',
  description: '停机复制、校验并切换主机数据目录。',
  category: 'operations',
  services: ['migration'],
  contributes: { http: [http('/api/migration', ['GET', 'POST'])] },
});
