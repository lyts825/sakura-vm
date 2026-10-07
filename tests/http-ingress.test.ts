/**
 * 模块职责：回归验证模块，围绕 `http-ingress` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `http-ingress`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: HTTP ingress routes requests, checks health, rejects port collisions and restores saved routes; HTTP ingress forwards WebSocket upgrades and releases the listener on delete.
 */
type GatewayFixtureHost = import('../server/features.ts').Features;
type GatewayFixtureBody = Parameters<GatewayFixtureHost['route']>[3];
const admittedRouteFixtures = new WeakMap<GatewayFixtureHost, {
  gateway: import('../server/operation-gateway.ts').OperationGateway;
  bodies: WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>;
}>();
/** Preserve the fixture's data-directory setup before loading the real operation admission modules. */
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: host: GatewayFixtureHost; req: import('node:http').IncomingMessage; res: import('node:http').ServerResponse; url: URL; body: GatewayFixtureBody。
 * 结果：返回分支计算值（`await fixture.gateway.dispatch(req, res, url) as boolean`），以 Promise 交付。
 * Result: Return the branch-computed value (`await fixture.gateway.dispatch(req, res, url) as boolean`) through a Promise.
 * 状态影响 / State effects: `fixture`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `admittedRouteFixtures.get`, `Promise.all`, `import`, `gateway.register`.
 */
async function routeThroughGateway(host: GatewayFixtureHost, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse, url: URL, body: GatewayFixtureBody) {
  let fixture = admittedRouteFixtures.get(host);
  if (!fixture) {
    const [{ OperationGateway }, { operationEntries }] = await Promise.all([
      import('../server/operation-gateway.ts'), import('../server/operation-catalog.ts'),
    ]);
    const bodies = new WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>();
    const gateway = new OperationGateway({
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`host.enabled`）。
       * Result: Return the branch-computed value (`host.enabled`).
       */
      enabled: () => host.enabled,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: owner。
       * 结果：返回分支计算值（`owner === 'core' ? undefined : host.directory.get('official', owner)`）。
       * Result: Return the branch-computed value (`owner === 'core' ? undefined : host.directory.get('official', owner)`).
       * 协作入口 / Collaborators: `host.directory.get`.
       */
      instance: owner => owner === 'core' ? undefined : host.directory.get('official', owner),
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _request; _url; _entry; _parameters; requireEnabled。
       * 结果：返回受控对象，公开字段包括 `check`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `check`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `requireEnabled`.
       */
      bind: async (_request, _url, _entry, _parameters, requireEnabled) => {
        requireEnabled();
        return { /**
         * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
         * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`'owner'`），以 Promise 交付。
         * Result: Return the branch-computed value (`'owner'`) through a Promise.
         */
        check: async () => 'owner' };
      },
    });
    for (const entry of operationEntries)
      if (entry.declaration.method !== 'UPGRADE')
        gateway.register(entry, (request, response, target) => host.route(request, response, target, bodies.get(request)!));
    gateway.seal();
    fixture = { gateway, bodies };
    admittedRouteFixtures.set(host, fixture);
  }
  fixture.bodies.set(req, body);
  return await fixture.gateway.dispatch(req, res, url) as boolean;
}
import { fakeVmNetwork } from './support/fake-vm-network.ts';
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
import { generate } from 'selfsigned';
import { setTimeout as delay } from 'node:timers/promises';
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

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`address.port`），以 Promise 交付。
 * Result: Return the branch-computed value (`address.port`) through a Promise.
 * 协作入口 / Collaborators: `createServer`, `server.address`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(address && typeof address !== 'string')`.
 */
async function port() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: server: Server。
 * 结果：返回分支计算值（`address.port`），以 Promise 交付。
 * Result: Return the branch-computed value (`address.port`) through a Promise.
 * 协作入口 / Collaborators: `server.address`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(address && typeof address !== 'string')`.
 */
