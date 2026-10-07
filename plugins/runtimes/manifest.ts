/**
 * 模块职责（中文）：“运行时版本”插件清单：Node.js、Python 等项目运行时的选择和安装。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for project runtime version selection and installation.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明项目运行时版本选择和安装的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for project runtime version selection and installation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'runtimes',
  name: '运行时版本',
  description: 'Node.js、Python 等项目运行时的选择和安装。',
  category: 'development',
  requires: [pin('projects')],
  services: ['runtimes'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.runtimes","method":"GET","path":"/api/vms/{vmId}/runtimes","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.runtimes","method":"POST","path":"/api/vms/{vmId}/runtimes","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/runtimes', ['GET', 'POST'], true)],
    tabs: ['development'],
    developmentSections: ['runtimes'],
  },
});
