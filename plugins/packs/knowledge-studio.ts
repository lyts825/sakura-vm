/** 零 VM 知识整理、审阅和离线交接。 Zero-VM knowledge authoring and handover. */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'knowledge-studio',
  name: '项目知识与文档工作台',
  description: '固定材料、中文检索、引用、四类文稿、人工审阅、本机阅读与离线交接。',
  members: [
    member('knowledge-sources'),
    member('knowledge-extract'),
    member('knowledge-index'),
    member('knowledge-evidence'),
    member('knowledge-entries'),
    member('knowledge-documents'),
    member('knowledge-reviews'),
    member('knowledge-publish'),
    member('knowledge-exchange'),
    member('knowledge-workbench'),
  ],
});
