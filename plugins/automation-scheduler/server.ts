import { services as automationServices } from '../automation/services.ts';
import { services as automationSchedulerServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';
import { FeatureScheduler } from '../../server/feature-scheduler.ts';

export async function activate(host: PluginContext) {
  host.provide(automationSchedulerServices.scheduler, new FeatureScheduler(host.use(automationServices.suite)));
}
export async function route() {
  return false;
}
