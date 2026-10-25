import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'browser-lab',
  name: '浏览器验收工作台',
  description: '固定样站、声明式旅程、真实Chromium、像素与有限可访问性检查及离线报告。',
  members: [
    member('browser-targets'),
    member('browser-fixtures'),
    member('browser-journeys'),
    member('browser-runners'),
    member('browser-assertions'),
    member('browser-visual'),
    member('browser-accessibility'),
    member('browser-reports'),
    member('browser-exchange'),
    member('browser-workbench'),
  ],
});
