import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'code-checks',
  name: '代码与语言服务',
  description: '检查语法并提供 TypeScript、JavaScript 与 Python 的 LSP 补全、跳转、重命名和诊断。',
  category: 'development',
  requires: [pin('projects'), pin('files')],
  optional: [pin('migration')],
  services: ['intelligence', 'languageServices'],
  contributes: { http: [
    http('/api/vms/:vmId/code-diagnostics', ['GET'], true),
    http('/api/vms/:vmId/language-service', ['GET', 'POST'], true),
  ] },
});
