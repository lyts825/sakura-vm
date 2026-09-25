import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'desktop',
  name: '图形桌面',
  description: '图形 Linux 空间，配合文件、快照与镜像。',
  members: [member('desktop'), member('files'), member('snapshots'), member('images')],
});
