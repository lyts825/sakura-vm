/**
 * 模块职责：“自动化调度”插件清单：按计划启停实例、定期采样与阈值告警。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'automation-scheduler',
  name: '自动化调度',
  description: '按计划启停实例、定期采样与阈值告警。',
  category: 'operations',
  requires: [pin('automation')],
  contributes: { managed: ['job-retry', 'jobs', 'schedule', 'event', 'interceptor'] },
  services: ['scheduler'],
});
