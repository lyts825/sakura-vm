/**
 * 模块职责：提供按所有者划分的网络作用域，封装请求、代理环境和连接资源生命周期。
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Agent as FetchAgent } from 'undici';
import { WebSocket } from 'ws';
import { networkRuntime, type NetworkIdentity, type NetworkRuntime } from './core.ts';
import type { Destination } from './host-pool.ts';
import { withPluginAuthority, withPluginBackground, pluginAuthority } from '../plugin-authority.ts';
import type { PluginInstance } from '../plugin-instance.ts';
import { withResourceContext } from '../host-runtime/context.ts';
export { networkRuntime, NetworkRuntime, networkDefaults } from './core.ts';
export type { NetworkIdentity } from './core.ts';
export type { VmNetworkLease } from './vm-backend.ts';

/** Host-issued capability: consumers cannot change its owner or grant themselves another generation. */
export class NetworkScope {
  readonly identity: NetworkIdentity;
  private abort = new AbortController();
  private fetchAgent?: FetchAgent;
  private agents = new Set<http.Agent>();
  private release: () => void;
  private detachParent?: () => void;
  private closeTask?: Promise<void>;
  constructor(
    identity: NetworkIdentity,
    private runtime: NetworkRuntime,
    signal?: AbortSignal,
  ) {
    this.identity = Object.freeze({ ...identity, scopeId: randomUUID() });
    this.release = runtime.own(() => this.close());
    if (signal?.aborted) void this.close(signal.reason).catch(() => {});
    else if (signal) {
      const close = () => {
        void this.close(signal.reason).catch(() => {});
      };
      signal.addEventListener('abort', close, { once: true });
      this.detachParent = () => signal.removeEventListener('abort', close);
    }
  }
  private signal(signal?: AbortSignal) {
    return signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal;
  }
  dial = (destination: Destination, signal?: AbortSignal, timeoutMs?: number) => {
    this.abort.signal.throwIfAborted();
    return this.runtime.dial(this.identity, destination, this.signal(signal), timeoutMs);
  };
  connectLocal: typeof net.createConnection = ((...args: any[]) => {
    this.abort.signal.throwIfAborted();
    // The project's local callers use object or IPC path forms. Numeric forms are normalized here.
    const options =
      typeof args[0] === 'string'
        ? { path: args[0] }
        : typeof args[0] === 'number'
          ? { port: args[0], host: typeof args[1] === 'string' ? args[1] : '127.0.0.1' }
          : args[0];
    const socket = this.runtime.connectLocal(this.identity, options);
    const abort = () => socket.destroy();
    this.abort.signal.addEventListener('abort', abort, { once: true });
    socket.once('close', () => this.abort.signal.removeEventListener('abort', abort));
    const callback = args.find((arg) => typeof arg === 'function');
    if (callback) socket.once('connect', callback);
    return socket;
  }) as typeof net.createConnection;
  manageServer = <T extends net.Server>(server: T) => {
    this.abort.signal.throwIfAborted();
    return this.runtime.manageServer(this.identity, server, this.abort.signal);
  };
  createServer: typeof net.createServer = ((...args: Parameters<typeof net.createServer>) =>
    this.manageServer(net.createServer(...args))) as typeof net.createServer;
  createHttpServer: typeof http.createServer = ((...args: Parameters<typeof http.createServer>) =>
    this.manageServer(http.createServer(...args))) as typeof http.createServer;
  createHttpsServer: typeof https.createServer = ((...args: Parameters<typeof https.createServer>) =>
    this.manageServer(https.createServer(...args))) as typeof https.createServer;
  lookup = (hostname: string, options: { family?: number } = {}) =>
    this.runtime.lookup(this.identity, hostname, options, this.abort.signal) as Promise<{
      address: string;
      family: number;
    }>;
  private makeAgent(secure: boolean, oneShot = false) {
    this.abort.signal.throwIfAborted();
    const connecting = new Set<AbortController>();
    const requests = new Set<http.ClientRequest>();
    const requestAbort = Symbol('managed request cancellation');
    const config = { keepAlive: !oneShot, maxSockets: 64, maxTotalSockets: 64, maxFreeSockets: 4 };
    const agent = (secure ? new https.Agent(config) : new http.Agent(config)) as http.Agent & {
      addRequest(request: http.ClientRequest, options: http.RequestOptions): void;
    };
    let destroyed = false;
    const stopped = () =>
      Object.assign(new Error('Managed HTTP transport is closed'), { code: 'NETWORK_UNAVAILABLE' });
    const failRequest = (request: http.ClientRequest, error: Error) => {
      // This is the same completion path Node's Agent uses when createConnection
      // fails. A queued request has no socket whose destruction could complete it.
      (request as http.ClientRequest & { onSocket(socket: null, error: Error): void }).onSocket(null, error);
    };
    const addRequest = agent.addRequest.bind(agent);
    agent.addRequest = (request, options) => {
      if (destroyed || this.abort.signal.aborted) {
        failRequest(request, stopped());
        return;
      }
      if (requests.size >= this.runtime.options.maxOwnerConnections) {
        failRequest(
          request,
          Object.assign(new Error('Managed HTTP request limit reached'), { code: 'NETWORK_BUSY' }),
        );
        return;
      }
      const abort = new AbortController();
      requests.add(request);
      request.once('close', () => requests.delete(request));
      const destroy = request.destroy;
      request.destroy = (error?: Error) => {
        const result = destroy.call(request, error);
        abort.abort(error);
        // Agent.destroy() does not empty its pending queue. Remove revoked
        // requests so a later free socket cannot silently revive them.
        for (const [key, queued] of Object.entries(agent.requests)) {
          if (!queued) continue;
          const index = queued.indexOf(request);
          if (index < 0) continue;
          (queued as http.ClientRequest[]).splice(index, 1);
          if (!queued.length) delete (agent.requests as Record<string, http.ClientRequest[]>)[key];
          failRequest(request, error || stopped());
          break;
        }
        return result;
      };
      try {
        addRequest(request, { ...options, [requestAbort]: abort } as http.RequestOptions);
      } catch (error) {
        requests.delete(request);
        throw error;
      }
    };
    agent.createConnection = ((
      options: tls.ConnectionOptions & {
        host: string;
        port: number;
        family?: number;
        [requestAbort]?: AbortController;
      },
      callback: (error: Error | null, socket?: net.Socket) => void,
    ) => {
      const abort = options[requestAbort] || new AbortController();
      connecting.add(abort);
      void Promise.resolve()
        .then(() => {
          if (destroyed) throw stopped();
          if (options.socket || (options as http.RequestOptions).socketPath)
            throw new Error('Custom HTTP sockets are not supported');
          return this.dial(
            { host: options.host, port: Number(options.port), family: options.family },
            abort.signal,
          );
        })
        .then(
          (socket) => {
            connecting.delete(abort);
            if (secure) {
              // TLS stays at the protocol adapter so existing CA/mTLS/pinning checks retain their meaning.
              try {
                const encrypted = tls.connect({
                  ...options,
                  socket,
                  servername: options.servername ?? (net.isIP(options.host) ? undefined : options.host),
                });
                callback(null, encrypted);
              } catch (error) {
                socket.destroy();
                callback(error as Error);
              }
            } else {
              callback(null, socket);
              socket.resume();
            }
          },
          (error) => {
            connecting.delete(abort);
            callback(error);
          },
        );
      return undefined;
    }) as typeof agent.createConnection;
    this.agents.add(agent);
    const destroy = agent.destroy.bind(agent);
    agent.destroy = () => {
      if (destroyed) return;
      destroyed = true;
      for (const request of requests) request.destroy(stopped());
      requests.clear();
      for (const abort of connecting) abort.abort();
      connecting.clear();
      this.agents.delete(agent);
      destroy();
    };
    return agent;
  }
  /** Smithy/AWS accepts these explicit transports instead of constructing an unmanaged default. */
  requestHandler = () => ({ httpAgent: this.makeAgent(false), httpsAgent: this.makeAgent(true) });
  /** Scoped HTTP CONNECT proxy for tools such as Git/npm that expose proxy configuration. */
  async proxyEnvironment() {
    const password = randomBytes(32).toString('hex');
    const expected = Buffer.from('Basic ' + Buffer.from('sakura:' + password).toString('base64'));
    const authorized = (request: http.IncomingMessage) => {
      const actual = Buffer.from(String(request.headers['proxy-authorization'] || ''));
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    };
    const server = this.createHttpServer({ maxHeaderSize: 8192 }, (request, response) => {
      if (!authorized(request)) {
        response.writeHead(407);
        response.end();
        return;
      }
      let url: URL;
      try {
        url = new URL(request.url || '');
        if (url.protocol !== 'http:' || url.username || url.password) throw new Error();
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }
      const headers: http.OutgoingHttpHeaders = { ...request.headers, host: url.host };
      for (const name of [
        'proxy-authorization',
        'proxy-connection',
        'connection',
        'keep-alive',
        'transfer-encoding',
        'te',
        'trailer',
        'upgrade',
        ...String(request.headers.connection || '')
          .toLowerCase()
          .split(','),
      ])
        delete headers[name.trim()];
      const abort = new AbortController();
      response.once('close', () => abort.abort());
      try {
        const upstream = this.httpRequest(
          url,
          { method: request.method, headers, signal: abort.signal },
          (reply) => {
            response.writeHead(reply.statusCode || 502, reply.headers);
            reply.pipe(response);
            reply.on('error', () => response.destroy());
          },
        );
        upstream.on('error', () => {
          if (!response.headersSent) response.writeHead(502);
          response.end();
        });
        request.pipe(upstream);
      } catch {
        response.writeHead(502);
        response.end();
      }
    });
    server.on('connect', (request, socket, head) => {
      socket.on('error', () => {});
      if (!authorized(request)) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
        return;
      }
      let destination: Destination;
      try {
        if (!/^(?:\[[0-9a-f:.]+\]|[^:/?#@\s]+):[0-9]+$/i.test(request.url || '')) throw new Error();
        const url = new URL('http://' + request.url);
        if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
        destination = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 80) };
      } catch {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      socket.pause();
      const abort = new AbortController();
      socket.once('close', () => abort.abort());
      void Promise.resolve()
        .then(() => this.dial(destination, abort.signal))
        .then(
          (upstream) => {
            if (socket.destroyed) return upstream.destroy();
            upstream.on('error', () => socket.destroy());
            upstream.once('close', () => socket.destroy());
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            socket.pipe(upstream);
            upstream.pipe(socket);
            socket.resume();
            upstream.resume();
          },
          () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'),
        );
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address() as net.AddressInfo;
    const proxy = `http://sakura:${password}@127.0.0.1:${address.port}`;
    return {
      env: {
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        ALL_PROXY: proxy,
        http_proxy: proxy,
        https_proxy: proxy,
        all_proxy: proxy,
        NO_PROXY: '',
        no_proxy: '',
        npm_config_proxy: proxy,
        npm_config_https_proxy: proxy,
      },
      close: () => this.runtime.closeServer(server),
    };
  }
  webSocket = (url: string, options: WebSocket.ClientOptions = {}) => {
    this.abort.signal.throwIfAborted();
    this.runtime.check(this.identity, 'dial');
    if (options.agent || options.createConnection || (options as http.RequestOptions).socketPath)
      throw new Error('Custom WebSocket transports are not supported');
    const protocol = new URL(url).protocol;
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(protocol))
      throw new Error('Unsupported WebSocket protocol');
    const agent = this.makeAgent(protocol === 'wss:' || protocol === 'https:', true);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, { ...options, agent });
    } catch (error) {
      agent.destroy();
      throw error;
    }
    const close = () => socket.terminate();
    this.abort.signal.addEventListener('abort', close, { once: true });
    socket.once('close', () => {
      agent.destroy();
      this.abort.signal.removeEventListener('abort', close);
    });
    return socket;
  };
  private request(secure: boolean, args: any[]) {
    this.abort.signal.throwIfAborted();
    this.runtime.check(this.identity, 'dial');
    const first = args[0];
    const urlForm = typeof first === 'string' || first instanceof URL;
    const options = { ...(urlForm ? (typeof args[1] === 'object' ? args[1] : {}) : first) };
    const callback = args.find((arg) => typeof arg === 'function');
    // SDK-specific agents/custom sockets cannot silently bypass network ownership.
    if (
      options.createConnection ||
      options.socketPath ||
      options.socket ||
      (options.agent && options.agent !== false)
    )
      throw new Error('Use the managed network transport instead of a custom HTTP agent');
    const agent = this.makeAgent(secure, true);
    options.agent = agent;
    options.signal = this.signal(options.signal);
    let request: http.ClientRequest;
    try {
      request = (secure ? https.request : http.request)(
        ...((urlForm ? [first, options, callback] : [options, callback]) as [any, any, any]),
      );
    } catch (error) {
      agent.destroy();
      throw error;
    }
    let detached = false;
    const detach = (_response: http.IncomingMessage, socket: net.Socket) => {
      detached = true;
      socket.once('close', () => agent.destroy());
    };
    request.once('connect', detach);
    request.once('upgrade', detach);
    request.once('close', () => {
      if (!detached) agent.destroy();
    });
    return request;
  }
  httpRequest: typeof http.request = ((...args: any[]) => this.request(false, args)) as typeof http.request;
  httpsRequest: typeof https.request = ((...args: any[]) => this.request(true, args)) as typeof https.request;
  httpsGet: typeof https.get = ((...args: any[]) => {
    const request = this.request(true, args);
    request.end();
    return request;
  }) as typeof https.get;
  fetch: typeof globalThis.fetch = (input, init) => {
    this.abort.signal.throwIfAborted();
    this.runtime.check(this.identity, 'dial');
    this.fetchAgent ||= new FetchAgent({
      connections: 16,
      pipelining: 1,
      keepAliveTimeout: 1000,
      connect: (options, callback) => {
        const hostname = options.hostname.replace(/^\[|\]$/g, '');
        void Promise.resolve()
          .then(() =>
            this.dial({
              host: hostname,
              port: Number(options.port || (options.protocol === 'https:' ? 443 : 80)),
            }),
          )
          .then(
            (socket) => {
              if (options.protocol === 'https:') {
                let encrypted: tls.TLSSocket;
                try {
                  encrypted = tls.connect({
                    socket,
                    host: hostname,
                    ALPNProtocols: ['http/1.1'],
                    servername: options.servername || (net.isIP(hostname) ? undefined : hostname),
                  });
                } catch (error) {
                  socket.destroy();
                  callback(error as Error, null);
                  return;
                }
                let complete = false;
                const finish = (error?: Error) => {
                  if (complete) return;
                  complete = true;
                  clearTimeout(timer);
                  encrypted.off('error', failed);
                  encrypted.off('close', closed);
                  if (error) {
                    encrypted.destroy();
                    callback(error, null);
                  } else callback(null, encrypted);
                };
                const failed = (error: Error) => finish(error);
                const closed = () => finish(new Error('TLS connection closed before handshake completed'));
                const timer = setTimeout(
                  () => finish(Object.assign(new Error('TLS handshake timed out'), { code: 'ETIMEDOUT' })),
                  10_000,
                );
                timer.unref();
                encrypted.once('secureConnect', () => finish());
                encrypted.once('error', failed);
                encrypted.once('close', closed);
              } else {
                callback(null, socket);
                socket.resume();
              }
            },
            (error) => callback(error, null),
          );
      },
    });
    const signal = this.signal(
      init && 'signal' in init
        ? init.signal || undefined
        : input instanceof Request
          ? input.signal
          : undefined,
    );
    return globalThis.fetch(input, { ...init, signal, dispatcher: this.fetchAgent } as RequestInit);
  };
  close(reason?: unknown) {
    if (this.closeTask) return this.closeTask;
    const closing = (async () => {
      const released = this.runtime.whenReleased(this.identity);
      this.detachParent?.();
      this.abort.abort(reason);
      for (const agent of this.agents) agent.destroy();
      this.agents.clear();
      try {
        await this.fetchAgent?.destroy();
      } finally {
        await released;
      }
      this.release();
    })();
    this.closeTask = closing;
    void closing.catch(() => { if (this.closeTask === closing) this.closeTask = undefined; });
    return closing;
  }
}

