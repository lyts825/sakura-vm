import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs, { mkdtemp, mkdir, rm, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-core-lifecycle-'));
const originalWriteFile = fs.writeFile, originalRename = fs.rename;
const machineFile = join(root, 'machines.json');
const machineTemporary = (path: unknown) => typeof path === 'string' && dirname(path) === root
  && /^machines\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i.test(basename(path));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.equal(await realpath(root), root);
  assert.equal((await lstat(root)).isSymbolicLink(), false);
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

test('boot circuit persists failed launches across controller restarts and explicitly resets', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = async () => {
    throw new Error('SSH unavailable');
  };
  machines.engine.run = async () => {
    throw new Error('QEMU failed');
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    await machines.start(id);
    await machines.live.get(id)?.done;
  }
  assert.equal((await machines.bootGuard(id)).blocked, true);
  const reloaded = new Machines(machines.engine);
  await reloaded.init();
  t.after(() => reloaded.close());
  assert.equal((await reloaded.bootGuard(id)).failures, 5);
  await assert.rejects(reloaded.start(id), { code: 'BOOT_CIRCUIT_OPEN' });
  await reloaded.bootGuard(id, true);
  assert.equal((await reloaded.bootGuard(id)).blocked, false);
  await reloaded.start(id);
  await reloaded.live.get(id)?.done;
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
  const old = JSON.stringify([...machines.records.values()], null, 2);
  const neighbor = join(root, `lifecycle-neighbor-${id}.tmp`), sentinel = 'another owned file';
  await writeFile(machineFile, old);
  await writeFile(neighbor, sentinel);
  const failure = Object.assign(new Error('owned startup machine-list write failure'), { code: 'EIO' });
  let writes = 0, temporary: string | undefined;
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      if (machineTemporary(args[0])) {
        ++writes;
        temporary = String(args[0]);
        assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
        assert.equal(JSON.parse(String(args[1])).find((record: { id: string }) => record.id === id).lastError, undefined);
        throw failure;
      }
      return originalWriteFile(...args);
    });
    syncBuiltinESMExports();
    await assert.rejects(machines.start(id), error => error === failure);
    assert.equal(writes, 1, 'non-retry EIO is injected once into this exact machine-list write');
    assert.ok(temporary && machineTemporary(temporary));
    await assert.rejects(lstat(temporary), { code: 'ENOENT' });
    assert.equal(await readFile(machineFile, 'utf8'), old);
    assert.equal(await readFile(neighbor, 'utf8'), sentinel);
    assert.deepEqual(events, []);
    assert.equal(machines.live.has(id), false);
    assert.equal(machines.state(id), 'error');
    assert.equal(machines.get(id).lastError, 'previous boot failure');
    t.diagnostic(JSON.stringify({ ownedFailure: failure.message, code: failure.code, injectedWrites: writes,
      temporaryCleaned: true, oldSha256: createHash('sha256').update(old).digest('hex'), neighborUnchanged: true }));
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});

test('a persistence failure after process exit still completes cleanup and emits state', async (t) => {
  const { machines, id, finish, events } = await fixture(t);
  await machines.start(id);
  const live = machines.live.get(id)!;
  let changed = false;
  machines.once('change', () => {
    changed = true;
  });
  const old = await readFile(machineFile, 'utf8');
  const neighbor = join(root, `lifecycle-neighbor-${id}.tmp`), sentinel = 'another owned file';
  await writeFile(neighbor, sentinel);
  const failure = Object.assign(new Error('owned exited machine-list publication failure'), { code: 'EIO' });
  let publications = 0, temporary: string | undefined;
  try {
    t.mock.method(fs, 'rename', async (source: Parameters<typeof fs.rename>[0], destination: Parameters<typeof fs.rename>[1]) => {
      if (destination === machineFile && machineTemporary(source)) {
        ++publications;
        temporary = String(source);
        assert.ok(JSON.parse(await readFile(temporary, 'utf8')).some((record: { id: string }) => record.id === id));
        throw failure;
      }
      return originalRename(source, destination);
    });
    syncBuiltinESMExports();
    const done = assert.doesNotReject(live.done);
    finish();
    await done;
    assert.equal(publications, 1, 'non-retry EIO is injected once into this exact machine-list publication');
    assert.ok(temporary && machineTemporary(temporary));
    await assert.rejects(lstat(temporary), { code: 'ENOENT' });
    assert.equal(await readFile(machineFile, 'utf8'), old);
    assert.equal(await readFile(neighbor, 'utf8'), sentinel);
    assert.deepEqual(events, ['launch', 'exit']);
    assert.equal(live.bootAbort.signal.aborted, true);
    assert.equal(machines.live.has(id), false);
    assert.equal(changed, true);
    assert.ok((machines.logs.get(id) || '').includes(`保存实例状态失败：${String(failure)}`));
    t.diagnostic(JSON.stringify({ ownedFailure: failure.message, code: failure.code, injectedPublications: publications,
      temporaryCleaned: true, oldSha256: createHash('sha256').update(old).digest('hex'), neighborUnchanged: true }));
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
  }
});
