/**
 * 模块职责：“多终端工作区”插件清单：终端标签、分屏与 tmux 会话恢复。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
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
