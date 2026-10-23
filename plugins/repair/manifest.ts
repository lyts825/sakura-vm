/** 可选单文件修复插件，模型与沙箱能力由声明的提供者供给。
 * Optional single-file repair plugin, using declared model and sandbox providers. */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'repair', name: 'AI 修复会话', description: '预览发送选中文件、审阅单文件补丁、隔离验证后接受。', category: 'development',
  requires: [pin('projects'), pin('sandbox'), pin('files')], systemDependencies: ['assistant'], services: ['repair'],
  contributes: {
    tabs: ['development'], developmentSections: ['repair'],
    http: [http('/api/vms/:vmId/repair', ['GET', 'POST'], true)],
    routes: [
      { id: 'view', method: 'GET', path: '/api/vms/{vmId}/repair', handler: 'route', status: 200,
        policy: { access: 'controller', roles: ['owner'], projectScoped: true, identity: 'fixed-vm', maintenance: 'allow',
          transport: 'json', mutating: false, session: 'required', vmLock: 'allow-locked', projectBinding: 'query', approval: 'none', extensionAuth: 'none' } },
      { id: 'act', method: 'POST', path: '/api/vms/{vmId}/repair', handler: 'route', status: 200,
        policy: { access: 'controller', roles: ['owner'], projectScoped: true, identity: 'fixed-vm', maintenance: 'block',
          transport: 'json', mutating: true, session: 'required', vmLock: 'require-unlocked', projectBinding: 'query', approval: 'none', extensionAuth: 'none' } },
    ],
  },
});
