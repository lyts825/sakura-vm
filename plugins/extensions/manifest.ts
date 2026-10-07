/**
 * 模块职责：“工程扩展适配器”插件清单：工程操作与能力检查；只依赖项目，不启动自动化调度。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
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
