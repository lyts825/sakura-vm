/**
 * 模块职责：“传输基础”插件清单：下载票据、流式传输与传输任务；文件与磁盘由对应插件提供。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'transfers',
  name: '传输基础',
  description: '下载票据、流式传输与传输任务；文件与磁盘由对应插件提供。',
  category: 'foundation',
  optional: [pin('files'), pin('snapshots')],
  services: ['downloads'],
  contributes: {
    routes: [
      {"id":"legacy.post.vms.vmId.download","method":"POST","path":"/api/vms/{vmId}/download","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":201},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/download', ['POST'])] },
});
