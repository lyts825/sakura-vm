import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'flow-studio',
  name: '本机流程工作台',
  description: '固定 DAG、逐阶段原账户批准、原服务委派、等待恢复与隔离交接。',
  members: [
    member('flow-definitions'),
    member('flow-inputs'),
    member('flow-connectors'),
    member('flow-plans'),
    member('flow-approvals'),
    member('flow-journal'),
    member('flow-runs'),
    member('flow-timers'),
    member('flow-exchange'),
    member('flow-workbench'),
  ],
});
