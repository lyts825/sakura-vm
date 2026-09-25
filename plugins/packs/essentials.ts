import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'essentials',
  name: '日常使用',
  description: '文件、快照、镜像与多终端。',
  members: [member('files'), member('snapshots'), member('images'), member('terminal-workspace')],
});
