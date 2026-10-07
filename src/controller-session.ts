/**
 * 模块职责：管理控制面凭证和锁定状态，集中编码 API 请求、会话失效与受限的读取重试。
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
function waitForCredential(pending: Promise<string>, signal?: AbortSignal): Promise<string> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('请求已取消'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

/** A controller credential belongs to one unlocked host session, not to the browser tab. */
export class ControllerSession {
  private token = '';
  private pending?: Promise<string>;
  private listeners = new Set<() => void>();
  private sessionListeners = new Set<() => void>();
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

  private invalidateRequests() {
    this.credentialAbort.abort(new Error('会话状态已变化，请重新操作'));
    this.credentialAbort = new AbortController();
  }

  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}

  getToken = () => this.token;
  getSession = () => this.session;
  getGeneration = () => this.generation;
  getAccountMode = () => this.accountMode;
  getPrincipal = () => this.principal;
  setAccountMode = (enabled: boolean) => {
    if (enabled === this.accountMode) return;
    this.accountMode = enabled;
    this.clearCredential();
  };
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
  clearCredential = () => {
    this.token = '';
    this.principal = undefined;
    this.pending = undefined;
    this.invalidateRequests();
    this.generation++;
    for (const listener of this.listeners) listener();
  };
  subscribeSession = (listener: () => void) => {
    this.sessionListeners.add(listener);
    return () => {
      this.sessionListeners.delete(listener);
    };
  };
  updateSession = (value: SessionLockView) => {
    if (JSON.stringify(value) === JSON.stringify(this.session)) return;
    const transitioned = value.locked !== this.session.locked;
    this.session = value;
    if (transitioned) {
      this.clearCredential();
    }
    for (const listener of this.sessionListeners) listener();
  };
  lockLocally = () =>
    this.updateSession({ ...this.session, locked: true, reason: 'idle', expiresAt: undefined });
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // 并发读取共用一次 bootstrap；捕获的会话代次阻止锁定或换账户后迟到的凭证重新生效。
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
    const pending = (async () => {
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

  request = async <T = unknown>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> =>
    await this.perform(path, method, body, signal) as T;

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
  run(action: () => Promise<void>) {
    this.again = true;
    if (!this.pending) {
      this.pending = Promise.resolve()
        .then(async () => {
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
