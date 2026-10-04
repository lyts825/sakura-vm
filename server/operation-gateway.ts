import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage } from 'node:http';
import { AppError } from '../shared/errors.ts';
import type { OperationRole } from '../shared/contracts/operations.ts';
import type { ResourceIdentity } from '../shared/contracts/host-runtime.ts';
import { operationDirectory, operationEntries, type OperationEntry } from './operation-catalog.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';
import { matchOperationPath } from './plugins/registry.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withPluginAuthority } from './plugin-authority.ts';

export type OperationBinding = {
  /** Captures credentials and target identity once; reads live authority on every invocation. */
  check(): Promise<OperationRole | undefined>;
  input?(input: unknown): Promise<void>;
  identity?: Partial<ResourceIdentity>;
};
type GatewayOptions = {
  enabled(): Iterable<string>;
  instance?(owner: string): PluginInstance | undefined;
  catalogVersion?(): number;
  owner?(url: URL, declaration: OperationEntry['declaration']): string;
  bind(req: IncomingMessage, url: URL, entry: OperationEntry,
    parameters: Readonly<Record<string, string>>, requireEnabled: () => void): Promise<OperationBinding>;
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
  get version() { return this.options.catalogVersion?.() || 0; }
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
    const owner = this.options.owner?.(url, declaration) || declaration.owner;
    const instance = this.options.instance?.(owner);
    const enabled = () => {
      if (owner !== 'core' && !new Set(this.options.enabled()).has(owner))
        throw new AppError('请在插件中心启用插件「' + declaration.owner + '」，并重启 Sakura 服务', 403);
      if (instance) {
        instance.check();
        if (this.options.instance?.(owner) !== instance)
          throw new AppError('操作所属插件代次已变化', 403, 'PLUGIN_REVOKED');
      }
    };
    // The authority checks availability after credentials, before reading target metadata.
    const binding = await this.options.bind(req, url, entry, Object.freeze(parameters), enabled);
    const check = async () => {
      const role = await binding.check();
      if (['controller', 'socket'].includes(declaration.access) && (!role || !declaration.roles.includes(role)))
        throw new AppError('当前账户没有此操作的访问权限', 403, 'OPERATION_FORBIDDEN');
      enabled();
    };
    await check();
    return {
      declaration, check, instance,
      run<T>(work: () => T): T {
        const invoke = () => withResourceContext({ owner: declaration.owner === 'core' ? 'core:application' : `plugin:${declaration.owner}`,
          ...(declaration.owner === 'core' ? {} : { pluginId: declaration.owner }), ...binding.identity },
        () => withOperationCheck(check, () => current.run({ entry, binding }, work)));
        return instance ? withPluginAuthority(instance, invoke, () => instance.check()) : invoke();
      },
    };
  }
  async run<T>(req: IncomingMessage, url: URL, work: () => T | Promise<T>) {
    const admission = await this.prepare(req, url);
    return admission.run(work);
  }
}
