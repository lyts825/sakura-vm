/**
 * 模块职责（中文）：“网络管理”插件清单：端口转发、代理、软件源与网络诊断。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for ports, network profiles, ingress and certificates.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明端口、网络档案、入口与证书的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for ports, network profiles, ingress and certificates. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'network',
  name: '网络管理',
  description: '端口转发、代理、软件源与网络诊断。',
  category: 'operations',
  optional: [pin('projects')],
  services: ['network', 'certificates', 'ingress', 'localAliases'],
  contributes: {
    routes: [
      {"id":"legacy.get.network-profiles","method":"GET","path":"/api/network-profiles","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.network-profiles","method":"POST","path":"/api/network-profiles","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.delete.network-profiles","method":"DELETE","path":"/api/network-profiles","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.network","method":"GET","path":"/api/vms/{vmId}/network","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.network","method":"POST","path":"/api/vms/{vmId}/network","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.services","method":"GET","path":"/api/vms/{vmId}/services","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.patch.vms.vmId.services","method":"PATCH","path":"/api/vms/{vmId}/services","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"ingress-view","method":"GET","path":"/api/ingress","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"ingress-action","method":"POST","path":"/api/ingress","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"ingress-certificate-view","method":"GET","path":"/api/ingress-certificate","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"ingress-certificate-action","method":"POST","path":"/api/ingress-certificate","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"local-aliases-view","method":"GET","path":"/api/local-aliases","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"local-aliases-action","method":"POST","path":"/api/local-aliases","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"host","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [
      http('/api/network-profiles', ['GET', 'POST', 'DELETE']),
      http('/api/vms/:vmId/network', ['GET', 'POST'], true),
      http('/api/vms/:vmId/services', ['GET', 'PATCH']),
      http('/api/ingress', ['GET', 'POST']),
      http('/api/ingress-certificate', ['GET', 'POST']),
      http('/api/local-aliases', ['GET', 'POST']),
    ],
    operations: [
      operation('ingress-view', 'GET', '/api/ingress'),
      operation('ingress-action', 'POST', '/api/ingress'),
      operation('ingress-certificate-view', 'GET', '/api/ingress-certificate'),
      operation('ingress-certificate-action', 'POST', '/api/ingress-certificate'),
      operation('local-aliases-view', 'GET', '/api/local-aliases'),
      operation('local-aliases-action', 'POST', '/api/local-aliases'),
    ],
    tabs: ['services', 'development'],
    developmentSections: ['network'],
  },
});
