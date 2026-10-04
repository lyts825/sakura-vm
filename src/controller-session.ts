import type { SessionLockView } from '../shared/session-lock';
import type { AccessPrincipal } from '../shared/access-control';
import { resourceCache } from './resource-cache';
import { pluginGeneration } from './plugin-generation';
import { createOperationClient, type OperationTransport } from '../shared/api-client';

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
      if (!response.ok) throw new Error(data.error || '无法连接 Sakura 服务');
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
      const payload = body !== undefined && options?.transport === 'form' &&
        typeof body === 'object' && body !== null && !(body instanceof URLSearchParams)
        ? new URLSearchParams(Object.entries(body).map(([key, value]) => {
          if (typeof value !== 'string') throw new Error('表单字段必须是字符串');
          return [key, value];
        })) : body;
      const response = await this.fetcher(`/api${path}`, {
        method,
        signal: requestSignal,
        headers: {
          ...options?.headers,
          ...(authenticated ? { 'X-Sakura-Token': credential } : {}),
          ...(body !== undefined && (!options || options.transport === 'json') ? { 'Content-Type': 'application/json' } : {}),
        },
        body: payload === undefined ? undefined : !options || options.transport === 'json'
          ? JSON.stringify(payload) : payload as BodyInit,
      });
      if (authenticated && generation !== this.generation) {
        await response.body?.cancel();
        throw new Error('会话状态已变化，请重新操作');
      }
      // The host rejects 401 before executing the operation. Never replay a
      // mutation after a network error or an ambiguous server response.
      if (authenticated && response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        if (this.accountMode) {
          this.clearCredential();
          throw new Error('账户会话已过期，请重新登录');
        }
        await waitForCredential(this.authenticate(credential), signal);
        continue;
      }
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
      const data = await response.json();
      signal?.throwIfAborted();
      if (authenticated && generation !== this.generation) throw new Error('会话状态已变化，请重新操作');
      if (authenticated && response.status === 423)
        this.updateSession(data.session || { ...this.session, enabled: true, locked: true });
      if (!response.ok)
        throw new Error(
          data.error ||
            (path === '/graphql' && Array.isArray(data.errors)
              ? data.errors
                  .slice(0, 10)
                  .map((item: { message?: string }) => item.message)
                  .filter(Boolean)
                  .join('；')
              : '') ||
            `请求失败（${response.status}）`,
        );
      if (method !== 'GET' && method !== 'HEAD') resourceCache.mutation(path);
      return data;
    }
  };
}

export const controllerSession = new ControllerSession();
export const api = controllerSession.request;
controllerSession.subscribe(() => resourceCache.reset());

/** Bursts share one read, with one fresh pass for changes received in flight. */
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
