/**
 * 模块职责（中文）：“数据目录迁移”插件清单：停机复制、校验并切换主机数据目录。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for host data-directory migration.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明主机数据目录迁移的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for host data-directory migration. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'migration',
  name: '数据目录迁移',
  description: '停机复制、校验并切换主机数据目录。',
  category: 'operations',
  services: ['migration'],
  contributes: {
    routes: [
      {"id":"legacy.get.migration","method":"GET","path":"/api/migration","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.migration","method":"POST","path":"/api/migration","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/migration', ['GET', 'POST'])] },
});
