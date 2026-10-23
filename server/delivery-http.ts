/** 宿主所有者管理的交付档案不依赖源 VM 存活；执行服务另行检查项目身份。
 * Owner-managed delivery archives survive the source VM; execution services separately verify project identity. */
import type { PluginContext } from './plugin-api.ts';
import { captureOperationCheck } from './operation-context.ts';
import { deliveryScopeSchema, type DeliveryScope } from '../shared/contracts/delivery-common.ts';
/** 解析明确的档案身份，不从当前选中 VM 推断。 Parse explicit archive identity from the query. */
export function deliveryHttpScope(url: URL): DeliveryScope {
  return deliveryScopeSchema.parse({
    vmId: url.searchParams.get('vmId'),
    projectId: url.searchParams.get('projectId'),
  });
}
/** 生成当前操作与插件代次的准入检查，撤销后拒绝新增工作。
 * Create an operation and plugin-generation check that rejects new work after revocation. */
export function deliveryAuthorize(host: PluginContext) {
  return async (scope: DeliveryScope) => {
    deliveryScopeSchema.parse(scope);
    host.signal.throwIfAborted();
    await captureOperationCheck()();
  };
}
