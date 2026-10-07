/**
 * 模块职责（中文）：“多终端工作区”插件清单：终端标签、分屏与 tmux 会话恢复。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for terminal tabs, splits and session restoration.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明终端标签、分屏和会话恢复的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for terminal tabs, splits and session restoration. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, http, pin } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'terminal-workspace',
  name: '多终端工作区',
  description: '终端标签、分屏与 tmux 会话恢复。',
  category: 'workspace',
  optional: [pin('projects')],
  services: ['terminals'],
  contributes: {
    routes: [
      {"id":"legacy.post.vms.vmId.terminal-session","method":"POST","path":"/api/vms/{vmId}/terminal-session","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [http('/api/vms/:vmId/terminal-session', ['POST'], true)], sockets: ['terminal-session'] },
});
