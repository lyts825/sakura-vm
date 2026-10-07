/**
 * 模块职责：“环境互通组合”插件包成员声明：环境配方与 IDE 接入，可分别启用。 包成员使用精确版本依赖，由选择解析器展开。
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'environment',
  name: '环境互通组合',
  description: '环境配方与 IDE 接入，可分别启用。',
  members: [member('recipes'), member('ide')],
  replacesPlugins: ['environment'],
});
