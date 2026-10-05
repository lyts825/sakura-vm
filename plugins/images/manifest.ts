import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'images',
  name: '发行版镜像',
  description: '下载官方 Linux 云镜像，或校验并导入 RAW、VMDK、VHDX、OVA 镜像。',
  category: 'workspace',
  optional: [pin('snapshots'), pin('backups')],
  services: ['images', 'diskImports'],
  contributes: {
    routes: [
      {"id":"legacy.get.images","method":"GET","path":"/api/images","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.images.imageId","method":"POST","path":"/api/images/{imageId}","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
      {"id":"legacy.post.image-import","method":"POST","path":"/api/image-import","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"binary","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":201},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/images', ['GET', 'POST']), http('/api/image-import', ['POST'])], pages: ['images'] },
});
