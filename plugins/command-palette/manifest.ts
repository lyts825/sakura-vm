/**
 * 模块职责（中文）：“快捷命令面板”插件清单：搜索已启用功能、切换实例，按需接入命令与文件搜索。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for command search and navigation.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明命令搜索与导航的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for command search and navigation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'command-palette',
  name: '快捷命令面板',
  description: '搜索已启用功能、切换实例，按需接入命令与文件搜索。',
  category: 'workspace',
  optional: [pin('commands'), pin('project-search')],
});
