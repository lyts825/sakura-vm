/**
 * 模块职责（中文）：“开发工具组合”插件包成员声明：工具、搜索、检查、命令、流水线与运行时，可逐项启用。 包成员使用精确版本依赖，由选择解析器展开。
 * Module responsibility (English): exact-version members of the development plugin pack for a user workflow.
 * 详细范围（中文）：公开入口包括 pack；职责覆盖按用户场景组合插件包 development 的精确版本成员，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include pack. The scope covers exact-version members of the development plugin pack for a user workflow. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'development',
  name: '开发工具组合',
  description: '工具、搜索、检查、命令、流水线与运行时，可逐项启用。',
  members: [
    member('toolchains'),
    member('project-search'),
    member('code-checks'),
    member('commands'),
    member('pipelines'),
    member('runtimes'),
  ],
  replacesPlugins: ['development'],
});
