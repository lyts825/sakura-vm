import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'code-checks',
  name: '代码与调试工具',
  description: '提供代码检查、TypeScript/JavaScript/Python LSP 语言服务和 Python DAP 调试。',
  category: 'development',
  requires: [pin('projects'), pin('files')],
  optional: [pin('migration')],
  services: ['intelligence', 'languageServices', 'debugger'],
  contributes: { http: [
    http('/api/vms/:vmId/code-diagnostics', ['GET'], true),
    http('/api/vms/:vmId/language-service', ['GET', 'POST'], true),
    http('/api/vms/:vmId/debugger', ['GET', 'POST'], true),
  ] },
});
