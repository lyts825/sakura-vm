export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { Metrics } from '../../server/metrics.ts';
import type { PluginOperation } from '../../server/plugin-api.ts';
export async function activate(host: PluginContext) {
  host.provide('metrics', new Metrics(host.machines));
}
export const operations: Record<string, PluginOperation> = {
  sample: {
    response: z.object({
      cpuPercent: z.number(), memoryUsed: z.number(), memoryTotal: z.number(),
      diskUsed: z.number(), diskTotal: z.number(), uptime: z.number(), sampledAt: z.string(),
      processes: z.array(z.object({ name: z.string(), memory: z.number() })),
    }).strict(),
    execute(url) {
      return this.use<Metrics>('metrics', 'metrics').sample(url.pathname.split('/')[3]);
    },
  },
};
export async function route(): Promise<boolean> {
  return false;
}
