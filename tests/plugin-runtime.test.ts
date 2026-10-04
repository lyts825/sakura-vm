import { services as sandboxesContract } from '../plugins/sandbox/services.ts';
type GatewayFixtureHost = import('../server/features.ts').Features;
type GatewayFixtureBody = Parameters<GatewayFixtureHost['route']>[3];
const admittedRouteFixtures = new WeakMap<GatewayFixtureHost, {
  gateway: import('../server/operation-gateway.ts').OperationGateway;
  bodies: WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>;
}>();
/** Preserve the fixture's data-directory setup before loading the real operation admission modules. */
async function routeThroughGateway(host: GatewayFixtureHost, req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse, url: URL, body: GatewayFixtureBody) {
  let fixture = admittedRouteFixtures.get(host);
  if (!fixture) {
    const [{ OperationGateway }, { operationEntries }] = await Promise.all([
      import('../server/operation-gateway.ts'), import('../server/operation-catalog.ts'),
    ]);
    const bodies = new WeakMap<import('node:http').IncomingMessage, GatewayFixtureBody>();
    const gateway = new OperationGateway({
      enabled: () => host.enabled,
      instance: owner => owner === 'core' ? undefined : host.directory.get('official', owner),
      bind: async (_request, _url, _entry, _parameters, requireEnabled) => {
        requireEnabled();
        return { check: async () => 'owner' };
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
import { services as metricsContract } from '../plugins/metrics/services.ts';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import test from 'node:test';
import { z } from 'zod';
import { Features } from '../server/features.ts';
import { readJsonBody } from '../server/http.ts';
import type { Machines } from '../server/machines.ts';
import { PluginScope, withinDeadline } from '../server/plugin-scope.ts';
import { loaders } from '../server/plugins/registry.ts';
import { migratePlugins } from '../shared/plugin-selection.ts';
import { featureReadiness } from '../src/feature-readiness.ts';
import { parseMetrics } from '../server/metrics.ts';
import { pluginRouteResponses } from '../shared/contracts/plugin-route-responses.ts';
import type { PluginOperation } from '../server/plugin-api.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { OperationResults } from '../server/operation-results.ts';

test('plugin activation timeout aborts registration and cleanup is bounded', async () => {
  const scope = new PluginScope();
  const order: string[] = [];
  scope.add(() => {
    order.push('first');
  });
  scope.add(() => {
    order.push('second');
  });
  await assert.rejects(
    withinDeadline(new Promise<void>(() => {}), 20, 'test', () => scope.abort()),
    /超过/,
  );
  assert.equal(scope.signal.aborted, true);
  assert.throws(() => scope.add(() => {}));
  await scope.dispose((dispose) => Promise.resolve(dispose()));
  assert.deepEqual(order, ['second', 'first']);
});

test('declared operations validate responses before writing to the client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-plugin-receipt-'));
  const original = loaders.metrics;
  const sample = parseMetrics('CPU\ncpu 10 0 10 100 0 0 0 0\ncpu 30 0 20 150 20 0 0 0\nMEMORY\nMemTotal: 1024 kB\nMemAvailable: 512 kB\nDISK\n/dev/vda1 1000 400 600 40% /\nNETWORK\n eth0: 10 0 0 0 0 0 0 0 20 0 0 0 0 0 0 0\nPROCESSES\n123 python3\nUPTIME\n120.5 10.0\n');
  let valid = false;
  let operation!: PluginOperation;
  const written: unknown[] = [];
  loaders.metrics = async () => {
    const module = await original();
    operation = {
      response: module.operations!.sample.response,
      execute: () => valid ? sample : { ...sample, cpuPercent: 'broken' },
    };
    assert.equal(operation.response, pluginRouteResponses['metrics.sample'].schema);
    return {
      ...module,
      activate: async (host) => {
        host.provide(metricsContract.metrics, { sample: async () => sample, forget: () => {}, close: async () => {} } as any);
      },
      operations: {
        sample: operation,
      },
    };
  };
  const machines = Object.assign(new EventEmitter(), {
    records: new Map(),
    get: () => ({}),
  }) as unknown as Machines;
  try {
    const host = await Features.create(machines, ['metrics']);
    assert.deepEqual(host.errors, {});
    const invoke = async () => {
      const req = Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) as IncomingMessage;
      const res = Object.assign(new EventEmitter(), {
        writableFinished: false,
        status: 0,
        payload: '',
        writeHead(status: number) {
          written.push(status);
          this.status = status;
        },
        end(data: string) {
          written.push(data);
          this.payload = data;
          this.writableFinished = true;
        },
      }) as ServerResponse & { status: number; payload: string };
      await routeThroughGateway(host, req, res, new URL('http://127.0.0.1/api/vms/example/metrics'), async () => undefined);
      return res;
    };
    try {
      const results = new OperationResults(directory), receipt = await results.start(randomUUID(), 'metrics.sample', 'local-owner');
      let failure: unknown;
      try { await results.run(receipt, async () => { await results.begin(receipt); await invoke(); }); }
      catch (error) { failure = error; }
      assert.equal((failure as any).code, 'INVALID_PLUGIN_RESPONSE');
      await results.finish(receipt, failure, false);
      assert.equal((await new OperationResults(directory).get(receipt.correlationId, 'local-owner')).outcome, 'succeeded');
      assert.deepEqual(written, []);
      // A handler's local validator cannot replace the independently published response contract.
      operation.response = z.object({ sample: z.number() }).strict();
      operation.execute = () => ({ sample: 1 });
      await assert.rejects(invoke(), (error: any) => error.code === 'INVALID_OPERATION_RESPONSE');
      assert.deepEqual(written, []);
      operation.response = pluginRouteResponses['metrics.sample'].schema;
      operation.execute = () => valid ? sample : { ...sample, cpuPercent: 'broken' };
      valid = true;
      const res = await invoke();
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.payload), sample);
    } finally {
      await host.close();
    }
  } finally {
    loaders.metrics = original;
    await rm(directory, { recursive: true, force: true });
  }
});