async function serve(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: server: Server。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 */
async function stop(server: Server) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: port: number; path: string; ca: string。
 * 结果：返回分支计算值（`new Promise<{ status: number; body: string }>((resolve, reject) => { const req =…`），以 Promise 交付。
 * Result: Return the branch-computed value (`new Promise<{ status: number; body: string }>((resolve, reject) => { const req =…`) through a Promise.
 */
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

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: port: number; path: string; ca: string; client: { cert: string; key: string }。
 * 结果：返回分支计算值（`new Promise<number>((resolve, reject) => { const req = secureRequest({ hostname:…`），以 Promise 交付。
 * Result: Return the branch-computed value (`new Promise<number>((resolve, reject) => { const req = secureRequest({ hostname:…`) through a Promise.
 */
async function clientGet(port: number, path: string, ca: string, client?: { cert: string; key: string }) {
  return new Promise<number>((resolve, reject) => {
    const req = secureRequest({
      hostname: '127.0.0.1', port, path, ca, rejectUnauthorized: true, agent: false,
      ...(client || {}),
    }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: name: string; ca: { key: string; cert: string }。
 * 结果：返回受控对象，公开字段包括 `cert, key`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `cert, key`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `generate`, `Date.now`.
 */
async function clientCertificate(name: string, ca?: { key: string; cert: string }) {
  const generated = await generate([{ name: 'commonName', value: name }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 3600000),
    notAfterDate: new Date(Date.now() + 86400000),
    ...(ca ? { ca } : {}),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', clientAuth: true },
    ],
  });
  return { cert: generated.cert, key: generated.private };
}

/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: port: number; hostname: string; ca: string。
 * 结果：返回分支计算值（`new Promise<{ status: number; body: string }>((resolve, reject) => { const send …`），以 Promise 交付。
 * Result: Return the branch-computed value (`new Promise<{ status: number; body: string }>((resolve, reject) => { const send …`) through a Promise.
 */
async function hostedGet(port: number, hostname: string, ca?: string) {
  return new Promise<{ status: number; body: string }>(/**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: resolve; reject。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `send`, `req.on`, `req.end`.
   */
  (resolve, reject) => {
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTP ingress routes requests, checks health, rejects port collisions and restores saved routes
 * 状态影响 / State effects: `view`, `restored`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `createServer`, `serve`, `port`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(view.entries.length, 1)`; `assert.equal(response.status, 200)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
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
  const machines = new Machines({} as Engine, fakeVmNetwork);
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
    const hostStatus = await new Promise<number>(/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: resolve; reject。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: HTTP ingress routes requests, checks health, rejects port collisions and restores saved routes
     * 协作入口 / Collaborators: `request`, `attempt.on`, `attempt.end`.
     */
    (resolve, reject) => {
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTP ingress forwards WebSocket upgrades and releases the listener on delete
 * 协作入口 / Collaborators: `createServer`, `wsServer.on`, `serve`, `port`.
 * 检查边界 / Checked boundaries: `assert.equal(await echoed, '/stream')`; `assert.rejects(fetch(`http://127.0.0.1:${listenPort}/`))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HTTP ingress forwards WebSocket upgrades and releases the listener on delete', async () => {
  const upstream = createServer((_req, res) => res.writeHead(200).end('ok'));
  const wsServer = new WebSocketServer({ server: upstream });
  wsServer.on('connection', (socket, req) => socket.on('message', () => socket.send(req.url || '')));
  const upstreamPort = await serve(upstream),
    listenPort = await port();
  const machines = new Machines({} as Engine, fakeVmNetwork),
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTPS ingress routes verified TLS and WebSocket connections through live certificate rotation
 * 状态影响 / State effects: `restored`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `createServer`, `wsServer.on`, `serve`, `port`.
 * 检查边界 / Checked boundaries: `assert.equal(saved.entries[0].url, `https://127.0.0.1:${listenPort}/secure`)`; `assert.ok(first)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
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
  const machines = new Machines({} as Engine, fakeVmNetwork),
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: HTTPS ingress enforces route-specific mTLS for HTTP and WebSocket through scheduled client rotation
 * 状态影响 / State effects: `serverPem`, `restored`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `createServer`, `wsServer.on`, `serve`, `port`.
 * 检查边界 / Checked boundaries: `assert.rejects(ingress.action({ action: 'save', entry: { name: 'Bad', protocol: 'http', listenPort, pathPrefix: '/bad', vmId: id, …`; `assert.rejects(ingress.action({ action: 'save', entry: { name: 'Missing issuer', protocol: 'https', listenPort, pathPrefix: '/inva…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('HTTPS ingress enforces route-specific mTLS for HTTP and WebSocket through scheduled client rotation', async () => {
  const upstream = createServer((_req, res) => res.writeHead(200).end('ok'));
  const wsServer = new WebSocketServer({ server: upstream });
  wsServer.on('connection', (socket) => socket.on('message', () => socket.send('ok')));
  const upstreamPort = await serve(upstream), listenPort = await port();
  const machines = new Machines({} as Engine, fakeVmNetwork), id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'mtls-test', forwards: [{ host: upstreamPort, guest: 8080 }] }),
    id, createdAt: new Date().toISOString(), snapshots: [],
  });
  machines.live.set(id, { status: 'running' } as any);
  const certificates = new IngressCertificates(join(root, 'mtls-server-certificates.json'));
  const file = join(root, 'mtls-ingress.json');
  const ingress = new HttpIngress(machines, file, certificates);
  let restored: InstanceType<typeof HttpIngress> | undefined;
  const issuer = await generate([{ name: 'commonName', value: 'Client issuer' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 3600000),
    notAfterDate: new Date(Date.now() + 86400000),
    extensions: [
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  });
  const current = await clientCertificate('Current client', { key: issuer.private, cert: issuer.cert });
  const replacement = await clientCertificate('Replacement client');
  const outsider = await clientCertificate('Outsider client');
  try {
    await certificates.init();
    await ingress.init();
    await assert.rejects(ingress.action({ action: 'save', entry: {
      name: 'Bad', protocol: 'http', listenPort, pathPrefix: '/bad', vmId: id,
      upstreamPort, healthPath: '/', stripPrefix: false,
      clientAuth: { currentPem: current.cert, currentCaPem: issuer.cert },
    } }), /只能用于 HTTPS/);
    await ingress.action({ action: 'save', entry: {
      name: 'Public', protocol: 'https', listenPort, pathPrefix: '/public', vmId: id,
      upstreamPort, healthPath: '/', stripPrefix: true,
    } });
    await assert.rejects(ingress.action({ action: 'save', entry: {
      name: 'Missing issuer', protocol: 'https', listenPort, pathPrefix: '/invalid', vmId: id,
      upstreamPort, healthPath: '/', stripPrefix: true,
      clientAuth: { currentPem: current.cert },
    } }), /须填写直接签发 CA/);
    const secured = (await ingress.action({ action: 'save', entry: {
      name: 'Private', protocol: 'https', listenPort, pathPrefix: '/private', vmId: id,
      upstreamPort, healthPath: '/', stripPrefix: true,
      clientAuth: { currentPem: current.cert, currentCaPem: issuer.cert },
    } })).entries.find((entry) => entry.name === 'Private')!;
    let serverPem = certificates.view().certificate!.pem;
    assert.equal(await clientGet(listenPort, '/public', serverPem), 200);
    assert.equal(await clientGet(listenPort, '/private', serverPem), 403);
    assert.equal(await clientGet(listenPort, '/private', serverPem, outsider), 403);
    assert.equal(await clientGet(listenPort, '/private', serverPem, current), 200);
    const denied = new WebSocket(`wss://127.0.0.1:${listenPort}/private/ws`, {
      ca: serverPem, rejectUnauthorized: true,
    });
    assert.equal(await new Promise<number>((resolve, reject) => {
      denied.on('unexpected-response', (_req, response) => {
        response.resume();
        resolve(response.statusCode || 0);
      });
      denied.on('error', reject);
    }), 403);
    const socket = new WebSocket(`wss://127.0.0.1:${listenPort}/private/ws`, {
      ca: serverPem, rejectUnauthorized: true, ...current,
    });
    const echoed = new Promise<string>((resolve, reject) => {
      socket.on('open', () => socket.send('ping'));
      socket.on('message', (message) => resolve(String(message)));
      socket.on('error', reject);
    });
    assert.equal(await echoed, 'ok');
    socket.close();
    const rotateAt = new Date(Date.now() + 500).toISOString();
    await ingress.action({ action: 'save', entry: {
      id: secured.id, name: secured.name, protocol: secured.protocol,
      listenPort: secured.listenPort, pathPrefix: secured.pathPrefix, vmId: secured.vmId,
      upstreamPort: secured.upstreamPort, healthPath: secured.healthPath,
      stripPrefix: secured.stripPrefix, clientAuth: {
        currentPem: current.cert, currentCaPem: issuer.cert,
        replacementPem: replacement.cert, rotateAt,
      },
    } });
    assert.equal(await clientGet(listenPort, '/private', serverPem, current), 200);
    assert.equal(await clientGet(listenPort, '/private', serverPem, replacement), 403);
    await delay(Math.max(0, Date.parse(rotateAt) - Date.now()) + 50);
    assert.equal(await clientGet(listenPort, '/private', serverPem, current), 403);
    assert.equal(await clientGet(listenPort, '/private', serverPem, replacement), 200);
    serverPem = (await certificates.action({ action: 'rotate' })).certificate!.pem;
    assert.equal(await clientGet(listenPort, '/private', serverPem, replacement), 200);
    await ingress.close();
    restored = new HttpIngress(machines, file, certificates);
    await restored.init();
    assert.equal(await clientGet(listenPort, '/private', serverPem, replacement), 200);
    assert.equal(await clientGet(listenPort, '/private', serverPem, current), 403);
  } finally {
    await restored?.close();
    await ingress.close();
    await certificates.close();
    await new Promise<void>((resolve) => wsServer.close(() => resolve()));
    await stop(upstream);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: generated local domains isolate same-path virtual hosts and use a verified wildcard certificate
 * 协作入口 / Collaborators: `createServer`, `serve`, `port`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.equal(one.url, `http://${firstAlias}:${httpPort}/`)`; `assert.deepEqual(await hostedGet(httpPort, firstAlias), { status: 200, body: `first:${firstAlias}:${httpPort}`, })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('generated local domains isolate same-path virtual hosts and use a verified wildcard certificate', async () => {
  const first = createServer((req, res) => res.writeHead(200).end(`first:${req.headers['x-forwarded-host']}`));
  const second = createServer((req, res) => res.writeHead(200).end(`second:${req.headers['x-forwarded-host']}`));
  const firstPort = await serve(first), secondPort = await serve(second);
  const httpPort = await port(), httpsPort = await port();
  const machines = new Machines({} as Engine, fakeVmNetwork), id = randomUUID();
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
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: name: string; listenPort: number; upstreamPort: number; protocol: 'http' | 'https'; domainAlias: boolean。
     * 结果：返回分支计算值（`ingress.action({ action: 'save', entry: { name, protocol, domainAlias, listenPor…`）。
     * Result: Return the branch-computed value (`ingress.action({ action: 'save', entry: { name, protocol, domainAlias, listenPor…`).
     * 验证场景 / Scenario: generated local domains isolate same-path virtual hosts and use a verified wildcard certificate
     * 协作入口 / Collaborators: `ingress.action`.
     */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: network plugin exposes typed ingress operations and rejects unknown instances
 * 协作入口 / Collaborators: `import`, `Features.create`, `assert.deepEqual`, `invoke`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(await invoke('GET'), { status: 200, result: { entries: [], listenerErrors: {} } })`; `assert.deepEqual(await invoke('POST', { action: 'check' }), { status: 200, result: { entries: [], listenerErrors: {} }, })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('network plugin exposes typed ingress operations and rejects unknown instances', async () => {
  const { Features } = await import('../server/features.ts');
  const machines = new Machines({} as Engine, fakeVmNetwork);
  const features = await Features.create(machines, ['network']);
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: method: string; input: unknown; path = '/api/ingress'。
   * 结果：返回受控对象，公开字段包括 `status, result`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `status, result`; the actual branch determines its shape.
   * 验证场景 / Scenario: network plugin exposes typed ingress operations and rejects unknown instances
   * 协作入口 / Collaborators: `Object.assign`, `routeThroughGateway`.
   */
  const invoke = async (method: string, input?: unknown, path = '/api/ingress') => {
    let status = 0,
      result: any;
    const req = Object.assign(new EventEmitter(), { method, headers: input === undefined ? {} : { 'content-type': 'application/json' } }) as IncomingMessage;
    const res = Object.assign(new EventEmitter(), {
      writableFinished: false,
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: code: number。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: network plugin exposes typed ingress operations and rejects unknown instances
       * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       */
      writeHead(code: number) {
        status = code;
      },
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: value: string。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: network plugin exposes typed ingress operations and rejects unknown instances
       * 状态影响 / State effects: `result`, `this.writableFinished`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `JSON.parse`.
       */
      end(value: string) {
        result = JSON.parse(value);
        this.writableFinished = true;
      },
    }) as unknown as ServerResponse;
    await routeThroughGateway(features, req, res, new URL(`http://localhost${path}`), async () => input);
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
