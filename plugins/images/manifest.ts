import { definePlugin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'images',
  name: '发行版镜像',
  description: '下载官方 Linux 云镜像，或校验并导入 RAW、VMDK、VHDX、OVA 镜像。',
  category: 'workspace',
  services: ['images', 'diskImports'],
  contributes: { http: [http('/api/images', ['GET', 'POST']), http('/api/image-import', ['POST'])], pages: ['images'] },
});
