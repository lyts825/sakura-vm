/**
 * 模块职责（中文）：“完整兼容”插件包成员声明：全部内置可选插件，包括实验能力和后台任务。 包成员使用精确版本依赖，由选择解析器展开。
 * Module responsibility (English): exact-version members of the complete plugin pack for a user workflow.
 * 详细范围（中文）：公开入口包括 pack；职责覆盖按用户场景组合插件包 complete 的精确版本成员，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include pack. The scope covers exact-version members of the complete plugin pack for a user workflow. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'complete',
  name: '完整兼容',
  description: '全部内置可选插件，包括实验能力和后台任务。',
  members: [
    member('foundry', 'pack'),
    member('app-runtime', 'pack'),
    member('data-lab', 'pack'),
    member('delivery', 'pack'),
    member('transfers'),
    member('files'),
    member('images'),
    member('terminal-workspace'),
    member('snapshots'),
    member('backups'),
    member('projects'),
    member('recipes'),
    member('ide'),
    member('toolchains'),
    member('project-search'),
    member('code-checks'),
    member('commands'),
    member('pipelines'),
    member('runtimes'),
    member('git'),
    member('containers'),
    member('sandbox'),
    member('repair'),
    member('sync'),
    member('network'),
    member('secrets'),
    member('metrics'),
    member('service-health'),
    member('desktop'),
    member('library'),
    member('maintenance'),
    member('migration'),
    member('automation'),
    member('automation-scheduler'),
    member('extensions'),
    member('platform'),
    member('command-palette'),
  ],
});
