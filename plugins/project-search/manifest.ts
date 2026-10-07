/**
 * 模块职责：“项目搜索”插件清单：项目文件索引、文件名与内容搜索。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'project-search',
  name: '项目搜索',
  description: '项目文件索引、文件名与内容搜索。',
  category: 'development',
  requires: [pin('projects'), pin('files')],
  services: ['projectFiles'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.project-files","method":"GET","path":"/api/vms/{vmId}/project-files","policy":{"access":"controller","roles":["owner","member"],"projectPermission":"read","projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/project-files', ['GET'], true)] },
});
