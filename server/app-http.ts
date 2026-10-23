/** 宿主所有者应用档案准入；清理仅继承原插件的资源权限。 */
import type { PluginContext } from './plugin-api.ts';
import { captureOperationCheck } from './operation-context.ts';
import { pluginCleanup } from './plugin-authority.ts';
export function appAuthorize(host: PluginContext) {
  return async () => {
    if (pluginCleanup()?.identity === host.instance.identity) return;
    host.signal.throwIfAborted();
    await captureOperationCheck()();
  };
}
