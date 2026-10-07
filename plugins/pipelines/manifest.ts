/**
 * 模块职责：“项目流水线”插件清单：构建步骤、运行记录与产物下载。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'pipelines',
  name: '项目流水线',
  description: '构建步骤、运行记录与产物下载。',
  category: 'development',
  requires: [pin('projects'), pin('files'), pin('transfers')],
  services: ['pipelines'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.pipelines","method":"GET","path":"/api/vms/{vmId}/pipelines","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.pipelines","method":"PUT","path":"/api/vms/{vmId}/pipelines","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.delete.vms.vmId.pipelines","method":"DELETE","path":"/api/vms/{vmId}/pipelines","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.pipelines","method":"POST","path":"/api/vms/{vmId}/pipelines","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
      {"id":"legacy.post.vms.vmId.pipeline-artifact","method":"POST","path":"/api/vms/{vmId}/pipeline-artifact","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/vms/:vmId/pipelines', ['GET', 'PUT', 'DELETE', 'POST'], true),
      http('/api/vms/:vmId/pipeline-artifact', ['POST'], true),
    ],
    tabs: ['development'],
    developmentSections: ['pipelines'],
  },
});
