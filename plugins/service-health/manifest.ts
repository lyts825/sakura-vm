/**
 * 模块职责（中文）：“服务健康检查”插件清单：持续检查已配置的项目服务。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for continuous project-service health checks.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明项目服务持续健康检查的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for continuous project-service health checks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'service-health',
  name: '服务健康检查',
  description: '持续检查已配置的项目服务。',
  category: 'operations',
  requires: [pin('projects')],
  services: ['health'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.health","method":"GET","path":"/api/vms/{vmId}/health","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"read","projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/health', ['GET'], true)] },
});
