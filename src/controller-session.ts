/**
 * 模块职责（中文）：管理控制面凭证和锁定状态，集中编码 API 请求、会话失效与受限的读取重试。
 * Module responsibility (English): Binding unlocked-session credentials, cancellation lifetimes and restricted read retries.
 * 详细范围（中文）：公开入口包括 ControllerSession, controllerSession, api, RefreshQueue；职责覆盖绑定解锁会话凭证、取消寿命与受限读取重试，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ControllerSession, controllerSession, api, RefreshQueue. The scope covers Binding unlocked-session credentials, cancellation lifetimes and restricted read retries. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { SessionLockView } from '../shared/session-lock';
import type { AccessPrincipal } from '../shared/access-control';
import { resourceCache } from './resource-cache';
import { pluginGeneration } from './plugin-generation';
import { createOperationClient, type OperationTransport } from '../shared/api-client';
import { apiResponseError, SakuraApiError } from '../shared/errors';
import { encodeOperationBody } from '../shared/http-transport';

const graphqlQueryErrors = new Set(['GRAPHQL_PARSE_FAILED', 'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT', 'INVALID_QUERY', 'QUERY_LIMIT', 'READ_ONLY', 'CANCELLED']);

/** Cancel this wait, while the shared bootstrap remains available to other request owners. */
/**
 * 中文：让单个调用者取消等待 bootstrap，但保留共享认证任务供其他请求使用；认证完成或失败后移除本调用者的 abort 监听器。
 * English: Let one caller cancel its bootstrap wait without canceling shared authentication for other requests. Remove that caller's abort listener when authentication resolves or rejects.
 * 中文：输入：pending：签名所示 Promise<string> 业务值；signal：本次调用的取消寿命
 * English: Inputs: pending: the Promise<string> domain value in the signature; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<string>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<string> carrying the described computation/transport result; throwing branches do not provide success
 */
