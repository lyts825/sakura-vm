import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { totalmem, freemem, cpus, hostname, platform, arch, loadavg } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { z, ZodError } from 'zod';
import { ROOT, PORT, IMAGE, AppError } from './model.ts';
import { createRuntime } from './runtime.ts';
import { Machines } from './machines.ts';
import { sameOrigin, tokenMatches } from './security.ts';
import { Features } from './features.ts';
import { PluginManager } from './plugin-manager.ts';
import { validateRegistry } from './plugins/registry.ts';
import { readJsonBody as body, requestUrl } from './http.ts';
import type { ClientChannel } from 'ssh2';
import { hostAudit } from './audit.ts';
import { Jobs } from './jobs.ts';
import { monitorSnapshot } from './monitor.ts';
import { apiDocument } from './openapi.ts';
import { generateSdk } from './sdk.ts';
import { LogRetention, logRetentionRequest } from './log-retention.ts';
import { GraphApi, graphqlInfo, graphqlLimits, querySnapshot } from './graphql-api.ts';
import { SessionLock } from './session-lock.ts';
import { Webhooks, collectWebhookEvents } from './webhooks.ts';
import { AutomationRules } from './automation-rules.ts';
import { FeatureRollouts } from './feature-rollouts.ts';
import { HostPeers } from './host-peers.ts';
import { ColdMigrations } from './cold-migration.ts';
import { LocalAssistant, assistantRequest } from './local-assistant.ts';
import { NativeIntegration, nativeMappings } from './native-integration.ts';

