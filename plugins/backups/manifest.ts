/**
 * 模块职责（中文）：“备份策略”插件清单：定时、保留策略、加密与外部目录备份。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for backup policy, retention and file recovery.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明备份策略、保留与文件恢复的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for backup policy, retention and file recovery. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'backups',
  name: '备份策略',
  description: '定时、保留策略、加密与外部目录备份。',
  category: 'operations',
  requires: [pin('snapshots'), pin('secrets'), pin('transfers')],
  services: ['backups', 'backupRecovery'],
  lifecycle: { activateMs: 30000, closeMs: 180000 },
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.backups","method":"GET","path":"/api/vms/{vmId}/backups","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.backups","method":"PUT","path":"/api/vms/{vmId}/backups","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.backups","method":"POST","path":"/api/vms/{vmId}/backups","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.backup-download","method":"POST","path":"/api/vms/{vmId}/backup-download","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"recovery-view","method":"GET","path":"/api/vms/{vmId}/backup-recovery","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"recovery-run","method":"POST","path":"/api/vms/{vmId}/backup-recovery","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":202},
      {"id":"recovery-artifact","method":"GET","path":"/api/vms/{vmId}/backup-recovery/artifact","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/vms/:vmId/backups', ['GET', 'PUT', 'POST']),
      http('/api/vms/:vmId/backup-download', ['POST']),
      http('/api/vms/:vmId/backup-recovery', ['GET', 'POST']),
    ],
    operations: [
      operation('recovery-view', 'GET', '/api/vms/:vmId/backup-recovery'),
      operation('recovery-run', 'POST', '/api/vms/:vmId/backup-recovery', 202),
      operation('recovery-artifact', 'GET', '/api/vms/:vmId/backup-recovery/artifact'),
    ],
  },
});
