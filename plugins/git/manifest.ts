/**
 * 模块职责：“Git 工作台”插件清单：差异、暂存、提交、分支与远程仓库。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'git',
  name: 'Git 工作台',
  description: '差异、暂存、提交、分支与远程仓库。',
  category: 'development',
  requires: [pin('projects')],
  services: ['git'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.git","method":"GET","path":"/api/vms/{vmId}/git","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"read","projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.git","method":"POST","path":"/api/vms/{vmId}/git","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"execute","projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/git', ['GET', 'POST'], true)], tabs: ['git'] },
});
