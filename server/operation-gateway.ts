/**
 * 模块职责：注册并封存 HTTP 操作处理器，统一执行输入验证、预检、授权和业务分派。
 */
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
import { resolveOperationBody } from '../shared/http-transport.ts';
import { requestHasBody, requestMediaType } from './http.ts';

export type OperationBinding = {
  /** 凭证和目标身份在绑定时捕获；每次调用都重新读取当前授权，不能沿用过期许可。 */
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
const preflightFailures = new WeakMap<object, string>();
/** 标记已解析但尚未进入登记处理器就被拒绝的操作，供审计区分预检与业务失败。 */
export const operationPreflightFailure = (error: unknown) => error !== null && typeof error === 'object'
  ? preflightFailures.get(error) : undefined;
export const currentOperation = () => current.getStore()?.entry.declaration;
export type HttpOperationHandler = (req: IncomingMessage, res: ServerResponse, url: URL,
  entry: OperationEntry) => unknown | Promise<unknown>;

/** 验证已按字节限制读入的 JSON；流和二进制正文不会因此被重复消费。 */
export async function validateOperationInput(input: any) {
  const context = current.getStore();
  context?.entry.requestSchema?.parse(input);
  await context?.binding.input?.(input);
  await captureOperationCheck()();
  return input;
}

/** HTTP 与 WebSocket 共用的操作准入边界，缺少声明、处理器或授权时拒绝执行。 */
export class OperationGateway {
  private handlers = new Map<string, HttpOperationHandler>();
  private sealed = false;
  constructor(private options: GatewayOptions, private entries = operationEntries) {
    validateOperationEntries(entries);
  }
  /** 发布前把确切的操作声明与处理器绑定，目录封存后禁止增加或替换处理器。 */
  register(entry: OperationEntry, handler: HttpOperationHandler) {
    if (this.sealed) throw new Error('操作处理器目录已经发布');
    if (!this.entries.includes(entry) || entry.declaration.method === 'UPGRADE')
      throw new Error('HTTP 处理器未绑定有效的操作声明');
    if (this.handlers.has(entry.declaration.id)) throw new Error('重复操作处理器：' + entry.declaration.id);
    this.handlers.set(entry.declaration.id, handler);
  }
  /** 检查每个 HTTP 操作都已有处理器，再开放分派，避免部分装配状态接受请求。 */
  seal() {
    const missing = this.entries.filter(entry => entry.declaration.method !== 'UPGRADE' &&
      !this.handlers.has(entry.declaration.id));
    if (missing.length) throw new Error('操作缺少处理器，禁止发布：' + missing.map(entry => entry.declaration.id).join(', '));
    this.sealed = true;
  }
  async dispatch(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!this.sealed) throw new AppError('操作处理器目录尚未就绪', 503, 'OPERATIONS_NOT_READY');
    const { entry } = this.resolve(req.method || 'GET', url.pathname);
    let handlerEntered = false;
    try {
    const handler = this.handlers.get(entry.declaration.id);
    if (!handler) throw new AppError('操作没有已登记处理器', 503, 'OPERATION_HANDLER_MISSING');
    const admission = await this.prepare(req, url);
    const input = entry.requestContract!;
    input.headers.parse(Object.fromEntries(Object.keys(input.headers.shape).filter(name => req.headers[name] !== undefined)
      .map(name => [name, req.headers[name]])));
    const hasBody = requestHasBody(req);
    const body = resolveOperationBody(input, Object.fromEntries(url.searchParams));
    if (body.kind === 'none' && hasBody)
      throw new AppError('此操作不接受请求体', 400, 'UNEXPECTED_REQUEST_BODY');
    if (body.kind !== 'none' && (body.required || hasBody)) {
      if (requestMediaType(req) !== input.media) throw new AppError('请求媒体类型不符合契约', 415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    guardOperationResponse(res, { id: entry.declaration.id, contract: entry.responseContract });
    return await admission.run(() => { handlerEntered = true; return handler(req, res, url, entry); });
    } catch (error) {
      if (error !== null && typeof error === 'object') {
        if (handlerEntered) preflightFailures.delete(error);
        else preflightFailures.set(error, entry.declaration.id);
      }
      throw error;
    }
  }
  directory() { return operationDirectory(this.options.enabled()); }
  get version() { return this.options.catalogVersion?.() || 0; }
  resolve(method: string, path: string) {
    // 固定路径优先于变量路径；固定路径的方法不匹配时也不能退回更宽泛的变量接口。
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
    // 先核对凭证和可用性，再读取目标元数据，避免未授权请求探测领域状态。
    const binding = await this.options.bind(req, url, entry, Object.freeze(parameters), enabled);
    const check = async () => {
      const role = await binding.check();
      if (['controller', 'socket'].includes(declaration.access) && (!role || !declaration.roles.includes(role)))
        throw new AppError('当前账户没有此操作的访问权限', 403, 'OPERATION_FORBIDDEN');
      enabled();
    };
    await check();
    const input = entry.requestContract!;
    const query = Object.fromEntries(url.searchParams);
    if ([...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1))
      throw new AppError('请求不能包含重复查询参数', 400, 'INVALID_INPUT');
    input.query.parse(query);
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
