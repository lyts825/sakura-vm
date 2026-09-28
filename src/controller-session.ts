import type { SessionLockView } from '../shared/session-lock';
import type { AccessPrincipal } from '../shared/access-control';

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
    if (!/^[a-f0-9]{64}$/.test(token) || !['owner', 'viewer'].includes(principal.role))
      throw new Error('账户凭证格式错误');
    this.accountMode = true;
    this.principal = principal;
    this.token = token;
    this.generation++;
    for (const listener of this.listeners) listener();
  };
  clearCredential = () => {
    this.token = '';
    this.principal = undefined;
    this.pending = undefined;
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

  request = async <T = any>(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> => {
    signal?.throwIfAborted();
    if (!this.token) await this.authenticate();
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      if (this.session.locked) throw new Error('控制面已锁定，请先解锁');
      const generation = this.generation;
      const credential = this.token;
      const response = await this.fetcher(`/api${path}`, {
        method,
        signal,
        headers: {
          'X-Sakura-Token': credential,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (generation !== this.generation) {
        await response.body?.cancel();
        throw new Error('会话状态已变化，请重新操作');
      }
      // The host rejects 401 before executing the operation. Never replay a
      // mutation after a network error or an ambiguous server response.
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        if (this.accountMode) {
          this.clearCredential();
          throw new Error('账户会话已过期，请重新登录');
        }
        await this.authenticate(credential);
        continue;
      }
      const data = await response.json();
      if (generation !== this.generation) throw new Error('会话状态已变化，请重新操作');
      if (response.status === 423)
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
      return data as T;
    }
  };
}

export const controllerSession = new ControllerSession();
export const api = controllerSession.request;

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
