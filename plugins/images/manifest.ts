import { definePlugin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'images',
  name: '发行版镜像',
  description: '按需下载并校验 Alpine、Debian 和 Ubuntu 官方镜像。',
  category: 'workspace',
  services: ['images'],
  contributes: { http: [http('/api/images', ['GET', 'POST'])], pages: ['images'] },
});
