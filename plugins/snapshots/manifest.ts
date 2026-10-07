/**
 * 模块职责（中文）：“磁盘快照”插件清单：快照、恢复、差异比较、分支合并、克隆、只读救援、黄金镜像库以及独立磁盘包导入导出。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明快照、克隆、救援、黄金镜像和签名包的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'snapshots',
  name: '磁盘快照',
  description: '快照、恢复、差异比较、分支合并、克隆、只读救援、黄金镜像库以及独立磁盘包导入导出。',
  category: 'workspace',
  requires: [pin('transfers')],
  optional: [pin('backups')],
  systemDependencies: ["trustedBoot"],
  services: ['bundles', 'signedBundles', 'goldenImages', 'rescue', 'snapshotDiff', 'snapshotMerge'],
  lifecycle: { activateMs: 30000, closeMs: 180000 },
  contributes: {
    routes: [
      {"id":"golden-list","method":"GET","path":"/api/golden-images","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"golden-action","method":"POST","path":"/api/golden-images","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"rescue-view","method":"GET","path":"/api/vms/{vmId}/rescue","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"rescue-run","method":"POST","path":"/api/vms/{vmId}/rescue","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":202},
      {"id":"legacy.post.import","method":"POST","path":"/api/import","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"binary","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":201},
      {"id":"signed-bundles-view","method":"GET","path":"/api/signed-bundles","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"signed-bundles-action","method":"POST","path":"/api/signed-bundles","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"legacy.post.vms.vmId.snapshots","method":"POST","path":"/api/vms/{vmId}/snapshots","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":201},
      {"id":"legacy.patch.vms.vmId.snapshots.snapshotId","method":"PATCH","path":"/api/vms/{vmId}/snapshots/{snapshotId}","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.delete.vms.vmId.snapshots.snapshotId","method":"DELETE","path":"/api/vms/{vmId}/snapshots/{snapshotId}","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.snapshots.snapshotId.restore","method":"POST","path":"/api/vms/{vmId}/snapshots/{snapshotId}/restore","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"snapshot-diff-view","method":"GET","path":"/api/vms/{vmId}/snapshot-diff","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"snapshot-diff-run","method":"POST","path":"/api/vms/{vmId}/snapshot-diff","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":202},
      {"id":"snapshot-merge-view","method":"GET","path":"/api/vms/{vmId}/snapshot-merge","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"snapshot-merge-run","method":"POST","path":"/api/vms/{vmId}/snapshot-merge","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":202},
      {"id":"legacy.get.vms.vmId.export","method":"GET","path":"/api/vms/{vmId}/export","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":false,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.clone","method":"POST","path":"/api/vms/{vmId}/clone","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":201},
      {"id":"rescue-artifact","method":"GET","path":"/api/vms/{vmId}/rescue/artifact","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/golden-images', ['GET', 'POST']),
      http('/api/vms/:vmId/rescue', ['GET', 'POST']),
      http('/api/import', ['POST']),
      http('/api/signed-bundles', ['GET', 'POST']),
      http('/api/vms/:vmId/snapshots', ['POST', 'PATCH', 'DELETE']),
      http('/api/vms/:vmId/snapshot-diff', ['GET', 'POST']),
      http('/api/vms/:vmId/snapshot-merge', ['GET', 'POST']),
      http('/api/vms/:vmId/export', ['GET']),
      http('/api/vms/:vmId/clone', ['POST']),
    ],
    operations: [
      operation('golden-list', 'GET', '/api/golden-images'),
      operation('signed-bundles-view', 'GET', '/api/signed-bundles'),
      operation('signed-bundles-action', 'POST', '/api/signed-bundles'),
      operation('golden-action', 'POST', '/api/golden-images'),
      operation('rescue-view', 'GET', '/api/vms/:vmId/rescue'),
      operation('rescue-artifact', 'GET', '/api/vms/:vmId/rescue/artifact'),
      operation('rescue-run', 'POST', '/api/vms/:vmId/rescue', 202),
      operation('snapshot-diff-view', 'GET', '/api/vms/:vmId/snapshot-diff'),
      operation('snapshot-diff-run', 'POST', '/api/vms/:vmId/snapshot-diff', 202),
      operation('snapshot-merge-view', 'GET', '/api/vms/:vmId/snapshot-merge'),
      operation('snapshot-merge-run', 'POST', '/api/vms/:vmId/snapshot-merge', 202),
    ],
    tabs: ['snapshots'],
  },
});
