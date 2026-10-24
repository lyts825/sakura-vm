/** 组合精确版本成员，不持有执行或资产权限。 Pin members without owning execution or assets. */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'resilience-lab',
  name: '可靠性演练工作台',
  description: '固定来源、专用副本、有限故障、业务恢复与离线证据交接。',
  members: [
    member('resilience-targets'),
    member('resilience-fixtures'),
    member('resilience-guard'),
    member('resilience-faults'),
    member('resilience-probes'),
    member('resilience-recovery'),
    member('resilience-scenarios'),
    member('resilience-runs'),
    member('resilience-reports'),
    member('resilience-workbench'),
  ],
});
