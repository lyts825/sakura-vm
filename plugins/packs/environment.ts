/**
 * 模块职责（中文）：“环境互通组合”插件包成员声明：环境配方与 IDE 接入，可分别启用。 包成员使用精确版本依赖，由选择解析器展开。
 * Module responsibility (English): exact-version members of the environment plugin pack for a user workflow.
 * 详细范围（中文）：公开入口包括 pack；职责覆盖按用户场景组合插件包 environment 的精确版本成员，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include pack. The scope covers exact-version members of the environment plugin pack for a user workflow. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'environment',
  name: '环境互通组合',
  description: '环境配方与 IDE 接入，可分别启用。',
  members: [member('recipes'), member('ide')],
  replacesPlugins: ['environment'],
});
