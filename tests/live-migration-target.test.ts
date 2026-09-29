import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Engine } from '../server/runtime.ts';
import type { HostPeers } from '../server/host-peers.ts';
import { createSshKey, seedIso } from '../server/seed.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-live-target-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(root, 'base.qcow2');
const { Machines } = await import('../server/machines.ts');
const { LiveMigrationReceiver } = await import('../server/live-migration-receiver.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  const [resolved, temporary] = await Promise.all([realpath(root), realpath(tmpdir())]);
  if (dirname(resolved).toLowerCase() !== temporary.toLowerCase() ||
      !basename(resolved).startsWith('sakura-live-target-'))
    throw new Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
});

test('a QEMU launch failure removes the unpublished incoming target', async () => {
  await writeFile(process.env.SAKURA_IMAGE_PATH!, 'synthetic base');
  const engine = { qemuIoAvailable: false, runtime: { close: async () => {} },
    run: async (tool: string, args: string[]) => {
      if (tool === 'sakura-img') return writeFile(args.at(-2)!, 'synthetic overlay');
      throw new Error('injected QEMU launch failure');
    },
  } as unknown as Engine;
  const machines = new Machines(engine);
  await machines.init();
  let registered = false;
  const peers = { registerMigrationSession: () => { registered = true; return randomUUID(); },
    closeMigrationSession: () => {} } as unknown as HostPeers;
  try {
    const receiver = new LiveMigrationReceiver(machines, peers);
    await assert.rejects(receiver.prepare({ requesterId: randomUUID(),
      sourceVmId: randomUUID(), transferId: randomUUID(),
      config: { name: 'failing-target', memoryMiB: 512, cpus: 2, diskGiB: 8,
        accelerator: 'tcg', forwards: [] },
      key: createSshKey().privateText,
      seed: seedIso({ 'meta-data': 'source', 'user-data': 'setup' }),
    }), /目标 QEMU 未启动|目标 QEMU 已退出|目标 QMP 启动超时/);
    assert.equal(registered, false);
    assert.equal([...machines.records.values()].some((vm) => vm.name === 'failing-target'), false);
  } finally { await machines.close(); }
});

test('incoming target atomically adopts source identity and persists a non-bootable prepared record', async () => {
  await writeFile(process.env.SAKURA_IMAGE_PATH!, 'synthetic base');
  const engine = { qemuIoAvailable: false, runtime: { close: async () => {} },
    run: async (tool: string, args: string[]) => {
      if (tool !== 'sakura-img') throw new Error(`Unexpected ${tool}`);
      await writeFile(args.at(-2)!, 'synthetic overlay');
    },
  } as unknown as Engine;
  const machines = new Machines(engine);
  await machines.init();
  const source = { sourceHostId: randomUUID(), sourceVmId: randomUUID(),
    transferId: randomUUID() };
  const identity = { key: createSshKey().privateText,
    seed: seedIso({ 'meta-data': 'source identity', 'user-data': 'source setup' }) };
  try {
    await assert.rejects(machines.createIncomingTarget({ name: 'invalid' }, {
      key: 'not a private key', seed: identity.seed,
    }, source), /身份数据无效|控制密钥无效/);
    const target = await machines.createIncomingTarget({ name: 'target' }, identity, source);
    assert.equal(target.liveMigrationOrigin?.status, 'prepared');
    assert.equal(target.liveMigrationOrigin?.sourceVmId, source.sourceVmId);
    assert.equal(await readFile(join(vmDir(target.id), 'id_rsa'), 'utf8'), identity.key);
    assert.deepEqual(await readFile(join(vmDir(target.id), 'seed.iso')), identity.seed);
    await assert.rejects(machines.start(target.id), /尚未接收客户机状态/);
    await assert.rejects(machines.createIncomingTarget({ name: 'other' }, identity, source),
      /已创建目标实例/);
    const restored = new Machines(engine);
    await restored.init();
    try {
      assert.equal(restored.get(target.id).liveMigrationOrigin?.status, 'prepared');
      await assert.rejects(restored.start(target.id), /尚未接收客户机状态/);
    } finally { await restored.close(); }
  } finally { await machines.close(); }
});
