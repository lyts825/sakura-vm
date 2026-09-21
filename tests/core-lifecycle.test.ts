import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-core-lifecycle-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-core-lifecycle-'));
  await rm(root, { recursive: true, force: true });
});

async function fixture(t: TestContext) {
  const events: string[] = [];
  let finish!: () => void;
  const engine = {
    whpxAvailable: false,
    runtime: { close: async () => void events.push('close') },
    run: async (_tool, _args, options = {}) => {
      events.push('launch');
      await new Promise<void>((resolve) => {
        finish = resolve;
        if (options.signal?.aborted) resolve();
        else options.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      events.push('exit');
      return '';
    },
  } as Engine;
  const machines = new Machines(engine);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'lifecycle-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id));
  machines.exec = async (_id, command) => {
    if (command.includes('poweroff')) finish();
    return { stdout: '', stderr: '', code: 0 };
  };
  t.after(async () => {
    const running = [...machines.live.values()];
    for (const live of running) live.abort.abort();
    await Promise.allSettled(running.map((live) => live.done));
    await machines.close();
  });
  return { machines, id, events, finish: () => finish() };
}

test('closing waits for an admitted launch before releasing the runtime', async (t) => {
  const { machines, id, events } = await fixture(t);
  const starting = machines.start(id);
  const closing = machines.close();
  await Promise.all([starting, closing]);
  assert.deepEqual(events, ['launch', 'exit', 'close']);
  assert.equal(machines.live.size, 0);
  await assert.rejects(machines.start(id), /关闭/);
});

test('closing waits for existing disk operations and rejects new work', async (t) => {
  const { machines, events } = await fixture(t);
  let release!: () => void;
  const pending = machines.locked('disk-operation', async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    events.push('disk-complete');
  });
  const closing = machines.close();
  await assert.rejects(
    machines.locked('other-operation', async () => {}),
    /关闭/,
  );
  release();
  await Promise.all([pending, closing]);
  assert.deepEqual(events, ['disk-complete', 'close']);
});

test('failed startup persistence does not leave an unkillable powered-on instance', async (t) => {
  const { machines, id, events } = await fixture(t);
  machines.get(id).lastError = 'previous boot failure';
  const temporary = join(root, 'machines.json.tmp');
  await mkdir(temporary);
  try {
    await assert.rejects(machines.start(id));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  assert.deepEqual(events, []);
  assert.equal(machines.live.has(id), false);
  assert.equal(machines.state(id), 'error');
  assert.equal(machines.get(id).lastError, 'previous boot failure');
});

test('a persistence failure after process exit still completes cleanup and emits state', async (t) => {
  const { machines, id, finish } = await fixture(t);
  await machines.start(id);
  const live = machines.live.get(id)!;
  let changed = false;
  machines.once('change', () => {
    changed = true;
  });
  const temporary = join(root, 'machines.json.tmp');
  await mkdir(temporary);
  try {
    const done = assert.doesNotReject(live.done);
    finish();
    await done;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  assert.equal(machines.live.has(id), false);
  assert.equal(changed, true);
  assert.match(machines.logs.get(id) || '', /保存/);
});
