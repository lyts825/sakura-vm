/** A controller credential belongs to one server process, not to the browser tab. */
export class ControllerSession {
  private token = '';
  private pending?: Promise<string>;
  private listeners = new Set<() => void>();

  constructor(private fetcher: typeof fetch = (...args) => fetch(...args)) {}

  getToken = () => this.token;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  authenticate(staleToken = this.token): Promise<string> {
    // Another request may already have replaced the rejected credential.
    if (this.token && this.token !== staleToken) return Promise.resolve(this.token);
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await this.fetcher('/api/bootstrap', {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('无法连接 Sakura 服务');
      const data = await response.json();
      if (typeof data.token !== 'string' || !data.token) throw new Error('服务返回了无效的访问凭证');
      if (this.token !== data.token) {
        this.token = data.token;
        for (const listener of this.listeners) listener();
      }
      return this.token;
    })().finally(() => {
      this.pending = undefined;
    });
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
      // The host rejects 401 before executing the operation. Never replay a
      // mutation after a network error or an ambiguous server response.
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        await this.authenticate(credential);
        continue;
      }
      const data = await response.json();
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
