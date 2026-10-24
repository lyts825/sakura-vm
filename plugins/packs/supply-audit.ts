/** 锁文件、公告、许可、信任、门槛、例外和离线交接。 */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'supply-audit',
  name: '软件供应审查',
  description: '固定依赖材料，核对公告与来源，保留人工例外和可追溯交接。',
  members: [
    member('supply-sources'),
    member('supply-inventory'),
    member('supply-advisories'),
    member('supply-licenses'),
    member('supply-provenance'),
    member('supply-policies'),
    member('supply-reviews'),
    member('supply-reports'),
    member('supply-exchange'),
    member('supply-workbench'),
  ],
});
