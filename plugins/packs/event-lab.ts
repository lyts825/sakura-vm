import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'event-lab',
  name: '事件与队列实验',
  description: '固定消息与消费策略、隔离队列和独立消费者、逐投递轨迹、去重检查与离线交接。',
  members: [
    member('event-contracts'),
    member('event-fixtures'),
    member('event-producers'),
    member('event-consumers'),
    member('event-scenarios'),
    member('event-brokers'),
    member('event-runs'),
    member('event-assertions'),
    member('event-reports'),
    member('event-exchange'),
    member('event-workbench'),
  ],
});
