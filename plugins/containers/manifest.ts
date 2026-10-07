/**
 * 模块职责（中文）：“容器工作台”插件清单：Docker、Compose、Dev Container 与官方模板。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for containers, Compose and development containers.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明容器、Compose 与开发容器的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for containers, Compose and development containers. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'containers',
  name: '容器工作台',
  description: 'Docker、Compose、Dev Container 与官方模板。',
  category: 'development',
  requires: [pin('projects')],
  services: ['containers'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.containers","method":"GET","path":"/api/vms/{vmId}/containers","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.containers","method":"POST","path":"/api/vms/{vmId}/containers","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/containers', ['GET', 'POST'], true)], tabs: ['containers'] },
});
