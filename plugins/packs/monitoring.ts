import { definePack, member } from '../../shared/plugin-protocol.ts';

export const pack = definePack({
  id: 'monitoring',
  name: '监控组合',
  description: '资源采样与项目服务健康检查，可分别启用。',
  members: [member('metrics'), member('service-health')],
  replacesPlugins: ['monitoring'],
});