export function networkFor(owner: string, purpose = owner, signal?: AbortSignal) {
  const origin = pluginAuthority();
  const scopes = new WeakMap<PluginInstance, NetworkScope>();
  let core: NetworkScope | undefined;
  const get = (closing = false) => {
    const instance = origin || pluginAuthority();
    if (!instance) return core ||= new NetworkScope({ owner, purpose }, networkRuntime, signal);
    if (!closing) instance.check('network', true);
    let scope = scopes.get(instance);
    if (!scope) {
      if (closing) return undefined;
      scope = withResourceContext(instance.resourceIdentity, () => new NetworkScope({ owner: instance.owner, purpose }, networkRuntime,
        signal ? AbortSignal.any([signal, instance.signal]) : instance.signal));
      scopes.set(instance, scope);
      instance.scope.add(() => scope!.close());
    }
    return scope;
  };
  return new Proxy(Object.create(null), {
    get(_target, key) {
      if (key === 'close') return (reason?: unknown) => get(true)?.close(reason) || Promise.resolve();
      if (key === 'identity') return get()!.identity;
      return (...args: unknown[]) => {
        const scope = get()!;
        const instance = origin || pluginAuthority();
        const invoke = () => Reflect.apply(Reflect.get(scope, key, scope), scope, instance ? args.map(arg => typeof arg === 'function' ?
          (...input: unknown[]) => {
            if (instance.phase !== 'running' || instance.signal.aborted) return;
            try {
              return withPluginBackground(instance, () => { instance.check('network'); return Reflect.apply(arg, undefined, input); });
            } catch (error) { if (instance.signal.aborted || instance.phase !== 'running') return; throw error; }
          } : arg) : args);
        return instance ? withPluginAuthority(instance, invoke, () => instance.check('network', true)) : invoke();
      };
    },
    set: () => false,
  }) as NetworkScope;
}
