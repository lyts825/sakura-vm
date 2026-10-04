import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../shared/errors.ts';
import type { OperationRole } from '../shared/contracts/operations.ts';
import type { ResourceIdentity } from '../shared/contracts/host-runtime.ts';
import { operationDirectory, operationEntries, validateOperationEntries, type OperationEntry } from './operation-catalog.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';
import { matchOperationPath } from './plugins/registry.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withPluginAuthority } from './plugin-authority.ts';
import { guardOperationResponse, withOperationResponse } from './operation-response.ts';

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
export const currentOperation = () => current.getStore()?.entry.declaration;
export type HttpOperationHandler = (req: IncomingMessage, res: ServerResponse, url: URL,
  entry: OperationEntry) => unknown | Promise<unknown>;

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
  private handlers = new Map<string, HttpOperationHandler>();
  private sealed = false;
  constructor(private options: GatewayOptions, private entries = operationEntries) {
    validateOperationEntries(entries);
  }
  /** Registration binds this exact declaration and handler before publication. */
  register(entry: OperationEntry, handler: HttpOperationHandler) {
    if (this.sealed) throw new Error('操作处理器目录已经发布');
    if (!this.entries.includes(entry) || entry.declaration.method === 'UPGRADE')
      throw new Error('HTTP 处理器未绑定有效的操作声明');
    if (this.handlers.has(entry.declaration.id)) throw new Error('重复操作处理器：' + entry.declaration.id);
    this.handlers.set(entry.declaration.id, handler);
  }
  seal() {
    const missing = this.entries.filter(entry => entry.declaration.method !== 'UPGRADE' &&
      !this.handlers.has(entry.declaration.id));
    if (missing.length) throw new Error('操作缺少处理器，禁止发布：' + missing.map(entry => entry.declaration.id).join(', '));
    this.sealed = true;
  }
  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!this.sealed) throw new AppError('操作处理器目录尚未就绪', 503, 'OPERATIONS_NOT_READY');
    const { entry } = this.resolve(req.method || 'GET', url.pathname);
    const handler = this.handlers.get(entry.declaration.id);
    if (!handler) throw new AppError('操作没有已登记处理器', 503, 'OPERATION_HANDLER_MISSING');
    const admission = await this.prepare(req, url);
    guardOperationResponse(res, { id: entry.declaration.id, contract: entry.responseContract });
    return admission.run(() => handler(req, res, url, entry));
  }
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
        const invoke = () => withResourceContext({ owner: owner === 'core' ? 'core:application' : `plugin:${owner}`,
          operationId: declaration.id,
          ...(instance ? { pluginInstanceId: instance.identity, pluginGeneration: instance.generation } : {}),
          ...(owner === 'core' ? {} : { pluginId: owner }), ...binding.identity },
        () => withOperationCheck(check, () => current.run({ entry, binding }, () =>
          withOperationResponse({ id: declaration.id, contract: entry.responseContract }, work))));
        return instance ? withPluginAuthority(instance, invoke, () => instance.check()) : invoke();
      },
    };
  }
  async run<T>(req: IncomingMessage, url: URL, work: () => T | Promise<T>) {
    const admission = await this.prepare(req, url);
    return admission.run(work);
  }
}
