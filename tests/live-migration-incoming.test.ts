import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-incoming-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-incoming-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

test('incoming QEMU stays paused until transfer completes and cannot be resumed manually', async () => {
  const launches: string[][] = [];
  const engine = { whpxAvailable: false, runtime: { close: async () => {} },
    run: async (_tool: string, args: string[], options: { signal: AbortSignal }) => {
      launches.push(args);
      await new Promise<void>((resolve) => options.signal.addEventListener('abort',
        () => resolve(), { once: true }));
    },
  } as unknown as Engine;
  const machines = new Machines(engine);
  await machines.init();
  const id = randomUUID();
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'disk.qcow2'), 'synthetic disk');
  machines.records.set(id, { ...createSchema.parse({ name: 'target' }),
    id, createdAt: new Date().toISOString(), snapshots: [] });
  try {
    const incoming = await machines.startIncoming(id);
    assert.equal(incoming.status, 'paused');
    assert.deepEqual(launches[0].slice(-2), ['-incoming', 'defer']);
    assert.equal(machines.live.get(id)?.incoming, true);
    assert.equal(machines.live.get(id)?.bootDone, undefined);
    await assert.rejects(machines.startIncoming(id), /必须处于停止状态/);
    await assert.rejects(machines.resume(id), /迁移接收中/);
    await assert.rejects(machines.completeIncoming(id, async () =>
      ({ status: 'inmigrate', running: false })), /尚未完成迁移/);
    assert.equal(machines.state(id), 'paused');
    await machines.completeIncoming(id, async () => ({ status: 'running', running: true }));
    assert.equal(machines.state(id), 'starting');
    assert.equal(machines.live.get(id)?.incoming, false);
    assert.ok(machines.live.get(id)?.bootDone);
    await machines.stop(id, true);
    assert.equal(machines.live.has(id), false);
  } finally {
    if (machines.live.has(id)) await machines.stop(id, true);
    await machines.close();
  }
});
