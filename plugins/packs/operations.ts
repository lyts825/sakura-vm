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
