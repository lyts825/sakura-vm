import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import { AppError } from '../shared/errors.ts';
import type { OperationRole } from '../shared/contracts/operations.ts';
import type { ResourceIdentity } from '../shared/contracts/host-runtime.ts';
import { operationDirectory, operationEntries, type OperationEntry } from './operation-catalog.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';
import { matchOperationPath } from './plugins/registry.ts';

export type OperationBinding = {
  /** Captures credentials and target identity once; reads live authority on every invocation. */
  check(): Promise<OperationRole | undefined>;
  input?(input: unknown): Promise<void>;
  identity?: Partial<ResourceIdentity>;
};
type GatewayOptions = {
  enabled(): Iterable<string>;
  bind(req: IncomingMessage, url: URL, entry: OperationEntry,
    parameters: Readonly<Record<string, string>>): Promise<OperationBinding>;
};
const current = new AsyncLocalStorage<{ entry: OperationEntry; binding: OperationBinding }>();

/** Validate the already bounded JSON read without consuming streams or binary bodies twice. */
export async function validateOperationInput(input: any) {
  const context = current.getStore();
  if (context?.entry.declaration.transport === 'json') context.entry.requestSchema?.parse(input);
  await context?.binding.input?.(input);
  await captureOperationCheck()();
  return input;
}

/** Shared, deny-by-default dispatch and execution authority for HTTP and WebSocket entry points. */
export class OperationGateway {
  constructor(private options: GatewayOptions, private entries = operationEntries) {}
  directory() { return operationDirectory(this.options.enabled()); }
  resolve(method: string, path: string) {
    // A literal endpoint takes precedence over a variable endpoint, including when its method fails.
    const matches = this.entries.flatMap(entry => {
      const parameters = matchOperationPath(entry.declaration.path, path);
      return parameters ? [{ entry, parameters }] : [];
    }).sort((a, b) => (a.entry.declaration.path.match(/\{/g)?.length || 0) -
      (b.entry.declaration.path.match(/\{/g)?.length || 0));
    if (!matches.length) throw new AppError('接口未声明', 404, 'OPERATION_NOT_FOUND');
    const specific = matches[0].entry.declaration.path;
    const match = matches.find(item => item.entry.declaration.path === specific && item.entry.declaration.method === method);
    if (!match) throw new AppError('不支持此方法', 405, 'METHOD_NOT_ALLOWED');
    return match;
  }
  async prepare(req: IncomingMessage, url: URL, method = req.method || 'GET') {
    const { entry, parameters } = this.resolve(method, url.pathname);
    const { declaration } = entry;
    const enabled = () => {
      if (declaration.owner !== 'core' && !new Set(this.options.enabled()).has(declaration.owner))
        throw new AppError('此操作所属插件未启用', 409, 'PLUGIN_DISABLED');
    };
    enabled();
    const binding = await this.options.bind(req, url, entry, Object.freeze(parameters));
    const check = async () => {
      enabled();
      const role = await binding.check();
      if (['controller', 'socket'].includes(declaration.access) && (!role || !declaration.roles.includes(role)))
        throw new AppError('当前账户没有此操作的访问权限', 403, 'OPERATION_FORBIDDEN');
      enabled();
    };
    await check();
    return {
      declaration, check,
      run<T>(work: () => T): T {
        return withResourceContext({ owner: declaration.owner === 'core' ? 'core:application' : `plugin:${declaration.owner}`,
          ...(declaration.owner === 'core' ? {} : { pluginId: declaration.owner }), ...binding.identity },
        () => withOperationCheck(check, () => current.run({ entry, binding }, work)));
      },
    };
  }
  async run<T>(req: IncomingMessage, url: URL, work: () => T | Promise<T>) {
    const admission = await this.prepare(req, url);
    return admission.run(work);
  }
}
