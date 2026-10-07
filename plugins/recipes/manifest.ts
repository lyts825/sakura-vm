/**
 * 模块职责（中文）：“环境配方”插件清单：导入、导出及应用 sakura.json 项目环境配方。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for project environment recipe import/export.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明项目环境配方的导入导出的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for project environment recipe import/export. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'recipes',
  name: '环境配方',
  description: '导入、导出及应用 sakura.json 项目环境配方。',
  category: 'development',
  requires: [pin('projects')],
  services: ['recipes'],
  contributes: {
    routes: [
      {"id":"legacy.post.recipes","method":"POST","path":"/api/recipes","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":201},
      {"id":"legacy.get.vms.vmId.recipe","method":"GET","path":"/api/vms/{vmId}/recipe","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.recipe","method":"PUT","path":"/api/vms/{vmId}/recipe","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.recipe","method":"POST","path":"/api/vms/{vmId}/recipe","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/recipes', ['POST']), http('/api/vms/:vmId/recipe', ['GET', 'PUT', 'POST'], true)],
  },
});