test('older automation selection preserves its scheduled worker and readiness distinguishes records', () => {
  const migrated = migratePlugins({ schemaVersion: 2, plugins: ['automation'], packs: [] });
  assert.deepEqual(migrated.selection.plugins, ['automation', 'automation-scheduler']);
  assert.equal(featureReadiness(undefined, 'x').label, '待检查');
  assert.equal(featureReadiness([{ featureId: 'x', ready: false, executed: true }], 'x').label, '仅本地记录');
  assert.equal(featureReadiness([{ featureId: 'x', ready: false, executed: false }], 'x').label, '不可用');
  assert.equal(featureReadiness([{ featureId: 'x', ready: true, executed: true }], 'x').label, '可用');
  assert.equal(
    featureReadiness([{ featureId: 'x', ready: false, executed: true, result: { code: 7 } }], 'x').label,
    '执行失败',
  );
  assert.equal(
    featureReadiness([{ featureId: 'x', ready: true, executed: false }], 'x').label,
    '前置条件通过',
  );
});

test('bodyless declared DELETE works without a JSON header while write schemas remain enforced', async () => {
  const original = loaders.sandbox;
  let destroyed = 0;
  loaders.sandbox = async () => {
    const module = await original();
    return {
      ...module,
      activate: async (host) => {
        host.provide(sandboxesContract.sandboxes, {
          ...Object.fromEntries(sandboxesContract.sandboxes.contract!.members.map((key) => [key, () => undefined])),
          jobs: { list: () => [], close: async () => {} },
          close: async () => {},
        } as any);
      },
      operations: {
        ...module.operations,
        destroy: {
          response: z.object({ ok: z.literal(true) }),
          execute(_url, input) {
            assert.equal(input, undefined);
            destroyed++;
            return { ok: true };
          },
        },
      },
    };
  };
  const machines = Object.assign(new EventEmitter(), { records: new Map() }) as unknown as Machines;
  let host: Features | undefined;
  const server = createServer((req, res) => {
    void routeThroughGateway(host!, req, res, new URL(req.url!, 'http://127.0.0.1'), (request, signal) =>
        readJsonBody(request, undefined, signal),
      )
      .catch((error) => {
        res.writeHead(error.status || 400);
        res.end();
      });
  });
  try {
    host = await Features.create(machines, ['sandbox']);
    assert.deepEqual(host.errors, {});
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const deleted = await fetch(origin + '/api/vms/example/sandbox', { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true });
    assert.equal(destroyed, 1);
    assert.equal((await fetch(origin + '/api/sandboxes', { method: 'POST' })).status, 415);
    assert.equal(
      (
        await fetch(origin + '/api/sandboxes', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"name":0}',
        })
      ).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await host?.close();
    loaders.sandbox = original;
  }
});
