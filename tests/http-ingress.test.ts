import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { request as secureRequest } from 'node:https';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { Engine } from '../server/runtime.ts';
import { ingressAlias } from '../shared/http-ingress.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-ingress-test-'));
process.env.SAKURA_DATA_DIR = root;
const { HttpIngress } = await import('../server/http-ingress.ts');
const { IngressCertificates } = await import('../server/ingress-certificates.ts');
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

async function secureGet(port: number, path: string, ca: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = secureRequest(
      { hostname: '127.0.0.1', port, path, ca, rejectUnauthorized: true, agent: false },
      async (res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of res) chunks.push(chunk);
        resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function hostedGet(port: number, hostname: string, ca?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const send = ca ? secureRequest : request;
    const req = send(
      {
        hostname: '127.0.0.1',
        servername: ca && hostname !== '127.0.0.1' ? hostname : undefined,
        port,
        path: '/',
        headers: { host: `${hostname}:${port}` },
        ...(ca ? { ca, rejectUnauthorized: true, agent: false } : {}),
      },
      async (res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of res) chunks.push(chunk);
        resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() });
      },
    );
    req.on('error', reject);
    req.end();
  });
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

test('HTTPS ingress routes verified TLS and WebSocket connections through live certificate rotation', async () => {
  const upstream = createServer((req, res) => {
    res.writeHead(200).end(`${req.url}:${req.headers['x-forwarded-proto']}`);
  });
  const wsServer = new WebSocketServer({ server: upstream });
  wsServer.on('connection', (socket, req) =>
    socket.on('message', () => socket.send(`${req.url}:${req.headers['x-forwarded-proto']}`)),
  );
  const upstreamPort = await serve(upstream),
    listenPort = await port();
  const machines = new Machines({} as Engine),
    id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'tls-test', forwards: [{ host: upstreamPort, guest: 8080 }] }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  machines.live.set(id, { status: 'running' } as any);
  const certificates = new IngressCertificates(join(root, 'https-certificates.json'));
  const file = join(root, 'https-ingress.json');
  const ingress = new HttpIngress(machines, file, certificates);
  let restored: InstanceType<typeof HttpIngress> | undefined;
  try {
    await certificates.init();
    await ingress.init();
    const saved = await ingress.action({
      action: 'save',
      entry: {
        name: 'Secure', protocol: 'https', listenPort, pathPrefix: '/secure', vmId: id,
        upstreamPort, healthPath: '/', stripPrefix: true,
      },
    });
    assert.equal(saved.entries[0].url, `https://127.0.0.1:${listenPort}/secure`);
    const first = certificates.view().certificate;
    assert.ok(first);
    assert.deepEqual(await secureGet(listenPort, '/secure/item?q=1', first.pem), {
      status: 200, body: '/item?q=1:https',
    });
    const socket = new WebSocket(`wss://127.0.0.1:${listenPort}/secure/stream`, {
      ca: first.pem, rejectUnauthorized: true,
    });
    const echoed = new Promise<string>((resolve, reject) => {
      socket.on('open', () => socket.send('ping'));
      socket.on('message', (message) => resolve(String(message)));
      socket.on('error', reject);
    });
    assert.equal(await echoed, '/stream:https');
    socket.close();
    await assert.rejects(ingress.action({
      action: 'save',
      entry: { name: 'Plain', protocol: 'http', listenPort, pathPrefix: '/plain', vmId: id,
        upstreamPort, healthPath: '/', stripPrefix: true },
    }), /同一端口不能混用/);
    const rotated = certificates.view().certificate;
    assert.ok(rotated);
    const second = (await certificates.action({ action: 'rotate' })).certificate;
    assert.ok(second);
    assert.notEqual(second.fingerprint256, rotated.fingerprint256);
    assert.equal((await secureGet(listenPort, '/secure', second.pem)).body, '/:https');
    await assert.rejects(secureGet(listenPort, '/secure', first.pem));
    await ingress.close();
    restored = new HttpIngress(machines, file, certificates);
    await restored.init();
    assert.equal((await secureGet(listenPort, '/secure/restored', second.pem)).body, '/restored:https');
    await restored.action({ action: 'delete', id: saved.entries[0].id });
    await assert.rejects(secureGet(listenPort, '/secure', second.pem));
  } finally {
    await restored?.close();
    await ingress.close();
    await certificates.close();
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    await stop(upstream);
  }
});

