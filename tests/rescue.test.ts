import assert from 'node:assert/strict';
import test, { after, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import type { SandboxArtifacts } from '../server/sandbox-artifacts.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-rescue-test-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(root, 'alpine.qcow2');
await writeFile(process.env.SAKURA_IMAGE_PATH, 'image');
const { Machines } = await import('../server/machines.ts');
const { Rescue, rescueSetup } = await import('../server/rescue.ts');
const { rescueRunSchema } = await import('../shared/rescue.ts');
const { Jobs } = await import('../server/jobs.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-rescue-test-'));
  await rm(root, { recursive: true, force: true });
});

async function fixture(t: TestContext) {
  const launches: string[][] = [],
    messages: { execute: string; arguments: any }[] = [];
  let readOnly = true;
  const engine = {
    whpxAvailable: false,
    runtime: { close: async () => {} },
    run: async (tool, args, options = {}) => {
      if (tool === 'sakura-img' && args[0] === 'create') await writeFile(args.at(-2)!, 'disk');
      if (tool === 'sakura-qemu') {
        launches.push(args);
        const port = Number(/tcp:127\.0\.0\.1:(\d+)/.exec(args[args.indexOf('-qmp') + 1])![1]);
        const sockets = new Set<Socket>();
        const server = createServer((socket) => {
          sockets.add(socket);
          socket.on('error', () => {});
          socket.on('close', () => sockets.delete(socket));
          socket.write('{"QMP":{"version":{}}}\n');
          let buffer = '';
          socket.on('data', (chunk) => {
            buffer += chunk.toString();
            let at: number;
            while ((at = buffer.indexOf('\n')) >= 0) {
              const message = JSON.parse(buffer.slice(0, at));
              buffer = buffer.slice(at + 1);
              messages.push(message);
              socket.write(
                JSON.stringify({
                  id: message.id,
                  return:
                    message.execute === 'query-named-block-nodes'
                      ? [{ 'node-name': 'sakura-rescue-source', ro: readOnly }]
                      : {},
                }) + '\n',
              );
            }
          });
        });
        server.listen(port, '127.0.0.1');
        await once(server, 'listening');
        await new Promise<void>((done) => {
          if (options.signal?.aborted) done();
          else options.signal?.addEventListener('abort', () => done(), { once: true });
        });
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((done) => server.close(() => done()));
      }
      return '';
    },
  } as Engine;
  const machines = new Machines(engine);
  await mkdir(join(root, 'machines'), { recursive: true });
  machines.exec = async () => ({ stdout: '', stderr: '', code: 0 });
  const source = await machines.create({ name: 'source-' + randomUUID().slice(0, 8) });
  const directory = join(root, randomUUID());
  const jobs = new Jobs('rescue', directory);
  const saved: any[] = [];
  const artifacts = {
    prune: async () => {},
    collect: async (_vm: string, _run: string, _cwd: string, paths: string[], save: (value: any) => void) => {
      for (const path of paths) {
        const entry = { id: randomUUID(), name: path, path, bytes: 4, sha256: 'a'.repeat(64) };
        saved.push(entry);
        save(entry);
      }
    },
    download: async (job: any, id: string) => {
      assert.ok(job.execution.artifacts.some((item: any) => item.id === id));
      return { ...saved.find((item) => item.id === id), base64: 'dGVzdA==' };
    },
  } as unknown as SandboxArtifacts;
  const service = new Rescue(machines, jobs, artifacts);
  t.after(async () => {
    await service.close();
    await machines.close();
  });
  return {
    machines,
    source,
    launches,
    messages,
    service,
    jobs,
    directory,
    readonly: (value: boolean) => {
      readOnly = value;
    },
  };
}

test('rescue inputs restrict disk selection, deadlines and guest artifact paths', () => {
  assert.equal(rescueRunSchema.parse({ command: 'blkid' }).partition, 0);
  assert.equal(rescueRunSchema.parse({ command: 'blkid', partition: null }).partition, null);
  for (const value of [
    { command: ' ' },
    { command: 'a\0b' },
    { partition: -1 },
    { partition: 129 },
    { partition: 'host-path' },
    { timeoutSeconds: 1801 },
    { artifacts: ['../secret'] },
    { artifacts: ['/absolute'] },
    { artifacts: ['a', 'a'] },
    { network: 'nat' },
  ])
    assert.equal(rescueRunSchema.safeParse({ command: 'blkid', ...value }).success, false);
  assert.ok(rescueSetup(1).includes('target="$device"1'));
  assert.ok(rescueSetup(0).includes('ro,noload'));
  assert.ok(!rescueSetup(null).includes('mount -t'));
});

test('rescue locks the source until QEMU exit and attaches only a verified read-only disk after boot', async (t) => {
  const f = await fixture(t);
  const result = await f.machines.withRescue(
    f.source.id,
    new AbortController().signal,
    () => {},
    async (id) => {
      assert.equal(f.machines.state(id), 'running');
      assert.equal(f.machines.isBusy(f.source.id), true);
      await assert.rejects(f.machines.start(f.source.id), /另一项/);
      await assert.rejects(f.machines.delete(f.source.id), /另一项/);
      await assert.rejects(f.machines.snapshot(f.source.id, 'blocked'), /另一项/);
      await assert.rejects(f.machines.start(id), /只能由救援任务/);
      const rescue = f.machines.get(id);
      assert.equal(rescue.rescueOf, f.source.id);
      assert.equal(rescue.sandbox?.network, 'isolated');
      assert.equal(rescue.sandbox?.storage, 'discard-on-stop');
      assert.ok(!f.launches[0].some((arg) => arg.includes(vmDir(f.source.id))));
      const addition = f.messages.find((message) => message.execute === 'blockdev-add')!;
      assert.equal(addition.arguments['read-only'], true);
      assert.equal(addition.arguments.file['read-only'], true);
      assert.equal(addition.arguments.file.filename, join(vmDir(f.source.id), 'disk.qcow2'));
      return 'inspected';
    },
  );
  assert.equal(result, 'inspected');
  assert.equal(f.machines.live.size, 0);
  assert.equal(f.machines.records.size, 1);
  assert.equal(f.machines.isBusy(f.source.id), false);
});

