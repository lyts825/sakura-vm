import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { PluginContext } from '../server/plugin-api.ts';
import { route } from '../plugins/runtimes/server.ts';

function response() {
  return Object.assign(new EventEmitter(), {
    status: 0, payload: null as unknown,
    writeHead(status: number) { this.status = status; },
    end(value: string) { this.payload = JSON.parse(value); },
  }) as unknown as ServerResponse & { status: number; payload: unknown };
}

test('runtime install route forwards only its strict installation body and rejects extra probe fields', async () => {
  const schema = z.object({ tool: z.enum(['node', 'python']), version: z.string() }).strict();
  const installed: unknown[] = [], host = {
    machines: { get: () => ({}) },
    runtimes: { install: async (_id: string, input: unknown) => { installed.push(schema.parse(input)); return { status: 'running' }; } },
  } as unknown as PluginContext;
  const req = Object.assign(new EventEmitter(), { method: 'POST' }) as IncomingMessage;
  const url = new URL('http://localhost/api/vms/vm/runtimes'), res = response();
  assert.equal(await route.call(host, req, res, url, async () => ({ action: 'install', tool: 'python', version: '3.12.0' }), new AbortController().signal), true);
  assert.equal(res.status, 202);
  assert.deepEqual(installed, [{ tool: 'python', version: '3.12.0' }]);
  await assert.rejects(route.call(host, req, response(), url, async () => ({ action: 'probe', tool: 'node' }), new AbortController().signal), z.ZodError);
  assert.equal(installed.length, 1);
});

for (const action of ['probe', 'select'] as const) {
  test(`runtime ${action} route passes request cancellation into the operation without reporting success`, async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const wait = async (_id: string, inputOrSignal: unknown, optionalSignal?: AbortSignal) => {
      const signal = action === 'probe' ? inputOrSignal as AbortSignal : optionalSignal!;
      if (action === 'select') assert.deepEqual(inputOrSignal, {});
      assert.equal(signal, controller.signal); entered();
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return { unexpected: 'success' };
    };
    const host = { machines: { get: () => ({}) }, runtimes: { [action]: wait } } as unknown as PluginContext;
    const req = Object.assign(new EventEmitter(), { method: 'POST' }) as IncomingMessage, res = response();
    const pending = route.call(host, req, res, new URL('http://localhost/api/vms/vm/runtimes'), async () => ({ action }), controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await ready; controller.abort(); await rejected;
    assert.equal(res.status, 0); assert.equal(res.payload, null);
  });
}

test('runtime CLI inspect only reads the sample while probe makes one explicit authenticated request', async () => {
  const calls: { method: string; body: unknown }[] = [], failures: string[] = [];
  const sample = { actual: {}, declared: {}, selected: {}, mismatches: [], job: null,
    probe: { state: 'unprobed', checkedAt: null, configVersion: null, bootId: null } };
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers['x-sakura-token'], 'a'.repeat(64));
      let data = '';
      for await (const chunk of req) data += chunk;
      if (req.url === '/api/vms') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify([{ id: 'vm', name: 'runtime-fixture' }]));
      }
      assert.equal(req.url, '/api/vms/vm/runtimes');
      calls.push({ method: req.method!, body: data ? JSON.parse(data) : null });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(sample));
    } catch (error) {
      failures.push(String(error)); res.writeHead(500); res.end(JSON.stringify({ error: 'fixture failed' }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = { ...process.env, SAKURA_TOKEN: 'a'.repeat(64), SAKURA_PORT: String((server.address() as { port: number }).port) };
    for (const action of ['inspect', 'probe']) {
      const result = await promisify(execFile)(process.execPath,
        [resolve('scripts/cli.mjs'), 'runtimes', 'runtime-fixture', action], { env, timeout: 10000, windowsHide: true });
      assert.deepEqual(JSON.parse(result.stdout), sample);
    }
    assert.deepEqual(calls, [{ method: 'GET', body: null }, { method: 'POST', body: { action: 'probe' } }]);
    assert.deepEqual(failures, []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
