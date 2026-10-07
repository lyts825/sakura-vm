/**
 * 模块职责（中文）：“传输基础”插件清单：下载票据、流式传输与传输任务；文件与磁盘由对应插件提供。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for download tickets, streaming transfers and jobs.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明下载票据、流式传输与任务的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for download tickets, streaming transfers and jobs. Types, validation branches and cleanup paths define its data/behavior boundaries
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