test('unconfirmed read-only status refuses commands and still destroys the temporary guest', async (t) => {
  const f = await fixture(t);
  f.readonly(false);
  await assert.rejects(
    f.machines.withRescue(
      f.source.id,
      new AbortController().signal,
      () => {},
      async () => assert.fail('must not execute'),
    ),
    /未确认只读/,
  );
  assert.equal(f.machines.records.size, 1);
  assert.equal(f.machines.live.size, 0);
  assert.equal(f.machines.isBusy(f.source.id), false);
});

test('rescue jobs retain failure output and explicit artifacts across restart, and isolate downloads by source', async (t) => {
  const f = await fixture(t);
  f.machines.exec = async (_id, command, _timeout, _signal, log) => {
    if (command.startsWith('cd /workspace')) {
      log?.('diagnostic output\n');
      return { code: 7, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const job = f.service.run(f.source.id, { command: 'inspect', artifacts: ['report.txt'] });
  await f.jobs.wait(f.source.id);
  assert.equal(job.status, 'error');
  assert.match(job.log, /diagnostic output/);
  assert.equal(job.execution?.exitCode, 7);
  assert.equal(job.execution?.artifacts.length, 1);
  await f.jobs.flush();
  const restoredJobs = new Jobs('rescue', f.directory);
  t.after(() => restoredJobs.close());
  assert.equal(restoredJobs.get(job.id!)?.execution?.artifacts[0].path, 'report.txt');
  assert.equal(
    (await f.service.artifact(f.source.id, job.id!, job.execution!.artifacts[0].id)).base64,
    'dGVzdA==',
  );
  const other = await f.machines.create({ name: 'other-' + randomUUID().slice(0, 8) });
  await assert.rejects(f.service.artifact(other.id, job.id!, job.execution!.artifacts[0].id), /不存在/);
});

test('cancellation, timeout and source lockdown stop the entire guest and release the source lock', async (t) => {
  const f = await fixture(t);
  let started!: () => void;
  f.machines.exec = async (_id, command, _timeout, signal) => {
    if (command.startsWith('cd /workspace')) {
      started();
      await delay(60000, undefined, { signal });
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  for (const mode of ['cancel', 'timeout', 'lockdown']) {
    const running = new Promise<void>((done) => {
      started = done;
    });
    const job = f.service.run(f.source.id, { command: 'wait', timeoutSeconds: mode === 'timeout' ? 1 : 60 });
    await running;
    if (mode === 'cancel') f.jobs.cancel(f.source.id);
    if (mode === 'lockdown') await f.machines.setIncidentLockdown(f.source.id, true);
    await f.jobs.wait(f.source.id);
    assert.equal(job.status, mode === 'cancel' ? 'cancelled' : 'error');
    if (mode === 'timeout') assert.equal(job.execution?.outcome, 'timeout');
    assert.equal(f.machines.records.size, 1);
    assert.equal(f.machines.live.size, 0);
    assert.equal(f.machines.isBusy(f.source.id), false);
  }
});

test('host shutdown drains active rescue and restart removes the orphan record without resuming it', async (t) => {
  const f = await fixture(t);
  let started!: () => void;
  const running = new Promise<void>((done) => {
    started = done;
  });
  const pending = f.machines.withRescue(
    f.source.id,
    new AbortController().signal,
    () => {},
    async (_id, signal) => {
      started();
      await delay(60000, undefined, { signal });
    },
  );
  const rejected = assert.rejects(pending, /abort/i);
  await running;
  await f.machines.close();
  await rejected;
  assert.equal(f.machines.live.size, 0);
  assert.equal(f.machines.isBusy(f.source.id), false);
  const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
  assert.equal(saved.filter((vm: any) => vm.rescueOf).length, 1);
  const restarted = new Machines(f.machines.engine);
  await restarted.init();
  t.after(() => restarted.close());
  assert.equal(restarted.records.size, 1);
  assert.equal(restarted.get(f.source.id).rescueOf, undefined);
  assert.equal(f.launches.length, 1);
});

test('running or sandbox sources and closed services cannot submit rescue jobs', async (t) => {
  const f = await fixture(t);
  await f.machines.start(f.source.id);
  assert.throws(() => f.service.run(f.source.id, { command: 'blkid' }), /先停止/);
  f.machines.live.get(f.source.id)!.abort.abort();
  await f.machines.live.get(f.source.id)!.done;
  const box = await f.machines.create(
    { name: 'box-' + randomUUID().slice(0, 8) },
    { network: 'isolated', onExpire: 'delete', expiresAt: new Date(Date.now() + 60000).toISOString() },
  );
  assert.throws(() => f.service.run(box.id, { command: 'blkid' }), /普通实例/);
  await f.service.close();
  assert.throws(() => f.service.run(f.source.id, { command: 'blkid' }), /关闭/);
});
