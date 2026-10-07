/**
 * 模块职责（中文）：“收藏命令”插件清单：参数化项目命令、执行与日志。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for project command presets and execution.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明项目命令预设与执行的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for project command presets and execution. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin, http, operation } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'commands',
  name: '收藏命令',
  description: '参数化项目命令、执行与日志。',
  category: 'development',
  requires: [pin('projects')],
  services: ['commands'],
  contributes: {
    routes: [
      {"id":"list","method":"GET","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"allow","transport":"json","mutating":false,"session":"required","vmLock":"allow-locked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"save","method":"PUT","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"remove","method":"DELETE","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":200},
      {"id":"run","method":"POST","path":"/api/vms/{vmId}/commands","policy":{"access":"controller","roles":["owner"],"projectScoped":true,"identity":"fixed-vm","maintenance":"block","transport":"json","mutating":true,"session":"required","vmLock":"require-unlocked","projectBinding":"query","approval":"none","extensionAuth":"none"},"handler":"operation","status":202},
    ], managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'],
    http: [http('/api/vms/:vmId/commands', ['GET', 'PUT', 'DELETE', 'POST'], true)],
    operations: [
      operation('list', 'GET', '/api/vms/:vmId/commands'),
      operation('save', 'PUT', '/api/vms/:vmId/commands'),
      operation('remove', 'DELETE', '/api/vms/:vmId/commands'),
      operation('run', 'POST', '/api/vms/:vmId/commands', 202),
    ],
    tabs: ['development'],
    developmentSections: ['commands'],
  },
});
