/**
 * 模块职责：“自动化调度”插件服务端入口。激活时装配 FeatureScheduler，并处理声明的服务端操作。
 */
import { services as automationServices } from '../automation/services.ts';
import { services as automationSchedulerServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';
import { FeatureScheduler } from '../../server/feature-scheduler.ts';

export async function activate(host: PluginContext) {
  // 计划任务由独立插件持有；启用能力中心本身不会自动启动此调度器。
  host.provide(automationSchedulerServices.scheduler, new FeatureScheduler(host.use(automationServices.suite)));
}
export async function route() {
  return false;
}
