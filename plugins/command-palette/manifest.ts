/**
 * 模块职责：“快捷命令面板”插件清单：搜索已启用功能、切换实例，按需接入命令与文件搜索。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'command-palette',
  name: '快捷命令面板',
  description: '搜索已启用功能、切换实例，按需接入命令与文件搜索。',
  category: 'workspace',
  optional: [pin('commands'), pin('project-search')],
});
