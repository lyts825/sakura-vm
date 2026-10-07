/**
 * 模块职责：“资源采样”插件服务端入口。激活时装配 Metrics，并处理声明的服务端操作。
 */
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { services as metricsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Metrics } from '../../server/metrics.ts';
import type { PluginOperation } from '../../server/plugin-api.ts';
export async function activate(host: PluginContext) {
  host.provide(metricsServices.metrics, new Metrics(host.capabilities.vm));
}
export const operations: Record<string, PluginOperation> = {
  sample: {
    response: pluginRouteResponses["metrics.sample"].schema,
    execute(url) {
      return this.use(metricsServices.metrics).sample(url.pathname.split('/')[3]);
    },
  },
};
export async function route(): Promise<boolean> {
  return false;
}

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("metrics");
