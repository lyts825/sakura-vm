import { definePlugin, http, pin } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'terminal-workspace',
  name: '多终端工作区',
  description: '终端标签、分屏与 tmux 会话恢复。',
  category: 'workspace',
  optional: [pin('projects')],
  services: ['terminals'],
  contributes: { http: [http('/api/vms/:vmId/terminal-session', ['POST'], true)], sockets: ['terminal-session'] },
});
