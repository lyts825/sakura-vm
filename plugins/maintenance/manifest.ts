/**
 * 模块职责（中文）：“磁盘与诊断”插件清单：故障诊断、磁盘扩容、空间检查与 QCOW2 整理。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for VM diagnostics, disk growth and maintenance.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明实例诊断、磁盘扩容与整理的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for VM diagnostics, disk growth and maintenance. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'maintenance',
  name: '磁盘与诊断',
  description: '故障诊断、磁盘扩容、空间检查与 QCOW2 整理。',
  category: 'operations',
  services: ['maintenance'],
  systemDependencies: ['retention'],
  contributes: {
    routes: [
      { id: 'cleanup.providers', method: 'GET', path: '/api/cleanup', policy: { access: 'controller', roles: ['owner'], projectScoped: false, identity: 'host', maintenance: 'allow', transport: 'json', mutating: false, session: 'required', vmLock: 'allow-locked', projectBinding: 'none', approval: 'none', extensionAuth: 'none' }, handler: 'route', status: 200 },
      { id: 'cleanup.preview', method: 'POST', path: '/api/cleanup/preview', policy: { access: 'controller', roles: ['owner'], projectScoped: false, identity: 'host', maintenance: 'block', transport: 'json', mutating: false, session: 'required', vmLock: 'allow-locked', projectBinding: 'none', approval: 'none', extensionAuth: 'none' }, handler: 'route', status: 200 },
      { id: 'cleanup.execute', method: 'POST', path: '/api/cleanup/execute', policy: { access: 'controller', roles: ['owner'], projectScoped: false, identity: 'host', maintenance: 'block', transport: 'json', mutating: true, session: 'required', vmLock: 'allow-locked', projectBinding: 'none', approval: 'none', extensionAuth: 'none' }, handler: 'route', status: 200 },
      {"id":"legacy.get.storage","method":"GET","path":"/api/storage","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.diagnostics","method":"GET","path":"/api/vms/{vmId}/diagnostics","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.diagnostics","method":"POST","path":"/api/vms/{vmId}/diagnostics","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
      {"id":"legacy.post.vms.vmId.resize","method":"POST","path":"/api/vms/{vmId}/resize","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
      {"id":"legacy.post.vms.vmId.compact","method":"POST","path":"/api/vms/{vmId}/compact","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
      {"id":"legacy.get.vms.vmId.disk-maintenance","method":"GET","path":"/api/vms/{vmId}/disk-maintenance","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.disk-maintenance","method":"PUT","path":"/api/vms/{vmId}/disk-maintenance","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.disk-maintenance","method":"POST","path":"/api/vms/{vmId}/disk-maintenance","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/cleanup', ['GET', 'POST']),
      http('/api/storage', ['GET']),
      http('/api/vms/:vmId/diagnostics', ['GET', 'POST']),
      http('/api/vms/:vmId/resize', ['POST']),
      http('/api/vms/:vmId/compact', ['POST']),
      http('/api/vms/:vmId/disk-maintenance', ['GET', 'PUT', 'POST']),
    ],
    tabs: ['maintenance'],
  },
});
