/** 完整接口验证包，仅附加 projects 与 secrets。 Full integration workflow with minimal existing dependencies. */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'integration-lab',
  name: '接口集成验证',
  description: '固定契约、样例、模拟、隔离请求、断言、有限负载与离线交接。',
  members: [
    member('integration-specs'),
    member('integration-environments'),
    member('integration-fixtures'),
    member('integration-mocks'),
    member('integration-scenarios'),
    member('integration-assertions'),
    member('integration-runners'),
    member('integration-load'),
    member('integration-reports'),
    member('integration-exchange'),
    member('integration-workbench'),
  ],
});
