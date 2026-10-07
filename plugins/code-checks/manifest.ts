/**
 * 模块职责：“代码与调试工具”插件清单：提供代码检查、TypeScript/JavaScript/Python LSP 语言服务和 Python DAP 调试。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'code-checks',
  name: '代码与调试工具',
  description: '提供代码检查、TypeScript/JavaScript/Python LSP 语言服务和 Python DAP 调试。',
  category: 'development',
  requires: [pin('projects'), pin('files')],
  optional: [pin('migration')],
  services: ['intelligence', 'languageServices', 'debugger'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.code-diagnostics","method":"GET","path":"/api/vms/{vmId}/code-diagnostics","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.language-service","method":"GET","path":"/api/vms/{vmId}/language-service","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.language-service","method":"POST","path":"/api/vms/{vmId}/language-service","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.debugger","method":"GET","path":"/api/vms/{vmId}/debugger","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.debugger","method":"POST","path":"/api/vms/{vmId}/debugger","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'], http: [
    http('/api/vms/:vmId/code-diagnostics', ['GET'], true),
    http('/api/vms/:vmId/language-service', ['GET', 'POST'], true),
    http('/api/vms/:vmId/debugger', ['GET', 'POST'], true),
  ] },
});
