import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Machines } from '../server/machines.ts';
import { Features } from '../server/features.ts';
import { loaders } from '../server/plugins/registry.ts';
import { PluginScope, withinDeadline } from '../server/plugin-scope.ts';
import { featureReadiness } from '../src/feature-readiness.ts';
import { migratePlugins } from '../shared/plugin-selection.ts';

test('plugin activation timeout aborts registration and cleanup is bounded', async () => {
  const scope = new PluginScope();
  const order: string[] = [];
  scope.add(() => { order.push('first'); });
  scope.add(() => { order.push('second'); });
  await assert.rejects(withinDeadline(new Promise<void>(() => {}), 20, 'test', () => scope.abort()), /超过/);
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
      activate: async (host) => { host.provide('metrics', { close: async () => {} }); },
      operations: {
        sample: {
          response: z.object({ sample: z.number() }).strict(),
          execute: () => valid ? { sample: 1 } : { sample: 'broken' },
        },
      },
    };
  };
  const machines = Object.assign(new EventEmitter(), { records: new Map(), get: () => ({}) }) as unknown as Machines;
  try {
    const host = await Features.create(machines, ['metrics']);
    assert.deepEqual(host.errors, {});
    const invoke = async () => {
      const req = Object.assign(new EventEmitter(), { method: 'GET', headers: {} }) as IncomingMessage;
      const res = Object.assign(new EventEmitter(), {
        writableFinished: false, status: 0, payload: '',
        writeHead(status: number) { this.status = status; },
        end(data: string) { this.payload = data; this.writableFinished = true; },
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
});
