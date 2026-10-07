/**
 * 模块职责（中文）：“工程扩展适配器”插件清单：工程操作与能力检查；只依赖项目，不启动自动化调度。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for engineering extensions and capability checks.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明工程扩展与能力检查的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for engineering extensions and capability checks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'extensions',
  name: '工程扩展适配器',
  description: '工程操作与能力检查；只依赖项目，不启动自动化调度。',
  category: 'experimental',
  experimental: true,
  requires: [pin('projects')],
  optional: [pin('ide')],
  systemDependencies: ["trustedBoot","projectTerminals"],
  services: ['extended'],
  contributes: {
    routes: [
      {"id":"legacy.get.extended-features","method":"GET","path":"/api/extended-features","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.extended-features","method":"GET","path":"/api/vms/{vmId}/extended-features","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.extended-features","method":"POST","path":"/api/vms/{vmId}/extended-features","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/extended-features', ['GET']),
      http('/api/vms/:vmId/extended-features', ['GET', 'POST'], true),
    ],
    pages: ['features'],
  },
});
