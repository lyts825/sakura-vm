import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ingress-test-'));
process.env.SAKURA_DATA_DIR = root;
const { HttpIngress } = await import('../server/http-ingress.ts');
const { Machines } = await import('../server/machines.ts');
const { createSchema } = await import('../server/model.ts');
after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function port() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function serve(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function stop(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

test('HTTP ingress routes requests, checks health, rejects port collisions and restores saved routes', async () => {
  const paths: string[] = [];
  const first = createServer((req, res) => {
    paths.push(req.url || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, forwarded: req.headers['x-forwarded-host'] }));
  });
  const second = createServer((req, res) => res.writeHead(200).end(`second:${req.url}`));
  const firstPort = await serve(first),
    secondPort = await serve(second),
    listenPort = await port(),
    occupied = await port();
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(occupied, '127.0.0.1', resolve));
  const machines = new Machines({} as Engine);
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({
      name: 'ingress-test',
      forwards: [
        { host: firstPort, guest: 80 },
        { host: secondPort, guest: 81 },
      ],
    }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  machines.live.set(id, { status: 'running' } as any);
  const file = join(root, 'ingress.json');
  const ingress = new HttpIngress(machines, file);
  let restored: InstanceType<typeof HttpIngress> | undefined;
  try {
    await ingress.init();
    let view = await ingress.action({
      action: 'save',
      entry: {
        name: 'App',
        listenPort,
        pathPrefix: '/app',
        vmId: id,
        upstreamPort: firstPort,
        healthPath: '/health',
        stripPrefix: true,
      },
    });
    assert.equal(view.entries.length, 1);
    const appId = view.entries[0].id;
    const response = await fetch(`http://127.0.0.1:${listenPort}/app/item?q=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      path: '/item?q=1',
      forwarded: `127.0.0.1:${listenPort}`,
    });
    assert.equal((await fetch(`http://127.0.0.1:${listenPort}/apple`)).status, 404);
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${listenPort}/app`, {
          headers: { origin: 'https://outside.example' },
        })
      ).status,
      403,
    );
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const attempt = request(
        {
          hostname: '127.0.0.1',
          port: listenPort,
          path: '/app',
          headers: { host: `outside.example:${listenPort}` },
        },
        (result) => {
          result.resume();
          resolve(result.statusCode || 0);
        },
      );
      attempt.on('error', reject);
      attempt.end();
    });
    assert.equal(hostStatus, 403);
    view = await ingress.action({
      action: 'save',
      entry: {
        name: 'API',
        listenPort,
        pathPrefix: '/app/api',
        vmId: id,
        upstreamPort: secondPort,
        healthPath: '/health',
        stripPrefix: true,
      },
    });
    assert.equal(await (await fetch(`http://127.0.0.1:${listenPort}/app/api/users`)).text(), 'second:/users');
    assert.equal(
      await (await fetch(`http://127.0.0.1:${listenPort}/app/page`)).json().then((data) => data.path),
      '/page',
    );
    view = await ingress.action({ action: 'check', id: appId });
    assert.equal(view.entries.find((entry) => entry.id === appId)?.health.status, 'healthy');
    assert.ok(paths.includes('/health'));
    await assert.rejects(
      ingress.action({
        action: 'save',
        entry: {
          name: 'collision',
          listenPort: firstPort,
          pathPrefix: '/',
          vmId: id,
          upstreamPort: secondPort,
          healthPath: '/',
          stripPrefix: false,
        },
      }),
      /已被实例转发使用/,
    );
    await assert.rejects(
      ingress.action({
        action: 'save',
        entry: {
          name: 'occupied',
          listenPort: occupied,
          pathPrefix: '/',
          vmId: id,
          upstreamPort: firstPort,
          healthPath: '/',
          stripPrefix: false,
        },
      }),
      /EADDRINUSE/,
    );
    assert.equal(ingress.view().entries.length, 2);
    machines.live.delete(id);
    assert.equal((await fetch(`http://127.0.0.1:${listenPort}/app`)).status, 503);
    await assert.rejects(machines.setForwards(id, [{ host: listenPort, guest: 80 }]), /宿主服务保留/);
    machines.live.set(id, { status: 'running' } as any);
    await ingress.close();
    restored = new HttpIngress(machines, file);
    await restored.init();
    assert.equal((await fetch(`http://127.0.0.1:${listenPort}/app/api`)).status, 200);
    await restored.action({ action: 'delete', id: appId });
    assert.equal((await fetch(`http://127.0.0.1:${listenPort}/app/page`)).status, 404);
    assert.equal(restored.view().entries.length, 1);
  } finally {
    await restored?.close();
    await ingress.close();
    await stop(blocker);
    await stop(second);
    await stop(first);
  }
});

test('HTTP ingress forwards WebSocket upgrades and releases the listener on delete', async () => {
  const upstream = createServer((_req, res) => res.writeHead(200).end('ok'));
  const wsServer = new WebSocketServer({ server: upstream });
  wsServer.on('connection', (socket, req) => socket.on('message', () => socket.send(req.url || '')));
  const upstreamPort = await serve(upstream),
    listenPort = await port();
  const machines = new Machines({} as Engine),
    id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'ws-test', forwards: [{ host: upstreamPort, guest: 8080 }] }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  machines.live.set(id, { status: 'running' } as any);
  const ingress = new HttpIngress(machines, join(root, 'websocket.json'));
  try {
    await ingress.init();
    const view = await ingress.action({
      action: 'save',
      entry: {
        name: 'socket',
        listenPort,
        pathPrefix: '/socket',
        vmId: id,
        upstreamPort,
        healthPath: '/',
        stripPrefix: true,
      },
    });
    const socket = new WebSocket(`ws://127.0.0.1:${listenPort}/socket/stream`);
    const echoed = new Promise<string>((resolve, reject) => {
      socket.on('open', () => socket.send('ping'));
      socket.on('message', (message) => resolve(String(message)));
      socket.on('error', reject);
    });
    assert.equal(await echoed, '/stream');
    socket.close();
    await ingress.action({ action: 'delete', id: view.entries[0].id });
    await assert.rejects(fetch(`http://127.0.0.1:${listenPort}/`));
  } finally {
    await ingress.close();
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    await stop(upstream);
  }
});

test('network plugin exposes typed ingress operations and rejects unknown instances', async () => {
  const { Features } = await import('../server/features.ts');
  const machines = new Machines({} as Engine);
  const features = await Features.create(machines, ['network']);
  const invoke = async (method: string, input?: unknown) => {
    let status = 0,
      result: any;
    const req = Object.assign(new EventEmitter(), { method, headers: {} }) as IncomingMessage;
    const res = Object.assign(new EventEmitter(), {
      writableFinished: false,
      writeHead(code: number) {
        status = code;
      },
      end(value: string) {
        result = JSON.parse(value);
        this.writableFinished = true;
      },
    }) as unknown as ServerResponse;
    await features.route(req, res, new URL('http://localhost/api/ingress'), async () => input);
    return { status, result };
  };
  try {
    assert.deepEqual(await invoke('GET'), { status: 200, result: { entries: [], listenerErrors: {} } });
    assert.deepEqual(await invoke('POST', { action: 'check' }), {
      status: 200,
      result: { entries: [], listenerErrors: {} },
    });
    await assert.rejects(
      invoke('POST', {
        action: 'save',
        entry: {
          name: 'Missing',
          listenPort: 8888,
          pathPrefix: '/',
          vmId: randomUUID(),
          upstreamPort: 8080,
          healthPath: '/',
          stripPrefix: false,
        },
      }),
      /发行版不存在/,
    );
  } finally {
    await features.close();
  }
});
