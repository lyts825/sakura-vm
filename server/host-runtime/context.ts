/**
 * 模块职责：用异步上下文传递资源所有者与运行身份，让嵌套资源沿用当前操作归属。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ResourceIdentity } from '../../shared/contracts/host-runtime.ts';

const contexts = new AsyncLocalStorage<Readonly<ResourceIdentity>>();

export function resourceContext(): Readonly<ResourceIdentity> | undefined {
  return contexts.getStore();
}

/** 在排队或跨 IPC 边界之前捕获身份，后续上下文变化不会把原资源归属转给新的请求。 */
export function captureResourceContext(identity: Partial<ResourceIdentity> = {}): Readonly<ResourceIdentity> {
  const inherited = contexts.getStore();
  const result: ResourceIdentity = {
    ...inherited,
    owner: identity.owner ?? inherited?.owner ?? 'core:application',
    operationId: identity.operationId ?? inherited?.operationId ?? randomUUID(),
  };
  // 仅按白名单复制身份字段，避免请求正文因对象展开意外进入诊断或后续 IPC 数据。
  const keys: (keyof ResourceIdentity)[] = ['operationId', 'owner', 'actorId', 'pluginId', 'pluginInstanceId', 'pluginGeneration', 'callerPluginInstanceId', 'callerPluginGeneration', 'vmId',
    'projectId', 'jobId', 'vmProcessId', 'executionGeneration', 'bootId', 'networkGeneration', 'traceId', 'spanId', 'recoveryId'];
  for (const key of keys) {
    const value = identity[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/.test(value))
      throw new Error(`Invalid resource identity: ${key}`);
    result[key] = value;
  }
  return Object.freeze(result);
}

export function withResourceContext<T>(identity: Partial<ResourceIdentity>, work: () => T): T {
  return contexts.run(captureResourceContext(identity), work);
}

/** 独立后台工作新建归属，不继承注册请求的账户或实例身份。 */
export function withNewResourceContext<T>(identity: Partial<ResourceIdentity>, work: () => T): T {
  return contexts.run(contexts.exit(() => captureResourceContext(identity)), work);
}
