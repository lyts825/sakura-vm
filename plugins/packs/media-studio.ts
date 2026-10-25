import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({
  id: 'media-studio',
  name: '媒体资源制作',
  description: '探测和处理明确选择的媒体文件，制作字幕与资源集合，人工审核后交接。',
  members: [
    member('media-sources'),
    member('media-inspect'),
    member('media-recipes'),
    member('media-workers'),
    member('media-captions'),
    member('media-collections'),
    member('media-reviews'),
    member('media-exchange'),
    member('media-workbench'),
  ],
});
