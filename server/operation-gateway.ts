/**
 * 模块职责：注册并封存 HTTP 操作处理器，统一执行输入验证、预检、授权和业务分派。
 * Module purpose: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../shared/errors.ts';
import type { OperationRole } from '../shared/contracts/operations.ts';
import type { ResourceIdentity } from '../shared/contracts/host-runtime.ts';
import { operationDirectory, operationEntries, validateOperationEntries, type OperationEntry } from './operation-catalog.ts';
import { withResourceContext } from './host-runtime/context.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';
import { createOperationPathIndex } from './operation-paths.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withPluginAuthority } from './plugin-authority.ts';
import { guardOperationResponse, withOperationResponse } from './operation-response.ts';
import { resolveOperationBody } from '../shared/http-transport.ts';
import { requestHasBody, requestMediaType } from './http.ts';

export type OperationBinding = {
  /** 凭证和目标身份在绑定时捕获；每次调用都重新读取当前授权，不能沿用过期许可。 */
  /**
   * 签名 / Signature: OperationBinding.check.
   * 功能：为注册并封存 HTTP 操作处理器声明 check 的输入与结果契约，所属容器为 OperationBinding。
   * Purpose: Declares the input/result contract for check in OperationBinding. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<OperationRole | undefined>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  check(): Promise<OperationRole | undefined>;
  /**
   * 签名 / Signature: OperationBinding.input.
   * 功能：为注册并封存 HTTP 操作处理器声明 input 的输入与结果契约，所属容器为 OperationBinding。
   * Purpose: Declares the input/result contract for input in OperationBinding. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  input?(input: unknown): Promise<void>;
  identity?: Partial<ResourceIdentity>;
};
type GatewayOptions = {
  /**
   * 签名 / Signature: GatewayOptions.enabled.
   * 功能：为注册并封存 HTTP 操作处理器声明 enabled 的输入与结果契约，所属容器为 GatewayOptions。
   * Purpose: Declares the input/result contract for enabled in GatewayOptions. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Iterable<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  enabled(): Iterable<string>;
  /**
   * 签名 / Signature: GatewayOptions.instance.
   * 功能：为注册并封存 HTTP 操作处理器声明 instance 的输入与结果契约，所属容器为 GatewayOptions。
   * Purpose: Declares the input/result contract for instance in GatewayOptions. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 输入 / Inputs: owner: string
   * 输出 / Returns: PluginInstance | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  instance?(owner: string): PluginInstance | undefined;
  /**
   * 签名 / Signature: GatewayOptions.catalogVersion.
   * 功能：为注册并封存 HTTP 操作处理器声明 catalogVersion 的输入与结果契约，所属容器为 GatewayOptions。
   * Purpose: Declares the input/result contract for catalogVersion in GatewayOptions. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: number.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  catalogVersion?(): number;
  /**
   * 签名 / Signature: GatewayOptions.owner.
   * 功能：为注册并封存 HTTP 操作处理器声明 owner 的输入与结果契约，所属容器为 GatewayOptions。
   * Purpose: Declares the input/result contract for owner in GatewayOptions. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 输入 / Inputs: url: URL; declaration: OperationEntry['declaration']
   * 输出 / Returns: string.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  owner?(url: URL, declaration: OperationEntry['declaration']): string;
  /**
   * 签名 / Signature: GatewayOptions.bind.
   * 功能：为注册并封存 HTTP 操作处理器声明 bind 的输入与结果契约，所属容器为 GatewayOptions。
   * Purpose: Declares the input/result contract for bind in GatewayOptions. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 输入 / Inputs: req: IncomingMessage; url: URL; entry: OperationEntry; parameters: Readonly<Record<string, string>>; requireEnabled: () => void
   * 输出 / Returns: Promise<OperationBinding>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  bind(req: IncomingMessage, url: URL, entry: OperationEntry,
    parameters: Readonly<Record<string, string>>, requireEnabled:
    /**
     * 中文功能：绑定操作权威时使用的功能启用检查。
     * English: Feature-enabled check used when binding operation authority.
     * 所属 / Owner: GatewayOptions.bind.requireEnabled.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void): Promise<OperationBinding>;
};
const current = new AsyncLocalStorage<{ entry: OperationEntry; binding: OperationBinding }>();
const preflightFailures = new WeakMap<object, string>();
/** 标记已解析但尚未进入登记处理器就被拒绝的操作，供审计区分预检与业务失败。 */
/**
 * 入口 / Entry: operationPreflightFailure.
 * 功能：从当前输入或状态计算 `error !== null && typeof error === 'object' ? preflightFailures.get(error) : undefined`，供调用方后续验证或使用。
 * Purpose: Computes `error !== null && typeof error === 'object' ? preflightFailures.get(error) : undefined` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `error !== null && typeof error === 'object' ? preflightFailures.get(error) : undefined`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const operationPreflightFailure = (error: unknown) => error !== null && typeof error === 'object'
  ? preflightFailures.get(error) : undefined;
/**
 * 入口 / Entry: currentOperation.
 * 功能：从当前输入或状态计算 `current.getStore()?.entry.declaration`，供调用方后续验证或使用。
 * Purpose: Computes `current.getStore()?.entry.declaration` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `current.getStore()?.entry.declaration`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const currentOperation = () => current.getStore()?.entry.declaration;
/**
 * 签名 / Signature: HttpOperationHandler.HttpOperationHandler.
 * 功能：为注册并封存 HTTP 操作处理器声明 HttpOperationHandler 的输入与结果契约，所属容器为 HttpOperationHandler。
 * Purpose: Declares the input/result contract for HttpOperationHandler in HttpOperationHandler. Module responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
 * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; url: URL; entry: OperationEntry
 * 输出 / Returns: unknown | Promise<unknown>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type HttpOperationHandler = (req: IncomingMessage, res: ServerResponse, url: URL,
  entry: OperationEntry) => unknown | Promise<unknown>;

/** 验证已按字节限制读入的 JSON；流和二进制正文不会因此被重复消费。 */
/**
 * 入口 / Entry: validateOperationInput.
 * 功能：在注册并封存 HTTP 操作处理器中，核对调用资格、输入或资源归属；本入口产生 `input` 供上层消费（`operation-gateway.ts`）。
 * Purpose: Checks admission, input or resource ownership in `operation-gateway.ts`; this entry produces `input` for its caller. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
 * 处理：通过 `current.getStore`, `context.entry.requestSchema.parse`, `context.binding.input`, `captureOperationCheck()` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `current.getStore`, `context.entry.requestSchema.parse`, `context.binding.input`, `captureOperationCheck()`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: input: any
 * 输出 / Returns: `input`.
 * 副作用 / Effects: `context.entry.requestSchema.parse`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function validateOperationInput(input: any) {
  const context = current.getStore();
  context?.entry.requestSchema?.parse(input);
  await context?.binding.input?.(input);
  await captureOperationCheck()();
  return input;
}

/** HTTP 与 WebSocket 共用的操作准入边界，缺少声明、处理器或授权时拒绝执行。 */
export class OperationGateway {
  private readonly matchPaths: ReturnType<typeof createOperationPathIndex<OperationEntry>>;
  private handlers = new Map<string, HttpOperationHandler>();
  private sealed = false;
  /**
   * 入口 / Entry: OperationGateway.constructor.
   * 功能：建立 OperationGateway 的注册并封存 HTTP 操作处理器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the OperationGateway context for this module's responsibility: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: options: GatewayOptions; entries: default=operationEntries
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private options: GatewayOptions, private entries = operationEntries) {
    validateOperationEntries(entries);
    this.matchPaths = createOperationPathIndex(entries, entry => entry.declaration.path,
      pattern => pattern.match(/\{/g)?.length || 0);
  }
  /** 发布前把确切的操作声明与处理器绑定，目录封存后禁止增加或替换处理器。 */
  /**
   * 入口 / Entry: OperationGateway.register.
   * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`OperationGateway`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; the calls and state transitions below complete the operation. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 处理：通过 `this.entries.includes`, `this.handlers.has`, `this.handlers.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.entries.includes`, `this.handlers.has`, `this.handlers.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: entry: OperationEntry; handler: HttpOperationHandler
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.handlers.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.sealed`; `!this.entries.includes(entry) || entry.declaration.method === 'UPGRADE'`; `this.handlers.has(entry.declaration.id)`; 异常 / errors `new Error('操作处理器目录已经发布')`; `new Error('HTTP 处理器未绑定有效的操作声明')`.
   */
  register(entry: OperationEntry, handler: HttpOperationHandler) {
    if (this.sealed) throw new Error('操作处理器目录已经发布');
    if (!this.entries.includes(entry) || entry.declaration.method === 'UPGRADE')
      throw new Error('HTTP 处理器未绑定有效的操作声明');
    if (this.handlers.has(entry.declaration.id)) throw new Error('重复操作处理器：' + entry.declaration.id);
    this.handlers.set(entry.declaration.id, handler);
  }
  /** 检查每个 HTTP 操作都已有处理器，再开放分派，避免部分装配状态接受请求。 */
  /**
   * 入口 / Entry: OperationGateway.seal.
   * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.sealed`（`OperationGateway`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; the outcome is recorded in `this.sealed`. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 处理：通过 `this.entries.filter`, `missing.map().join`, `missing.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.entries.filter`, `missing.map().join`, `missing.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.sealed`.
   * 拒绝 / Refusals: 条件 / conditions `missing.length`; 异常 / errors `new Error('操作缺少处理器，禁止发布：' + missing.map(entry => entry.declaration.id).join(', '))`.
   */
  seal() {
    const missing = this.entries.filter(entry => entry.declaration.method !== 'UPGRADE' &&
      !this.handlers.has(entry.declaration.id));
    if (missing.length) throw new Error('操作缺少处理器，禁止发布：' + missing.map(entry => entry.declaration.id).join(', '));
    this.sealed = true;
  }
  /**
   * 入口 / Entry: OperationGateway.dispatch.
   * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await admission.run(() => { handlerEntered = true; return handler(req, res, url, entry); })` 供上层消费（`OperationGateway`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; this entry produces `await admission.run(() => { handlerEntered = true; return handler(req, res, url, entry); })` for its caller. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 处理：通过 `this.resolve`, `this.handlers.get`, `this.prepare`, `input.headers.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.resolve`, `this.handlers.get`, `this.prepare`, `input.headers.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `error !== null && typeof error === 'object'`; `handlerEntered`.
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; url: URL
   * 输出 / Returns: `await admission.run(() => { handlerEntered = true; return handler(req, res, url, entry); })`.
   * 副作用 / Effects: `requestHasBody`; `requestMediaType`; `preflightFailures.delete`; `preflightFailures.set`.
   * 拒绝 / Refusals: 条件 / conditions `!this.sealed`; `!handler`; `body.kind === 'none' && hasBody`; 异常 / errors `new AppError('操作处理器目录尚未就绪', 503, 'OPERATIONS_NOT_READY')`; `new AppError('操作没有已登记处理器', 503, 'OPERATION_HANDLER_MISSING')`.
   * 失败处理：catch 分支执行 `if (error !== null && typeof error === 'object') { if (handlerEntered) preflightFailures.delete(error); else preflightFailure…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (error !== null && typeof error === 'object') { if (handlerEntered) preflightFailures.delete(error); else preflightFailure…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
  /**
   * 入口 / Entry: OperationGateway.directory.
   * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operationDirectory(this.options.enabled())` 供上层消费（`OperationGateway`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; this entry produces `operationDirectory(this.options.enabled())` for its caller. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 处理：通过 `operationDirectory`, `this.options.enabled` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `operationDirectory`, `this.options.enabled`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `operationDirectory(this.options.enabled())`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  directory() { return operationDirectory(this.options.enabled()); }
  /**
   * 入口 / Entry: OperationGateway.version.
   * 功能：从当前输入或状态计算 `this.options.catalogVersion?.() || 0`，供调用方后续验证或使用。
   * Purpose: Computes `this.options.catalogVersion?.() || 0` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.options.catalogVersion?.() || 0`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get version() { return this.options.catalogVersion?.() || 0; }
  /**
   * 入口 / Entry: OperationGateway.resolve.
   * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `match` 供上层消费（`OperationGateway`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; this entry produces `match` for its caller. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 处理：通过 `this.matchPaths`, `matches.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.matchPaths`, `matches.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: method: string; path: string
   * 输出 / Returns: `match`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!matches.length`; `!match`; 异常 / errors `new AppError('接口未声明', 404, 'OPERATION_NOT_FOUND')`; `new AppError('不支持此方法', 405, 'METHOD_NOT_ALLOWED')`.
   */
  resolve(method: string, path: string) {
    // 固定路径优先于变量路径；固定路径的方法不匹配时也不能退回更宽泛的变量接口。
    const matches = this.matchPaths(path);
    if (!matches.length) throw new AppError('接口未声明', 404, 'OPERATION_NOT_FOUND');
    const specific = matches[0].entry.declaration.path;
    const match = matches.find(item => item.entry.declaration.path === specific && item.entry.declaration.method === method);
    if (!match) throw new AppError('不支持此方法', 405, 'METHOD_NOT_ALLOWED');
    return match;
  }
  /**
   * 入口 / Entry: OperationGateway.prepare.
   * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ declaration, check, instance, run<T>(work: () => T): T { const invoke = () => withResourceContext({ owner: owner === 'core'…` 供上层消费（`OperationGateway`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; this entry produces `{ declaration, check, instance, run<T>(work: () => T): T { const invoke = () => withResourceContext({ owner: owner === 'core'…` for its caller. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 处理：通过 `this.resolve`, `this.options.owner`, `this.options.instance`, `this.options.bind` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.resolve`, `this.options.owner`, `this.options.instance`, `this.options.bind`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req: IncomingMessage; url: URL; method: default=req.method || 'GET'
   * 输出 / Returns: `{ declaration, check, instance, run<T>(work: () => T): T { const invoke = () => withResourceContext({ owner: owner === 'core'…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `[...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)`; 异常 / errors `new AppError('请求不能包含重复查询参数', 400, 'INVALID_INPUT')`.
   */
  async prepare(req: IncomingMessage, url: URL, method = req.method || 'GET') {
    const { entry, parameters } = this.resolve(method, url.pathname);
    const { declaration } = entry;
    const owner = this.options.owner?.(url, declaration) || declaration.owner;
    const instance = this.options.instance?.(owner);
    /**
     * 入口 / Entry: OperationGateway.prepare.enabled.
     * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`OperationGateway`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; the calls and state transitions below complete the operation. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
     * 处理：通过 `Set.has`, `this.options.enabled`, `instance.check`, `this.options.instance` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `Set.has`, `this.options.enabled`, `instance.check`, `this.options.instance`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `Set.has`.
     * 拒绝 / Refusals: 条件 / conditions `owner !== 'core' && !new Set(this.options.enabled()).has(owner)`; `instance`; `this.options.instance?.(owner) !== instance`; 异常 / errors `new AppError('请在插件中心启用插件「' + declaration.owner + '」，并重启 Sakura 服务', 403)`; `new AppError('操作所属插件代次已变化', 403, 'PLUGIN_REVOKED')`.
     */
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
    /**
     * 入口 / Entry: OperationGateway.prepare.check.
     * 功能：在注册并封存 HTTP 操作处理器中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`OperationGateway`）。
     * Purpose: Checks admission, input or resource ownership in `OperationGateway`; the calls and state transitions below complete the operation. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
     * 处理：通过 `binding.check`, `inline.includes`, `declaration.roles.includes`, `enabled` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `binding.check`, `inline.includes`, `declaration.roles.includes`, `enabled`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `['controller', 'socket'].includes(declaration.access) && (!role || !declaration.roles.includes(role))`; 异常 / errors `new AppError('当前账户没有此操作的访问权限', 403, 'OPERATION_FORBIDDEN')`.
     */
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
      /**
       * 入口 / Entry: OperationGateway.prepare.run.
       * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `instance ? withPluginAuthority(instance, invoke, () => instance.check()) : invoke()` 供上层消费（`OperationGateway`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; this entry produces `instance ? withPluginAuthority(instance, invoke, () => instance.check()) : invoke()` for its caller. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
       * 处理：通过 `withPluginAuthority`, `invoke` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `withPluginAuthority`, `invoke`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: work: () => T
       * 输出 / Returns: T；结果来自 / values from `instance ? withPluginAuthority(instance, invoke, () => instance.check()) : invoke()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run<T>(work: () => T): T {
        /**
         * 入口 / Entry: OperationGateway.prepare.run.invoke.
         * 功能：把本层请求转交 `withResourceContext`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `withResourceContext` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `withResourceContext({ owner: owner === 'core' ? 'core:application' : `plugin:${owner}`, operationId: declaration.id, ...(inst…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
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
  /**
   * 入口 / Entry: OperationGateway.run.
   * 功能：在注册并封存 HTTP 操作处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `admission.run(work)` 供上层消费（`OperationGateway`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `OperationGateway`; this entry produces `admission.run(work)` for its caller. Module context: Registers/seals HTTP handlers and applies input validation, preflight, authorization and business dispatch.
   * 处理：通过 `this.prepare`, `admission.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.prepare`, `admission.run`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req: IncomingMessage; url: URL; work: () => T | Promise<T>
   * 输出 / Returns: `admission.run(work)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run<T>(req: IncomingMessage, url: URL, work: () => T | Promise<T>) {
    const admission = await this.prepare(req, url);
    return admission.run(work);
  }
}
