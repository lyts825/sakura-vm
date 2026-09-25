export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';

export async function activate(_host: PluginContext) {}
export async function route(): Promise<boolean> {
  return false;
}
