/**
 * 模块职责：“监控组合”插件包成员声明：资源采样与项目服务健康检查，可分别启用。 包成员使用精确版本依赖，由选择解析器展开。
 */
import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'monitoring',
  name: '监控组合',
  description: '资源采样与项目服务健康检查，可分别启用。',
  members: [member('metrics'), member('service-health')],
  replacesPlugins: ['monitoring'],
});
