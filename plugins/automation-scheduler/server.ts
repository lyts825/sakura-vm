export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';
import { FeatureScheduler } from '../../server/feature-scheduler.ts';
import type { FeatureSuite } from '../../server/feature-suite.ts';

export async function activate(host: PluginContext) {
  host.provide('scheduler', new FeatureScheduler(host.use<FeatureSuite>('automation', 'suite')));
}
export async function route() {
  return false;
}
