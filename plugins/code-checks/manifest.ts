/**
 * 模块职责（中文）：“代码与调试工具”插件清单：提供代码检查、TypeScript/JavaScript/Python LSP 语言服务和 Python DAP 调试。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for code checks, language services and debugging.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明代码检查、语言服务与调试的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for code checks, language services and debugging. Types, validation branches and cleanup paths define its data/behavior boundaries
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
