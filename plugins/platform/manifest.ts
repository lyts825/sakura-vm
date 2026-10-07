/**
 * 模块职责：“平台扩展适配器”插件清单：远程、灾备、安全与协作适配器；按实际就绪状态提供。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'platform',
  name: '平台扩展适配器',
  description: '远程、灾备、安全与协作适配器；按实际就绪状态提供。',
  category: 'experimental',
  experimental: true,
  requires: [pin('projects')],
  optional: [pin('snapshots'), pin('backups'), pin('secrets')],
  systemDependencies: ["communityPlugins","mediaDevices","hostMounts","virtioFsShares","processInterop","hostPeers","notebookEnvironments","browserIde","coldMigrations","snapshotReplications","haHostFailover","haLocalFailovers","disasterRecovery","capabilityChecks"],
  services: ['next'],
  contributes: {
    routes: [
      {"id":"legacy.get.next-features","method":"GET","path":"/api/next-features","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.next-features","method":"GET","path":"/api/vms/{vmId}/next-features","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.next-features","method":"POST","path":"/api/vms/{vmId}/next-features","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
      {"id":"notebook-link","method":"GET","path":"/api/vms/{vmId}/notebook-link","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":false,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"browser-ide-link","method":"GET","path":"/api/vms/{vmId}/browser-ide-link","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":false,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/next-features', ['GET']),
      http('/api/vms/:vmId/next-features', ['GET', 'POST'], true),
      http('/api/vms/:vmId/notebook-link', ['GET'], true),
      http('/api/vms/:vmId/browser-ide-link', ['GET'], true)],
    operations: [
      operation('notebook-link', 'GET', '/api/vms/:vmId/notebook-link'),
      operation('browser-ide-link', 'GET', '/api/vms/:vmId/browser-ide-link'),
    ],
    pages: ['features'],
  },
});
