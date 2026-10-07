/**
 * 模块职责（中文）：“实例整理”插件清单：分组、标签、收藏与批量启停。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for VM grouping, tags and batch operations.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明实例分组、标签与批量操作的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for VM grouping, tags and batch operations. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'library',
  name: '实例整理',
  description: '分组、标签、收藏与批量启停。',
  category: 'workspace',
  optional: [pin('recipes')],
  contributes: {
    routes: [
      {"id":"legacy.post.vms.batch","method":"POST","path":"/api/vms/batch","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.organization","method":"PUT","path":"/api/vms/{vmId}/organization","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/batch', ['POST']), http('/api/vms/:vmId/organization', ['PUT'])],
    pages: ['library'],
  },
});