function waitForCredential(pending: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return pending;
  return new Promise(/** 中文：在绑定解锁会话凭证、取消寿命与受限读取重试流程中登记浏览器或资源事件监听，取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Binding unlocked-session credentials, cancellation lifetimes and restricted read retries, register browser/resource event listeners, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：resolve：此处理器的调用值；reject：此处理器的调用值 | English: Inputs: resolve: the invocation value for this handler; reject: the invocation value for this handler | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (resolve, reject) => {
    /**
     * 中文：只拒绝当前调用者的等待 Promise；不取消共享 bootstrap，以免一个界面取消影响其他请求。
     * English: Reject only this caller's wait promise without canceling shared bootstrap, so one surface's cancellation cannot affect others.
     */
    const abort = () => reject(signal.reason || new Error('请求已取消'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    pending.then(/** 中文：在绑定解锁会话凭证、取消寿命与受限读取重试流程中移除登记的事件监听，兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Binding unlocked-session credentials, cancellation lifetimes and restricted read retries, remove registered event listeners, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ value => { signal.removeEventListener('abort', abort); resolve(value); }, /** 中文：在绑定解锁会话凭证、取消寿命与受限读取重试流程中移除登记的事件监听，拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Binding unlocked-session credentials, cancellation lifetimes and restricted read retries, remove registered event listeners, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：error：此处理器的调用值 | English: Inputs: error: the invocation value for this handler | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

/** A controller credential belongs to one unlocked host session, not to the browser tab. */
export class ControllerSession {
  private token = '';
  private pending?: Promise<string>;
  private listeners = new Set</** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 ControllerSession 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of ControllerSession | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void>();
  private sessionListeners = new Set</** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 ControllerSession 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of ControllerSession | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void>();
  private session: SessionLockView = {
    configured: false,
    enabled: false,
    locked: false,
    idleMinutes: 15,
    retryAfterSeconds: 0,
  };
  private generation = 0;
  private accountMode = false;
  private principal?: AccessPrincipal;
  private credentialAbort = new AbortController();

  /**
   * 中文：取消当前凭证的在途请求寿命并创建新 AbortController；缓存失效由调用此入口的上层状态流程协调。
   * English: Abort the current credential's in-flight request lifetime and create a new AbortController; the surrounding state flow coordinates cache invalidation.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private invalidateRequests() {
    this.credentialAbort.abort(new Error('会话状态已变化，请重新操作'));
    this.credentialAbort = new AbortController();
  }

  /**
   * 中文：注入 fetch 实现并初始化凭证、会话及插件代次协调对象，浏览器默认传输保留 globalThis 接收者。
   * English: Inject fetch and initialize credential/session/plugin-generation coordination, preserving globalThis as receiver for the default browser transport.
   * 中文：输入：fetcher：注入的 fetch 传输实现（缺省 (...args) => fetch(...args)）
   * English: Inputs: fetcher: injected fetch transport implementation (default (...args) => fetch(...args))
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  constructor(private fetcher: typeof fetch = /** 中文：将参数转发给浏览器 fetch 并保留全局接收者，供没有注入测试传输的会话使用。 | English: Forward arguments to browser fetch with its global receiver for sessions without an injected transport. | 中文：输入：args：此处理器的调用值 | English: Inputs: args: the invocation value for this handler */ (...args) => fetch(...args)) {}

  /**
   * 中文：读取当前令牌用于外部订阅，不触发认证或刷新；尚未认证返回空状态。
   * English: Read the current token for external subscribers without authenticating or refreshing; unauthenticated sessions expose an empty state.
   */
  getToken = () => this.token;
  /**
   * 中文：读取最近控制面锁定/到期视图，不建立新的会话请求。
   * English: Read the latest controller lock/expiry view without making a new session request.
   */
  getSession = () => this.session;
  /**
   * 中文：读取凭证代次水位，供异步调用比较身份是否仍与发出时相同。
   * English: Read the credential-generation watermark so asynchronous callers can compare identity with its issue-time state.
   */
  getGeneration = () => this.generation;
  /**
   * 中文：读取是否使用账户登录，认证流程据此禁止账户模式退回共享 bootstrap。
   * English: Read whether account login is active; authentication uses it to prevent account mode from falling back to shared bootstrap.
   */
  getAccountMode = () => this.accountMode;
  /**
   * 中文：读取当前账户主体及角色视图，尚未采用账户时返回未设置状态。
   * English: Read the current account principal/roles, returning an unset state until an account is adopted.
   */
  getPrincipal = () => this.principal;
  /**
   * 中文：仅在登录模式确实变化时保存模式并清空旧凭证；跨模式切换必须重新认证而不能沿用旧权限。
   * English: Change the login mode only when different and clear old credentials; switching modes requires new authentication rather than retaining prior authority.
   * 中文：输入：enabled：是否启用本能力或读取流程
   * English: Inputs: enabled: whether this capability/read flow is enabled
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  setAccountMode = (enabled: boolean) => {
    if (enabled === this.accountMode) return;
    this.accountMode = enabled;
    this.clearCredential();
  };
  /**
   * 中文：校验账户令牌和角色数据后替换主体与令牌，撤销旧凭证寿命并推进代次，通知依赖身份的界面重读。
   * English: Validate account token/role data before replacing principal/token, revoke the prior credential lifetime, advance generation and notify identity-dependent surfaces.
   * 中文：输入：token：当前传输认证凭证；principal：账户主体及角色视图
   * English: Inputs: token: current transport credential; principal: account principal/role view
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   * 中文：拒绝原因：账户凭证格式错误。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 账户凭证格式错误. These errors reach the direct caller or this function's catch handler
   */
  adoptAccount = (token: string, principal: AccessPrincipal) => {
    if (!/^[a-f0-9]{64}$/.test(token) || !['owner', 'viewer', 'member'].includes(principal.role))
      throw new Error('账户凭证格式错误');
    this.accountMode = true;
    this.principal = principal;
    this.token = token;
    this.invalidateRequests();
    this.generation++;
    for (const listener of this.listeners) listener();
  };
  /**
   * 中文：清空令牌和账户主体、断开共享 bootstrap 引用并撤销当前凭证寿命；提高会话代次并通知订阅者，旧请求和缓存由此失效。
   * English: Clear the token/principal and shared bootstrap reference, revoke the current credential lifetime, advance the session generation and notify subscribers so old requests and caches become invalid.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  clearCredential = () => {
    this.token = '';
    this.principal = undefined;
    this.pending = undefined;
    this.invalidateRequests();
    this.generation++;
    for (const listener of this.listeners) listener();
  };
  /**
   * 中文：登记会话锁定/到期状态观察者，返回移除该监听的退订。
   * English: Register a session-lock/expiry observer and return an unsubscribe removing it.
   * 中文：输入：listener：本订阅的变化观察者
   * English: Inputs: listener: change observer for this subscription
   * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
   * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
   */
  subscribeSession = (listener: /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 ControllerSession.subscribeSession 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of ControllerSession.subscribeSession | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) => {
    this.sessionListeners.add(listener);
    return () => {
      this.sessionListeners.delete(listener);
    };
  };
  /**
   * 中文：仅在会话视图确实变化时更新；锁定标记切换时清空凭证，再通知会话观察者，避免重复相同视图触发无谓身份切换。
   * English: Update only when the session view changes. Clear credentials when the locked flag transitions, then notify session observers, avoiding unnecessary identity changes for duplicate views.
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  updateSession = (value: SessionLockView) => {
    if (JSON.stringify(value) === JSON.stringify(this.session)) return;
    const transitioned = value.locked !== this.session.locked;
    this.session = value;
    if (transitioned) {
      this.clearCredential();
    }
    for (const listener of this.sessionListeners) listener();
  };
  /**
   * 中文：把会话标记为 idle 锁定并清除到期字段，交给 updateSession 撤销凭证及通知界面。
   * English: Mark the session idle-locked and clear its expiry field, delegating credential revocation/UI notification to updateSession.
   */
  lockLocally = () =>
    this.updateSession({ ...this.session, locked: true, reason: 'idle', expiresAt: undefined });
  /**
   * 中文：登记凭证变化观察者，返回仅移除当前监听的清理函数。
   * English: Register a credential-change observer and return cleanup removing only this listener.
   * 中文：输入：listener：本订阅的变化观察者
   * English: Inputs: listener: change observer for this subscription
   * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
   * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
   */
  subscribe = (listener: /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 ControllerSession.subscribe 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of ControllerSession.subscribe | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // 并发读取共用一次 bootstrap；捕获的会话代次阻止锁定或换账户后迟到的凭证重新生效。
  /**
   * 中文：并发调用共用一次 bootstrap；锁定时拒绝，账户模式只接受已有账户凭证。捕获会话代次，锁定或换账户后返回的 bootstrap 不能恢复旧凭证；finally 仅清理仍属本请求的 pending。
   * English: Share one bootstrap among concurrent callers. Reject while locked; account mode requires an existing account credential. Capture the session generation so a bootstrap returning after lock/account changes cannot restore an old credential; finally clears only its own pending promise.
   * 中文：输入：staleToken：本次需要替换或复用的旧凭证（缺省 this.token）
   * English: Inputs: staleToken: prior credential to replace/reuse (default this.token)
   * 中文：结果：Promise<string>，包含上述计算或传输完成值；抛错分支不提供成功结果
   * English: Result: Promise<string> carrying the described computation/transport result; throwing branches do not provide success
   */
  authenticate(staleToken = this.token): Promise<string> {
    if (this.session.locked) return Promise.reject(new Error('控制面已锁定，请先解锁'));
    if (this.accountMode) {
      if (this.token) return Promise.resolve(this.token);
      return Promise.reject(new Error('账户会话已过期，请重新登录'));
    }
    // Another request may already have replaced the rejected credential.
    if (this.token && this.token !== staleToken) return Promise.resolve(this.token);
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = (/** 中文：异步读取 bootstrap 并核对发出时的会话代次，解析锁定状态与令牌；只有有效未锁会话采用凭证，旧请求完成不得恢复已撤销认证。 | English: Read bootstrap asynchronously and verify its captured session generation, interpreting lock state/token. Adopt credentials only for a valid unlocked session; late old work cannot restore revoked authentication. | 中文：拒绝原因：会话状态已变化，请重新操作；控制面已锁定，请先解锁；服务返回了无效的访问凭证。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 会话状态已变化，请重新操作; 控制面已锁定，请先解锁; 服务返回了无效的访问凭证. These errors reach the direct caller or this function's catch handler | 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态 | English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state */ async () => {
      const response = await this.fetcher('/api/bootstrap', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (generation !== this.generation) throw new Error('会话状态已变化，请重新操作');
      if (response.status === 423)
        this.updateSession(data.session || { ...this.session, enabled: true, locked: true });
      if (!response.ok) throw apiResponseError(response.status, data);
      if (data.session) this.updateSession(data.session);
      if (this.session.locked) throw new Error('控制面已锁定，请先解锁');
      if (typeof data.token !== 'string' || !data.token) throw new Error('服务返回了无效的访问凭证');
      if (this.token !== data.token) {
        this.token = data.token;
        for (const listener of this.listeners) listener();
      }
      return this.token;
    })().finally(() => {
      if (this.pending === pending) this.pending = undefined;
    });
    this.pending = pending;
    return this.pending;
  }

  /** Generated operation IDs bind request/response types and wire decoding together. */
  operation = createOperationClient((path, options) => this.perform(
    path.slice('/api'.length), options.method, options.body, options.signal, options,
  ));

  /**
   * 中文：把公共 Request 调用交给 perform，保持调用者信号与请求选项，作为组件和插件共享的认证传输入口。
   * English: Delegate public Request calls to perform while retaining caller signals/options, providing the authenticated transport shared by components/plugins.
   * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法（缺省 'GET'）；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
   * English: Inputs: path: target file/request path; method: request HTTP method (default 'GET'); body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
   * 中文：结果：Promise<T>，包含上述计算或传输完成值；抛错分支不提供成功结果
   * English: Result: Promise<T> carrying the described computation/transport result; throwing branches do not provide success
   */
  request = async <T = unknown>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> =>
    await this.perform(path, method, body, signal) as T;

  /**
   * 中文：按操作契约编码请求体，组合调用者、插件和凭证取消寿命，再发送认证请求。成功响应仍核对会话代次。只有带完整未执行证明的未授权 GET 可刷新后重试一次；写入和未知结果不会重放。处理锁定、稳定错误信封、受限 GraphQL 查询错误及非 JSON 响应，成功写入后使资源缓存失效。
   * English: Encode bodies from operation contracts, combine caller/plugin/credential lifetimes and send authenticated requests. Recheck session generation after success. Retry only one unauthorized GET carrying complete proof of non-execution; never replay writes or unknown outcomes. Handle locks, stable error envelopes, bounded GraphQL query errors and non-JSON replies, then invalidate resources after successful writes.
   * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法（缺省 'GET'）；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命；options：本次连接、传输或显示配置
   * English: Inputs: path: target file/request path; method: request HTTP method (default 'GET'); body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation; options: connection/transport/presentation configuration
   * 中文：结果：Promise<unknown>，包含上述计算或传输完成值；抛错分支不提供成功结果
   * English: Result: Promise<unknown> carrying the described computation/transport result; throwing branches do not provide success
   * 中文：拒绝原因：控制面已锁定，请先解锁；会话状态已变化，请重新操作。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 控制面已锁定，请先解锁; 会话状态已变化，请重新操作. These errors reach the direct caller or this function's catch handler
   * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
   * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  private perform = async (
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
    options?: Parameters<OperationTransport>[1],
  ): Promise<unknown> => {
    const encoded = encodeOperationBody(options?.bodyKind || (body === undefined ? 'none' : 'json'), body, options?.headers);
    // 每次请求同时受调用者取消、插件权限生命周期和当前账户凭证生命周期约束。
    const pluginSignal = pluginGeneration.capture(path, method);
    if (pluginSignal) signal = signal ? AbortSignal.any([signal, pluginSignal]) : pluginSignal;
    signal?.throwIfAborted();
    const authenticated = options?.authenticated ?? true;
    if (authenticated && !this.token) await waitForCredential(this.authenticate(), signal);
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      if (authenticated && !options?.allowLocked && this.session.locked) throw new Error('控制面已锁定，请先解锁');
      const generation = this.generation;
      const credential = this.token;
      const requestSignal = authenticated
        ? signal ? AbortSignal.any([signal, this.credentialAbort.signal]) : this.credentialAbort.signal
        : signal;
      const headers = { ...encoded.headers };
      if (authenticated) {
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'x-sakura-token') delete headers[key];
        headers['X-Sakura-Token'] = credential;
      }
      const response = await this.fetcher(`/api${path}`, {
        method,
        signal: requestSignal,
        headers,
        body: encoded.body,
      });
      if (response.ok && authenticated && generation !== this.generation) {
        await response.body?.cancel();
        throw new Error('会话状态已变化，请重新操作');
      }
      // Failed writes and ambiguous replies are never replayed. A read may refresh
      // once only when the host explicitly confirms rejection before execution.
      if (response.ok && options && options.response !== 'json') {
        signal?.throwIfAborted();
        if (method !== 'GET' && method !== 'HEAD') resourceCache.mutation(path);
        if (options.response === 'empty') { await response.body?.cancel(); return undefined; }
        if (options.response === 'text') {
          const text = await response.text();
          signal?.throwIfAborted();
          if (authenticated && generation !== this.generation) throw new Error('会话状态已变化，请重新操作');
          return text;
        }
        return response;
      }
      let data: any;
      try { data = await response.json(); }
      catch (error) { if (response.ok) throw error; throw apiResponseError(response.status, undefined); }
      if (response.ok) signal?.throwIfAborted();
      if (response.ok && authenticated && generation !== this.generation) throw new Error('会话状态已变化，请重新操作');
      if (authenticated && generation === this.generation && response.status === 423)
        this.updateSession(data.session || { ...this.session, enabled: true, locked: true });
      if (!response.ok) {
        // 只有服务端明确证明未执行的未授权 GET 才允许刷新凭证后重试一次；写入和未知执行结果不会重放。
        if (authenticated && !this.accountMode && generation === this.generation && attempt === 0 &&
          method === 'GET' && body === undefined && response.status === 401 && data?.code === 'UNAUTHORIZED' &&
          data.operationResult?.outcome === 'failed' && data.operationResult.executed === false &&
          typeof data.correlationId === 'string' && data.operationResult.correlationId === data.correlationId) {
          // Keep the captured rejected token: parallel reads share the refresh,
          // and a late old reply cannot clear a newer credential or its requests.
          await waitForCredential(this.authenticate(credential), signal);
          continue;
        }
        if (authenticated && generation === this.generation && response.status === 401 && this.token === credential)
          this.clearCredential();
        // Only explicitly classified query errors belong in the GraphQL workbench.
        // Unmarked exceptions and the shared HTTP error envelope retain their safe decoder.
        const errors: unknown = data?.errors;
        if (path === '/graphql' && method === 'POST' && response.status === 400 &&
          response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/graphql-response+json' &&
          Array.isArray(errors) && errors.length > 0 && errors.length <= 10 && errors.every(error =>
            error && typeof error.message === 'string' && error.message.length > 0 && error.message.length <= 32768 &&
            typeof error.extensions?.code === 'string' && graphqlQueryErrors.has(error.extensions.code))) {
          throw new SakuraApiError(errors.map(error => error.message.slice(0, 2000)).join('\n'), 400,
            errors[0].extensions.code, response.headers.get('x-sakura-correlation-id') || undefined);
        }
        throw apiResponseError(response.status, data);
      }
      if (method !== 'GET' && method !== 'HEAD') resourceCache.mutation(path);
      return data;
    }
  };
}

export const controllerSession = new ControllerSession();
export const api = controllerSession.request;
controllerSession.subscribe(() => resourceCache.reset());

/** Bursts share one read, with one fresh pass for changes received in flight. */
// 飞行中的刷新只记录“还需一次”；同一突发事件不会并行启动多份全量快照读取。
export class RefreshQueue {
  private pending?: Promise<void>;
  private again = false;
  /**
   * 中文：把刷新突发合并为一次在途执行，并在执行期间又收到刷新请求时补一轮；所有调用者等待同一 Promise，失败后清理 pending 以便后续重试。
   * English: Coalesce refresh bursts into one in-flight execution, adding a fresh pass when another refresh arrives during it. Callers share the promise; failures clear pending state so later calls can retry.
   * 中文：输入：action：本次动作或状态机输入
   * English: Inputs: action: current action/state-machine input
   */
  run(action: /** 中文：在调用者提供的取消信号范围内执行用户动作，失败以拒绝或抛错传回；这是 RefreshQueue.run 的调用契约 | English: Execute a user action within the supplied cancellation signal, propagating failure through rejection/throw; this is the callable contract of RefreshQueue.run | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<void>) {
    this.again = true;
    if (!this.pending) {
      this.pending = Promise.resolve()
        .then(/** 中文：更新 this.again 以维护绑定解锁会话凭证、取消寿命与受限读取重试当前状态；这些赋值属于此输入/事件的状态转换 | English: Update this.again to maintain current state for Binding unlocked-session credentials, cancellation lifetimes and restricted read retries; these assignments belong to this input/event transition | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
          while (this.again) {
            this.again = false;
            await action();
          }
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    return this.pending;
  }
}
