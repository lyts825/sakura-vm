/**
 * 模块职责（中文）：“开发工作台”插件包成员声明：项目、开发工具与环境互通，配合 Git、网络与命令面板。 包成员使用精确版本依赖，由选择解析器展开。
 * Module responsibility (English): exact-version members of the developer plugin pack for a user workflow.
 * 详细范围（中文）：公开入口包括 pack；职责覆盖按用户场景组合插件包 developer 的精确版本成员，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include pack. The scope covers exact-version members of the developer plugin pack for a user workflow. Types, validation branches and cleanup paths define its data/behavior boundaries
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
