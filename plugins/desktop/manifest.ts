/**
 * 模块职责（中文）：“Linux 图形桌面”插件清单：按需安装 KDE Plasma、浏览器桌面、单应用窗口、原生 X11/Wayland 剪贴板策略与中文输入法。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for graphical desktops, single-application windows and clipboard policy.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明图形桌面、单应用窗口与剪贴板的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for graphical desktops, single-application windows and clipboard policy. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'desktop',
  name: 'Linux 图形桌面',
  description: '按需安装 KDE Plasma、浏览器桌面、单应用窗口、原生 X11/Wayland 剪贴板策略与中文输入法。',
  category: 'experimental',
  experimental: true,
  lifecycle: { activateMs: 30000, closeMs: 120000 },
  requires: [pin('projects')],
  services: ['desktops', 'jobs', 'x11Clipboard', 'waylandClipboard'],
  contributes: {
    routes: [
      {"id":"legacy.get.vms.vmId.desktop","method":"GET","path":"/api/vms/{vmId}/desktop","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.desktop","method":"POST","path":"/api/vms/{vmId}/desktop","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.get.vms.vmId.single-app","method":"GET","path":"/api/vms/{vmId}/single-app","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.single-app","method":"POST","path":"/api/vms/{vmId}/single-app","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"x11-clipboard-get","method":"GET","path":"/api/vms/{vmId}/x11-clipboard","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"x11-clipboard-action","method":"POST","path":"/api/vms/{vmId}/x11-clipboard","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"wayland-clipboard-get","method":"GET","path":"/api/vms/{vmId}/wayland-clipboard","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"wayland-clipboard-action","method":"POST","path":"/api/vms/{vmId}/wayland-clipboard","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"legacy.get.vms.vmId.ime","method":"GET","path":"/api/vms/{vmId}/ime","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":200},
      {"id":"legacy.post.vms.vmId.ime","method":"POST","path":"/api/vms/{vmId}/ime","policy":{"access":"controller","roles":["owner"],"projectScoped":false,"identity":"lifecycle","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"none","approval":"none","extensionAuth":"none"},"handler":"route","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/desktop', ['GET', 'POST'], true),
      http('/api/vms/:vmId/single-app', ['GET', 'POST'], true),
      http('/api/vms/:vmId/x11-clipboard', ['GET', 'POST'], true),
      http('/api/vms/:vmId/wayland-clipboard', ['GET', 'POST'], true),
      http('/api/vms/:vmId/ime', ['GET', 'POST'])],
    sockets: ['desktop'],
    operations: [operation('x11-clipboard-get', 'GET', '/api/vms/:vmId/x11-clipboard'),
      operation('x11-clipboard-action', 'POST', '/api/vms/:vmId/x11-clipboard'),
      operation('wayland-clipboard-get', 'GET', '/api/vms/:vmId/wayland-clipboard'),
      operation('wayland-clipboard-action', 'POST', '/api/vms/:vmId/wayland-clipboard')],
    tabs: ['desktop'],
  },
});
