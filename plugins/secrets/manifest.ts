/**
 * 模块职责（中文）：“私密配置”插件清单：主机私密配置存储与项目环境变量引用。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for private configuration references and rotation.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明私密配置引用与轮换的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for private configuration references and rotation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'secrets',
  name: '私密配置',
  description: '主机私密配置存储与项目环境变量引用。',
  category: 'operations',
  optional: [pin('projects')],
  services: ['secrets'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.secrets","method":"GET","path":"/api/vms/{vmId}/secrets","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.put.vms.vmId.secrets","method":"PUT","path":"/api/vms/{vmId}/secrets","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.delete.vms.vmId.secrets","method":"DELETE","path":"/api/vms/{vmId}/secrets","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.secret-rotation","method":"GET","path":"/api/vms/{vmId}/secret-rotation","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.patch.vms.vmId.secret-rotation","method":"PATCH","path":"/api/vms/{vmId}/secret-rotation","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/vms/:vmId/secrets', ['GET', 'PUT', 'DELETE'], true),
      http('/api/vms/:vmId/secret-rotation', ['GET', 'PATCH'], true),
    ],
    tabs: ['development'],
    developmentSections: ['secrets'],
  },
});
