/**
 * 模块职责：“IDE 接入”插件清单：VS Code Remote-SSH 配置与项目连接。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'ide',
  name: 'IDE 接入',
  description: 'VS Code Remote-SSH 配置与项目连接。',
  category: 'development',
  requires: [pin('projects')],
  services: ['ide'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.ide","method":"GET","path":"/api/vms/{vmId}/ide","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.ide","method":"POST","path":"/api/vms/{vmId}/ide","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/ide', ['GET', 'POST'], true)] },
});
