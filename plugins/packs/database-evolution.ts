import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'database-evolution',
  name: '数据库演进演练',
  description: '审阅固定输入，在独立 PostgreSQL 副本执行声明式变更，并核对完整数据与独立恢复结果。',
  members: [
    member('database-sources'),
    member('database-schemas'),
    member('database-changes'),
    member('database-fixtures'),
    member('database-runners'),
    member('database-checks'),
    member('database-rehearsals'),
    member('database-reports'),
    member('database-exchange'),
    member('database-workbench'),
  ],
});
