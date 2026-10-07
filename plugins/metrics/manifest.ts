/**
 * 模块职责（中文）：“资源采样”插件清单：独立采样客户机 CPU、内存、磁盘与进程，无需项目服务。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for guest resource and process sampling.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明客户机资源与进程采样的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for guest resource and process sampling. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'metrics',
  name: '资源采样',
  description: '独立采样客户机 CPU、内存、磁盘与进程，无需项目服务。',
  category: 'operations',
  services: ['metrics'],
  contributes: {
    routes: [
      {"id":"sample","method":"GET","path":"/api/vms/{vmId}/metrics","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/metrics', ['GET'])],
    operations: [operation('sample', 'GET', '/api/vms/:vmId/metrics')],
    tabs: ['metrics'],
  },
});
