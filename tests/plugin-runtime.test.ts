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
  const original = loaders.metrics;
  let valid = false;
  loaders.metrics = async () => {
    const module = await original();
    return {
      ...module,
      activate: async (host) => {
        host.provide('metrics', { close: async () => {} });
      },
      operations: {
        sample: {
          response: z.object({ sample: z.number() }).strict(),
          execute: () => (valid ? { sample: 1 } : { sample: 'broken' }),
        },
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
          this.status = status;
        },
        end(data: string) {
          this.payload = data;
          this.writableFinished = true;
        },
      }) as ServerResponse & { status: number; payload: string };
      await host.route(req, res, new URL('http://127.0.0.1/api/vms/example/metrics'), async () => undefined);
      return res;
    };
    try {
      await assert.rejects(invoke(), (error: any) => error.code === 'INVALID_PLUGIN_RESPONSE');
      valid = true;
      const res = await invoke();
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.payload), { sample: 1 });
    } finally {
      await host.close();
    }
  } finally {
    loaders.metrics = original;
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
        host.provide('sandboxes', { close: async () => {} });
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
    void host!
      .route(req, res, new URL(req.url!, 'http://127.0.0.1'), (request, signal) =>
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
