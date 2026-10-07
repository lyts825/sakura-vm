/**
 * 模块职责：“开发工作台”插件包成员声明：项目、开发工具与环境互通，配合 Git、网络与命令面板。 包成员使用精确版本依赖，由选择解析器展开。
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'developer',
  name: '开发工作台',
  description: '项目、开发工具与环境互通，配合 Git、网络与命令面板。',
  members: [
    member('files'),
    member('projects'),
    member('git'),
    member('network'),
    member('secrets'),
    member('terminal-workspace'),
    member('command-palette'),
    member('development', 'pack'),
    member('environment', 'pack'),
  ],
});
