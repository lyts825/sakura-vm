/**
 * 模块职责（中文）：“发行版镜像”插件清单：下载官方 Linux 云镜像，或校验并导入 RAW、VMDK、VHDX、OVA 镜像。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for cloud-image downloads and external disk imports.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明云镜像下载与外部磁盘导入的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for cloud-image downloads and external disk imports. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
