/** 项目交付完整流程；隐式依赖由插件解析器去重。
 * Compose the complete delivery workflow; the resolver deduplicates implicit dependencies. */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'delivery',
  name: '项目交付工作台',
  description: '固定输入、隔离构建、证据门禁、制品预览和可信离线交接。',
  members: [
    member('delivery-artifacts'),
    member('delivery-inputs'),
    member('delivery-runners'),
    member('delivery-reports'),
    member('delivery-previews'),
    member('delivery-gates'),
    member('delivery-releases'),
    member('delivery-workbench'),
    member('command-palette'),
  ],
});