test('generated local domains isolate same-path virtual hosts and use a verified wildcard certificate', async () => {
  const first = createServer((req, res) => res.writeHead(200).end(`first:${req.headers['x-forwarded-host']}`));
  const second = createServer((req, res) => res.writeHead(200).end(`second:${req.headers['x-forwarded-host']}`));
  const firstPort = await serve(first), secondPort = await serve(second);
  const httpPort = await port(), httpsPort = await port();
  const machines = new Machines({} as Engine), id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'aliases', forwards: [
      { host: firstPort, guest: 80 }, { host: secondPort, guest: 81 },
    ] }),
    id, createdAt: new Date().toISOString(), snapshots: [],
  });
  machines.live.set(id, { status: 'running' } as any);
  const certificates = new IngressCertificates(join(root, 'alias-certificates.json'));
  const ingress = new HttpIngress(machines, join(root, 'aliases.json'), certificates);
  try {
    await certificates.init();
    await ingress.init();
    const save = (name: string, listenPort: number, upstreamPort: number, protocol: 'http' | 'https', domainAlias: boolean) =>
      ingress.action({ action: 'save', entry: {
        name, protocol, domainAlias, listenPort, pathPrefix: '/', vmId: id,
        upstreamPort, healthPath: '/', stripPrefix: false,
      } });
    const one = (await save('One', httpPort, firstPort, 'http', true)).entries[0];
    const two = (await save('Two', httpPort, secondPort, 'http', true)).entries.find((entry) => entry.name === 'Two')!;
    const firstAlias = ingressAlias(one.id), secondAlias = ingressAlias(two.id);
    assert.equal(one.url, `http://${firstAlias}:${httpPort}/`);
    assert.deepEqual(await hostedGet(httpPort, firstAlias), {
      status: 200, body: `first:${firstAlias}:${httpPort}`,
    });
    assert.deepEqual(await hostedGet(httpPort, secondAlias), {
      status: 200, body: `second:${secondAlias}:${httpPort}`,
    });
    assert.equal((await hostedGet(httpPort, '127.0.0.1')).status, 404);
    assert.equal((await hostedGet(httpPort, 'unregistered.sakura.localhost')).status, 403);
    await save('Loopback', httpPort, firstPort, 'http', false);
    assert.equal((await hostedGet(httpPort, '127.0.0.1')).status, 200);
    const secure = (await save('Secure', httpsPort, firstPort, 'https', true)).entries.find((entry) => entry.name === 'Secure')!;
    const certificate = certificates.view().certificate;
    assert.ok(certificate);
    const secureAlias = ingressAlias(secure.id);
    assert.equal(secure.url, `https://${secureAlias}:${httpsPort}/`);
    assert.deepEqual(new Set(ingress.aliasNames()),
      new Set([firstAlias, secondAlias, secureAlias]));
    assert.deepEqual(await hostedGet(httpsPort, secureAlias, certificate.pem), {
      status: 200, body: `first:${secureAlias}:${httpsPort}`,
    });
    assert.equal((await hostedGet(httpsPort, '127.0.0.1', certificate.pem)).status, 404);
  } finally {
    await ingress.close();
    await certificates.close();
    await stop(second);
    await stop(first);
  }
});

test('network plugin exposes typed ingress operations and rejects unknown instances', async () => {
  const { Features } = await import('../server/features.ts');
  const machines = new Machines({} as Engine);
  const features = await Features.create(machines, ['network']);
  const invoke = async (method: string, input?: unknown, path = '/api/ingress') => {
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
    await features.route(req, res, new URL(`http://localhost${path}`), async () => input);
    return { status, result };
  };
  try {
    assert.deepEqual(await invoke('GET'), { status: 200, result: { entries: [], listenerErrors: {} } });
    assert.deepEqual(await invoke('POST', { action: 'check' }), {
      status: 200,
      result: { entries: [], listenerErrors: {} },
    });
    const initialCertificate = await invoke('GET', undefined, '/api/ingress-certificate');
    assert.equal(initialCertificate.status, 200);
    assert.equal(initialCertificate.result.certificate, null);
    const issuedCertificate = await invoke('POST', { action: 'rotate' }, '/api/ingress-certificate');
    assert.equal(issuedCertificate.status, 200);
    assert.match(issuedCertificate.result.certificate.pem, /BEGIN CERTIFICATE/);
    assert.ok(!JSON.stringify(issuedCertificate.result).includes('PRIVATE KEY'));
    const configuredCertificate = await invoke('POST', {
      action: 'configure', policy: { autoRotate: false, renewBeforeDays: 14 },
    }, '/api/ingress-certificate');
    assert.equal(configuredCertificate.result.nextRotationAt, null);
    assert.deepEqual(configuredCertificate.result.policy, { autoRotate: false, renewBeforeDays: 14 });
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
