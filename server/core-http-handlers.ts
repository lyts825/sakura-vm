/**
 * 模块职责：汇集核心领域 HTTP 处理器，供统一操作网关按已声明的操作路径分派。
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
