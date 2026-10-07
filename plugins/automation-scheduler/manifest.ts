/**
 * 模块职责（中文）：“自动化调度”插件清单：按计划启停实例、定期采样与阈值告警。 声明依赖、服务和界面/路由贡献，供插件解析与准入发布使用。
 * Module responsibility (English): declarations of dependencies, services, admission policy and UI contributions for scheduled start/stop, resource sampling and alerts.
 * 详细范围（中文）：公开入口包括 manifest；职责覆盖声明计划启停、资源采样与告警的依赖、服务、准入策略和界面贡献，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include manifest. The scope covers declarations of dependencies, services, admission policy and UI contributions for scheduled start/stop, resource sampling and alerts. Types, validation branches and cleanup paths define its data/behavior boundaries
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
