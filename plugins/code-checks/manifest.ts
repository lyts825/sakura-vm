import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'code-checks',
  name: '代码检查',
  description: '按文件检查语法和代码诊断。',
  category: 'development',
  requires: [pin('projects'), pin('files')],
  services: ['intelligence'],
  contributes: { http: [http('/api/vms/:vmId/code-diagnostics', ['GET'], true)] },
});
