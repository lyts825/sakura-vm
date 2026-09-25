import { definePlugin, pin } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'automation-scheduler',
  name: '自动化调度',
  description: '按计划启停实例、定期采样与阈值告警。',
  category: 'operations',
  requires: [pin('automation')],
  services: ['scheduler'],
});