async function main() {
  let token = randomBytes(32).toString('hex');
  let sessionChanged = (_locked: boolean, _transitioned: boolean) => {};
  const session = new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned));
  await session.init();
  const dev = process.argv.includes('--dev');
  validateRegistry();
  const plugins = new PluginManager();
  const selectedPlugins = await plugins.init();
  const engine = await createRuntime();
  const machines = new Machines(engine);
  await machines.init();
  const audit = hostAudit();
  Jobs.instrument = (job, work) =>
    audit.span(
      {
        kind: 'job',
        name: (job.scope || 'task') + ':' + (job.action || 'run'),
        vmId: job.vmId,
        projectId: job.projectId,
        jobId: job.id,
      },
      work,
    );
  let features: Features;
  const rollouts = new FeatureRollouts(undefined,
    () => !!features?.migration?.blocked,
    (delta) => { if (features) features.mutations += delta; });
  await rollouts.init();
  features = await Features.create(machines, selectedPlugins,
    (id) => rollouts.decision(id).allowed);
  const hostPeers = new HostPeers(async () => {
    const vms = await machines.list();
    return { platform: platform(), arch: arch(), cpus: Math.max(1, cpus().length),
      memoryTotal: totalmem(), memoryFree: freemem(), load: loadavg().map((value) => Math.max(0, value)),
      vmCount: vms.length, runningVms: vms.filter((vm) => vm.status === 'running').length };
  }, undefined, hostname().slice(0, 128),
  () => !!features.migration?.blocked,
  (delta) => { features.mutations += delta; });
  await hostPeers.init();
  features.next?.setResourceScheduler((input) => hostPeers.score(input));
  const importedPeerVm = (requesterId: string, transferId: string) =>
    [...machines.records.values()].find((vm) =>
      vm.migrationOrigin?.sourceHostId === requesterId &&
      vm.migrationOrigin.transferId === transferId);
  hostPeers.setImportReceiver({
    status: async ({ requesterId, transferId }) => {
      if (!features.bundles) throw new AppError('请先启用快照与实例包插件', 503);
      const vm = importedPeerVm(requesterId, transferId);
      return vm ? { id: vm.id, name: vm.migrationOrigin!.targetName } : null;
    },
    receive: async ({ requesterId, transferId, name, source, signal }) => {
      session.requireUnlocked();
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (!features.bundles) throw new AppError('请先启用快照与实例包插件', 503);
      const imported = await features.bundles.import(name, source, signal, () => {
        session.requireUnlocked();
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      }, { sourceHostId: requesterId, transferId, targetName: name });
      return { id: imported.id, name };
    },
  });
  let coldMigrations: ColdMigrations | undefined;
  if (features.next && features.bundles) {
    coldMigrations = new ColdMigrations(machines, features.bundles, hostPeers);
    await coldMigrations.init();
    features.next.setColdMigrations(coldMigrations);
  }
  const native = new NativeIntegration(
    () => nativeMappings(features),
    undefined,
    undefined,
    undefined,
    undefined,
    (id?: string) => {
      session.requireUnlocked();
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (id) {
        machines.get(id);
        machines.requireUnlocked(id);
      }
    },
  );
  await native.init();
  const assistant = new LocalAssistant();
  await assistant.init();
  const eventSource = async () => collectWebhookEvents(
    machines,
    features.jobStores().flatMap((store) => store.list()),
    (await features.suite?.alertEvents()) || [],
  );
  const webhooks = new Webhooks(
    eventSource,
    undefined,
    undefined,
    undefined,
    () => !!features.migration?.blocked,
    (delta) => {
      features.mutations += delta;
    },
  );
  await webhooks.init();
  const automationRules = new AutomationRules(eventSource, machines, undefined, undefined,
    () => !!features.migration?.blocked,
    (delta) => { features.mutations += delta; });
  await automationRules.init();
  const retention = new LogRetention(
    () => features.jobStores(),
    undefined,
    () => !!features.migration?.blocked,
    undefined,
    (delta) => {
      features.mutations += delta;
    },
  );
  await retention.init();
  const graph = new GraphApi(async () => querySnapshot(machines, features.jobStores(), features.enabled));
  plugins.activated(features.enabled, features.errors, features.lifecycle);
  const ws = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  const protectedResponses = new Set<ServerResponse>();
  sessionChanged = (locked, transitioned) => {
    if (transitioned) token = randomBytes(32).toString('hex');
    if (locked) {
      native.revoke();
      assistant.revoke();
      for (const client of ws.clients) client.terminate();
      for (const response of protectedResponses) response.destroy();
    }
    machines.emit('change');
  };
  const socketVms = new WeakMap<WebSocket, string>();
  machines.on('incident-lockdown', (id: string) => {
    for (const store of features.jobStores())
      for (const job of store.list())
        if (job.vmId === id && job.status === 'running' && job.id) store.cancel(job.id);
    for (const socket of ws.clients)
      if (socketVms.get(socket) === id) socket.close(1008, 'Incident lockdown');
  });
  let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined;
  const equalToken = (value: unknown) => tokenMatches(value, token);
  const allowedRequest = (req: IncomingMessage) => sameOrigin(req.headers, PORT);
  const authorized = (req: IncomingMessage) => {
    session.requireUnlocked();
    if (!equalToken(req.headers['x-sakura-token'])) throw new AppError('访问凭证已过期，请刷新页面', 401);
  };
  const authorizedBody = async (req: IncomingMessage, limit?: number, signal?: AbortSignal) => {
    const input = await body(req, limit, signal);
    authorized(req);
    return input;
  };
  function send(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  }
  const api = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (url.pathname === '/api/session') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, session.view());
    }
    if (url.pathname === '/api/session/unlock') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      return send(res, await session.unlock(await body(req, 4096)));
    }
    session.requireUnlocked();
    if (req.method === 'GET' && url.pathname === '/api/bootstrap')
      return send(res, { token, session: session.view() });
    // End already admitted streams when a lock takes effect. The lock response itself must survive.
    if (url.pathname !== '/api/session/lock') {
      protectedResponses.add(res);
      const remove = () => protectedResponses.delete(res);
      res.once('finish', remove);
      res.once('close', remove);
    }
    if (await features.downloads?.route(req, res, url)) return;
    authorized(req);
    if (url.pathname === '/api/session/lock' || url.pathname === '/api/session/activity') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      return send(res, url.pathname.endsWith('/lock') ? session.lock() : session.activity());
    }
    if (url.pathname === '/api/session/settings') {
      if (req.method === 'GET') return send(res, session.view());
      if (req.method !== 'PATCH') throw new AppError('不支持此方法', 405);
      features.mutations++;
      try {
        const input = await authorizedBody(req, 4096);
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        return send(res, await session.configure(input));
      } finally {
        features.mutations--;
      }
    }
    if (url.pathname === '/api/graphql-schema') {
      if (req.method !== 'GET') throw new AppError('Schema 接口仅支持读取', 405);
      return send(res, graphqlInfo());
    }
    if (url.pathname === '/api/graphql') {
      if (req.method !== 'POST') throw new AppError('GraphQL 查询使用 POST JSON', 405);
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableFinished) abort.abort();
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      if (req.aborted || res.destroyed) cancel();
      try {
        const result = await graph.query(
          await authorizedBody(req, graphqlLimits.requestBytes, abort.signal),
          abort.signal,
        );
        res.writeHead(result.status, {
          'Content-Type': 'application/graphql-response+json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(JSON.stringify(result.body));
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
      }
    }
    if (url.pathname === '/api/openapi' || url.pathname === '/api/sdk') {
      if (req.method !== 'GET') throw new AppError('文档接口仅支持读取', 405);
      const specification = apiDocument(features.enabled, PORT);
      return send(
        res,
        url.pathname === '/api/openapi'
          ? specification
          : { filename: 'sakura-client.mjs', mime: 'text/javascript', content: generateSdk(specification) },
      );
    }
    if (url.pathname === '/api/monitor') {
      if (req.method !== 'GET') throw new AppError('监控接口仅支持读取', 405);
      return send(res, await monitorSnapshot(machines, features.jobStores()));
    }
    if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, await audit.read(200));
    if (
      features.migration?.blocked &&
      req.method !== 'GET' &&
      url.pathname !== '/api/migration' &&
      !/^\/api\/jobs\/[^/]+\/cancel$/.test(url.pathname)
    )
      throw new AppError('数据目录迁移维护中，请等待完成并重启服务', 409);
    if (url.pathname === '/api/log-retention') {
      if (req.method === 'GET') return send(res, retention.view());
      if (req.method === 'POST') {
        const input = logRetentionRequest.parse(await authorizedBody(req));
        return send(
          res,
          input.action === 'preview'
            ? retention.preview(input.policy)
            : await retention.save(input.policy, input.token),
        );
      }
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/webhooks') {
      if (req.method === 'GET') return send(res, webhooks.view());
      if (req.method === 'POST') return send(res, await webhooks.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/automation-rules') {
      if (req.method === 'GET') return send(res, automationRules.view());
      if (req.method === 'POST') return send(res,
        await automationRules.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/feature-rollouts') {
      if (req.method === 'GET') return send(res, {
        ...rollouts.view(), selected: selectedPlugins, active: [...features.enabled],
      });
      if (req.method === 'POST') return send(res,
        await rollouts.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/host-peers') {
      if (req.method === 'GET') return send(res,
        { ...hostPeers.view(), local: await hostPeers.status() });
      if (req.method === 'POST') return send(res,
        await hostPeers.configure(await authorizedBody(req, 32768)));
      throw new AppError('不支持此方法', 405);
    }
    if (url.pathname === '/api/cold-migrations') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, coldMigrations?.view() || { enabled: false, entries: [] });
    }
    if (url.pathname === '/api/native-integration') {
      if (req.method === 'GET') return send(res, await native.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      features.mutations++;
      try {
        return send(res, await native.action(await authorizedBody(req, 32768)));
      } finally {
        features.mutations--;
      }
    }
    if (url.pathname === '/api/assistant') {
      if (req.method === 'GET') return send(res, assistant.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const abort = new AbortController();
      const cancel = () => {
        if (!res.writableFinished) abort.abort();
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      if (req.aborted || res.destroyed) cancel();
      try {
        const input = assistantRequest.parse(await authorizedBody(req, 128 * 1024, abort.signal));
        if (input.action === 'configure') {
          features.mutations++;
          try {
            if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
            return send(res, await assistant.configure(input.version, input.settings));
          } finally {
            features.mutations--;
          }
        }
        if (input.action === 'preview') return send(res, assistant.preview(input.input));
        return send(
          res,
          input.action === 'models'
            ? await assistant.models(abort.signal)
            : await assistant.generate(input.previewId, abort.signal),
        );
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
      }
    }
    const route = url.pathname.split('/').filter(Boolean);
    if (route[1] === 'vms' && route[2] && route[3] === 'lockdown' && route.length === 4) {
      machines.get(route[2]);
      if (req.method === 'GET') return send(res, { locked: machines.incidentLocked(route[2]) });
      if (req.method === 'POST') {
        const input = z
          .object({ locked: z.boolean() })
          .strict()
          .parse(await authorizedBody(req));
        return send(res, await machines.setIncidentLockdown(route[2], input.locked));
      }
      throw new AppError('不支持此方法', 405);
    }
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      route[1] === 'vms' &&
      route[2] &&
      route[3] !== 'stop' &&
      route[3] !== 'next-features'
    )
      machines.requireUnlocked(route[2]);
    if (url.pathname === '/api/plugins') {
      if (req.method === 'GET') return send(res, plugins.view());
      if (req.method === 'PATCH') {
        features.mutations++;
        try {
          const input = await authorizedBody(req);
          if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
          return send(res, await plugins.change(input));
        } finally {
          features.mutations--;
        }
      }
      throw new AppError('不支持此方法', 405);
    }
    if (await features.route(req, res, url, (request, signal, limit) => authorizedBody(request, limit, signal)))
      return;
    if (req.method === 'GET' && url.pathname === '/api/system')
      return send(res, {
        name: 'Sakura',
        version: '0.1.0',
        engine: engine.version,
        posixloom: '0.1.0',
        nativeHost: Boolean(engine.runtime.findNativeHost()),
        hostname: hostname(),
        platform: process.platform,
        hostCpus: cpus().length,
        hostMemoryMiB: Math.round(totalmem() / 1048576),
        freeMemoryMiB: Math.round(freemem() / 1048576),
        controllerMemoryMiB: Math.round(process.memoryUsage().rss / 1048576),
        imageReady: existsSync(IMAGE),
        imageBytes: (await stat(IMAGE).catch(() => null))?.size || 0,
        plugins: [...features.enabled],
        session: session.view(),
      });
    if (route[1] === 'vms' && route.length === 2) {
      if (req.method === 'GET') return send(res, await machines.list());
      if (req.method === 'POST') {
        const input = await authorizedBody(req);
        features.validateConfig(input);
        return send(res, await machines.create(input), 201);
      }
    }
    if (route[1] === 'vms' && route[2]) {
      const id = route[2];
      machines.get(id);
      if (route.length === 3) {
        if (req.method === 'GET') return send(res, await machines.view(id));
        if (req.method === 'PATCH') {
          const input = await authorizedBody(req);
          features.validateConfig(input, machines.get(id));
          return send(res, await machines.update(id, input));
        }
        if (req.method === 'DELETE') {
          await machines.delete(id);
          return send(res, { ok: true });
        }
      }
      if (req.method === 'POST' && route.length === 4 && route[3] === 'start')
        return send(res, await machines.start(id));
      if (req.method === 'POST' && route.length === 4 && route[3] === 'stop') {
        const options = z
          .object({ force: z.boolean().default(false) })
          .strict()
          .parse(await authorizedBody(req));
        return send(res, await machines.stop(id, options.force));
      }
      if (req.method === 'POST' && route.length === 4 && route[3] === 'exec') {
        const { command } = z
          .object({ command: z.string().min(1).max(65536) })
          .strict()
          .parse(await authorizedBody(req));
        return send(res, await machines.exec(id, command));
      }
      if (req.method === 'GET' && route.length === 4 && route[3] === 'logs')
        return send(res, { content: machines.logs.get(id) || '' });
    }
    throw new AppError('接口不存在', 404);
  };

  const server = createServer(async (req, res) => {
    try {
      if (!allowedRequest(req)) throw new AppError('仅接受本机同源访问', 403);
      const url = requestUrl(req.url, PORT);
      if (!url) throw new AppError('无效的请求地址', 400);
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method || '') && equalToken(req.headers['x-sakura-token'])) {
          const vmId = /^\/api\/vms\/([a-f0-9-]{36})(?:\/|$)/.exec(url.pathname)?.[1];
          return await audit.span(
            {
              kind: 'request',
              name: (req.method + ' ' + url.pathname).slice(0, 200),
              ...(vmId && z.uuid().safeParse(vmId).success ? { vmId } : {}),
            },
            () => api(req, res, url),
            () => res.statusCode,
          );
        }
        return await api(req, res, url);
      }
      if (vite) return vite.middlewares(req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('不支持此方法', 405);
      const dist = join(ROOT, 'dist');
      const path = resolve(dist, '.' + decodeURIComponent(url.pathname));
      if (path !== dist && !path.startsWith(dist + sep)) throw new AppError('无效路径', 403);
      const candidate = (await stat(path).catch(() => null))?.isFile() ? path : join(dist, 'index.html');
      const data = await readFile(candidate);
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json',
      };
      res.writeHead(200, {
        'Content-Type': mime[extname(candidate)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          candidate.endsWith('index.html') ||
          candidate.endsWith('sw.js') ||
          candidate.endsWith('.webmanifest')
            ? 'no-cache'
            : 'public, max-age=3600',
        'Content-Security-Policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data: blob:; media-src 'self' blob:; object-src blob:; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error: any) {
      if (res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      const message =
        error instanceof ZodError
          ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')
          : error.message;
      const status = error instanceof ZodError ? 400 : error.status || 500;
      const code =
        error instanceof ZodError
          ? 'INVALID_INPUT'
          : error.code ||
            (
              {
                400: 'INVALID_INPUT',
                401: 'UNAUTHORIZED',
                403: 'FORBIDDEN',
                404: 'NOT_FOUND',
                405: 'METHOD_NOT_ALLOWED',
                409: 'CONFLICT',
                413: 'PAYLOAD_TOO_LARGE',
                415: 'UNSUPPORTED_MEDIA_TYPE',
                503: 'UNAVAILABLE',
              } as Record<number, string>
            )[status] ||
            'INTERNAL_ERROR';
      send(
        res,
        { error: message || '操作失败', code, ...(status === 423 ? { session: session.view() } : {}) },
        status,
      );
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = requestUrl(req.url, PORT);
    if (!url) {
      socket.destroy();
      return;
    }
    if (!url.pathname.startsWith('/ws/')) {
      if (!dev) socket.destroy();
      return;
    }
    try {
      session.requireUnlocked();
    } catch {
      socket.end('HTTP/1.1 423 Locked\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const parts = url.pathname.split('/');
    const id = parts[2];
    const mode = parts[3];
    const events = url.pathname === '/ws/events';
    if (
      !allowedRequest(req) ||
      (!events && mode !== 'logs' && machines.incidentLocked(id)) ||
      !equalToken(url.searchParams.get('token')) ||
      (mode === 'desktop' && !features.socketEnabled('desktop')) ||
      (url.searchParams.has('session') && !features.socketEnabled('terminal-session')) ||
      (!events &&
        (parts.length !== 4 || !machines.records.has(id) || !['terminal', 'logs', 'desktop'].includes(mode)))
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head, async (client) => {
      try {
        session.requireUnlocked();
      } catch {
        client.terminate();
        return;
      }
      if (!events) socketVms.set(client, id);
      if (!events && mode !== 'logs' && machines.incidentLocked(id)) {
        client.close(1008, 'Incident lockdown');
        return;
      }
      const sendData = (type: string, data: unknown) => {
        if (client.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount > 1024 * 1024) {
            client.close(1008, 'slow consumer');
            return;
          }
          client.send(JSON.stringify({ type, data }));
        }
      };
      client.on('error', () => {});
      if (mode === 'desktop') {
        try {
          await features.desktops.attach(id, client);
        } catch {
          client.close(1011, 'Desktop unavailable');
        }
        return;
      }
      if (events) {
        const listener = () => sendData('change', null);
        machines.on('change', listener);
        client.on('close', () => machines.off('change', listener));
        listener();
        return;
      }
      if (mode === 'logs') {
        sendData('data', machines.logs.get(id) || '等待 Linux 启动…\r\n');
        const listener = (data: string) => sendData('data', data);
        machines.on(`log:${id}`, listener);
        client.on('close', () => machines.off(`log:${id}`, listener));
        return;
      }
      let ssh: Awaited<ReturnType<typeof machines.connect>> | undefined;
      client.on('close', () => ssh?.end());
      try {
        ssh = await machines.connect(id);
        if (client.readyState !== WebSocket.OPEN) {
          ssh.end();
          return;
        }
        ssh.on('error', (error) => sendData('error', error.message));
        const connected = (error: Error | undefined, stream: ClientChannel) => {
          if (error) {
            sendData('error', error.message);
            client.close();
            ssh?.end();
            return;
          }
          sendData('ready', true);
          const stdout = new StringDecoder('utf8'),
            stderr = new StringDecoder('utf8');
          stream.on('data', (data: Buffer) => sendData('data', stdout.write(data)));
          stream.stderr.on('data', (data: Buffer) => sendData('data', stderr.write(data)));
          stream.on('error', (error: Error) => sendData('error', error.message));
          stream.on('close', () => {
            sendData('exit', true);
            client.close();
            ssh?.end();
          });
          client.on('message', (raw) => {
            try {
              session.requireUnlocked();
              const msg = JSON.parse(raw.toString());
              if (msg.type === 'input' && typeof msg.data === 'string' && msg.data.length <= 32768)
                stream.write(msg.data);
              if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows))
                stream.setWindow(
                  Math.max(2, Math.min(200, msg.rows)),
                  Math.max(10, Math.min(400, msg.cols)),
                  0,
                  0,
                );
            } catch {
              client.close(1008, 'invalid message');
            }
          });
        };
        const terminalSession = url.searchParams.get('session');
        if (terminalSession && /^[a-z0-9-]{1,48}$/.test(terminalSession)) {
          ssh.exec(
            `if command -v tmux >/dev/null; then exec tmux new-session -A -s sakura-terminal-${terminalSession}; else printf '安装项目环境后可恢复终端会话。\\r\\n'; exec /bin/sh -l; fi`,
            { pty: { term: 'xterm-256color', cols: 100, rows: 28 } },
            connected,
          );
        } else ssh.shell({ term: 'xterm-256color', cols: 100, rows: 28 }, connected);
      } catch (error: any) {
        sendData('error', error.message);
        client.close();
        ssh?.end();
      }
    });
  });
  if (dev) {
    const { createServer } = await import('vite');
    vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  }
  server.listen(PORT, '127.0.0.1', () =>
    console.log(`Sakura → http://127.0.0.1:${PORT}\n${engine.version} · PosixLoom Native Host`),
  );
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    console.log('Stopping managed virtual machines…');
    for (const socket of ws.clients) socket.close();
    ws.close();
    server.close();
    let failed = false;
    for (const dispose of [
      () => session.close(),
      () => assistant.close(),
      () => native.close(),
      () => webhooks.close(),
      () => automationRules.close(),
      () => rollouts.close(),
      () => hostPeers.close(),
      () => retention.close(),
      () => graph.close(),
      () => features.close(),
      () => machines.close(),
      () => audit.close(),
      () => vite?.close(),
    ]) {
      try {
        await dispose();
      } catch (error) {
        failed = true;
        console.error('Shutdown cleanup failed:', error);
      }
    }
    process.exit(failed ? 1 : 0);
  }
  process.on('SIGINT', () => void close());
  process.on('SIGTERM', () => void close());
}

void main().catch((error) => {
  console.error('Sakura 启动失败：', error);
  process.exitCode = 1;
});
