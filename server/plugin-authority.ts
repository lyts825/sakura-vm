import { AsyncLocalStorage } from 'node:async_hooks';
import type { PluginInstance } from './plugin-instance.ts';
import { withOperationCheck } from './operation-context.ts';
import { withoutOperationContext } from './operation-context.ts';
import { withResourceContext, withNewResourceContext } from './host-runtime/context.ts';

const current = new AsyncLocalStorage<PluginInstance>();
const cleaning = new AsyncLocalStorage<PluginInstance>();
export function pluginAuthority() {
  return current.getStore();
}
export function pluginCleanup() {
  return cleaning.getStore();
}
/** Host-only cleanup dispatch. No plugin context exports this authority. */
export function withPluginCleanup<T>(instance: PluginInstance, work: () => T): T {
  return current.run(instance, () =>
    cleaning.run(instance, () =>
      withoutOperationContext(() => withResourceContext(instance.resourceIdentity, work)),
    ),
  );
}
export function withoutPluginAuthority<T>(work: () => T): T {
  return current.exit(work);
}
export function withPluginBackground<T>(instance: PluginInstance, work: () => T): T {
  return withoutOperationContext(() =>
    withNewResourceContext(instance.resourceIdentity, () =>
      withPluginAuthority(instance, work, () => instance.check()),
    ),
  );
}
/** Resume an already admitted native callback without granting cleanup or fresh business authority. */
export function withPluginContinuation<T>(instance: PluginInstance, work: () => T): T {
  return current.run(instance, () =>
    cleaning.exit(() =>
      withoutOperationContext(() =>
        withResourceContext(instance.resourceIdentity, () =>
          withOperationCheck(async () => {
            instance.check(undefined, true);
          }, work),
        ),
      ),
    ),
  );
}
/** Carries both ownership and live authority through domain calls and resource queues. */
export function withPluginAuthority<T>(
  instance: PluginInstance,
  work: () => T,
  check: () => void = () => instance.check(undefined, true),
): T {
  check();
  return current.run(instance, () =>
    withResourceContext(instance.resourceIdentity, () =>
      withOperationCheck(async () => {
        check();
      }, work),
    ),
  );
}
