/**
 * 模块职责：汇集核心领域 HTTP 处理器，供统一操作网关按已声明的操作路径分派。
 * Module purpose: Collects core domain HTTP handlers for dispatch by declared operation paths through the shared gateway.
 */
import type { ApplicationServices } from './application-services.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import { combineHttpHandlers, type CoreHttpContext } from './http-core-context.ts';
import { publicAccessHandlers } from './http-public-access.ts';
import { accountAccessHandlers } from './http-account-access.ts';
import { projectAccessHandlers } from './http-project-access.ts';
import { companionHandlers } from './http-companions.ts';
import { systemOperationHandlers } from './http-system-operations.ts';
import { hostServiceHandlers } from './http-host-services.ts';
import { pluginManagementHandlers } from './http-plugin-management.ts';

/** Domains own concrete operation registrations. The gateway seals the complete catalog before listening. */
/**
 * 入口 / Entry: coreHttpHandlers.
 * 功能：在汇集核心领域 HTTP 处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `combineHttpHandlers( publicAccessHandlers(context), accountAccessHandlers(context), projectAccessHandlers(context), companion…` 供上层消费（`core-http-handlers.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `core-http-handlers.ts`; this entry produces `combineHttpHandlers( publicAccessHandlers(context), accountAccessHandlers(context), projectAccessHandlers(context), companion…` for its caller. Module context: Collects core domain HTTP handlers for dispatch by declared operation paths through the shared gateway.
 * 处理：通过 `combineHttpHandlers`, `publicAccessHandlers`, `accountAccessHandlers`, `projectAccessHandlers` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `combineHttpHandlers`, `publicAccessHandlers`, `accountAccessHandlers`, `projectAccessHandlers`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: context: CoreHttpContext<keyof ApplicationServices>; adapters: { machine: HttpOperationHandler; plugin: HttpOperationHandler; guest: HttpOperationHa…
 * 输出 / Returns: `combineHttpHandlers( publicAccessHandlers(context), accountAccessHandlers(context), projectAccessHandlers(context), companion…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function coreHttpHandlers(
  context: CoreHttpContext<keyof ApplicationServices>,
  adapters: {
    machine: HttpOperationHandler;
    plugin: HttpOperationHandler;
    guest: HttpOperationHandler;
    extension: HttpOperationHandler;
  },
) {
  return combineHttpHandlers(
    publicAccessHandlers(context),
    accountAccessHandlers(context),
    projectAccessHandlers(context),
    companionHandlers(context),
    systemOperationHandlers(context),
    hostServiceHandlers(context),
    pluginManagementHandlers(context),
    {
      'core.system': adapters.machine,
      'core.storage-pools.get': adapters.machine,
      'core.storage-pools.action': adapters.machine,
      'core.usb-hotplug.get': adapters.machine,
      'core.usb-hotplug.change': adapters.machine,
      'core.vms.list': adapters.machine,
      'core.vms.create': adapters.machine,
      'core.vms.get': adapters.machine,
      'core.vms.update': adapters.machine,
      'core.vms.delete': adapters.machine,
      'core.vms.start': adapters.machine,
      'core.vms.stop': adapters.machine,
      'core.vms.exec': adapters.machine,
      'core.vms.logs': adapters.machine,
      'core.jobs.list': adapters.plugin,
      'core.jobs.result': adapters.plugin,
      'core.jobs.cancel': adapters.plugin,
      'core.jobs.retry': adapters.plugin,
      'core.events': adapters.plugin,
      'core.extension.connect': adapters.extension,
      'core.extension.inventory': adapters.extension,
      'core.extension.connectOptions': adapters.extension,
      'core.extension.inventoryOptions': adapters.extension,
      'core.guest.interop': adapters.guest,
      'core.download': adapters.plugin,
    },
  );
}
