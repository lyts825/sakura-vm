/**
 * 模块职责：“图形桌面”插件包成员声明：图形 Linux 空间，配合文件、快照与镜像。 包成员使用精确版本依赖，由选择解析器展开。
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'desktop',
  name: '图形桌面',
  description: '图形 Linux 空间，配合文件、快照与镜像。',
  members: [member('desktop'), member('files'), member('snapshots'), member('images')],
});
