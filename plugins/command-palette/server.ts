/**
 * 模块职责：“快捷命令面板”插件服务端入口。提供插件入口和声明对应的请求处理。
 */

export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';

export async function activate(_host: PluginContext) {}
export async function route(): Promise<boolean> {
  return false;
}
