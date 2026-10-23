/** 完整数据与实验流程，无需启用完整交付或其他新包。 */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'data-lab',
  name: '数据与实验工作台',
  description: '本地表格、只读捕获、SQL、质量、Notebook、参数实验与离线数据交接。',
  members: [
    member('data-runtime'),
    member('data-sources'),
    member('data-datasets'),
    member('data-transforms'),
    member('data-quality'),
    member('data-notebooks'),
    member('data-experiments'),
    member('data-lineage'),
    member('data-exchange'),
    member('data-workbench'),
  ],
});
