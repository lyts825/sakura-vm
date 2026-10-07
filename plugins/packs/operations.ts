/**
 * 模块职责：“运维与备份”插件包成员声明：备份、同步、监控、维护、整理与迁移。 包成员使用精确版本依赖，由选择解析器展开。
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'operations',
  name: '运维与备份',
  description: '备份、同步、监控、维护、整理与迁移。',
  members: [
    member('backups'),
    member('sync'),
    member('maintenance'),
    member('library'),
    member('migration'),
    member('monitoring', 'pack'),
  ],
});
