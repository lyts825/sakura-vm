/**
 * 模块职责：“日常使用”插件包成员声明：文件、快照、镜像与多终端。 包成员使用精确版本依赖，由选择解析器展开。
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'essentials',
  name: '日常使用',
  description: '文件、快照、镜像与多终端。',
  members: [member('files'), member('snapshots'), member('images'), member('terminal-workspace')],
});
