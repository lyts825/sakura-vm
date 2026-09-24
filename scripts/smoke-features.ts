import { PLUGINS } from '../shared/plugins.ts';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
const root = await mkdtemp(join(tmpdir(), 'sakura-features-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { freePort } = await import('../server/qmp.ts');
const { vmDir } = await import('../server/model.ts');
const engine = await createRuntime();
const machines = new Machines(engine);
await machines.init();
const features = await Features.create(
  machines,
  PLUGINS.map((item) => item.id),
);
const ids: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function boot(id: string) {
  const started = Date.now();
  await machines.start(id);
  const until = Date.now() + 300000;
  while (Date.now() < until) {
    if (machines.state(id) === 'running') {
      console.log('Ready in', ((Date.now() - started) / 1000).toFixed(1), 'seconds');
      return;
    }
    if (['stopped', 'error'].includes(machines.state(id)))
      throw new Error(machines.logs.get(id)?.slice(-12000));
    await sleep(500);
  }
  throw new Error('Boot timed out: ' + machines.logs.get(id));
}
async function job(jobs: { view(key: string): any }, id: string) {
  const until = Date.now() + 1200000;
  while (jobs.view(id)?.status === 'running') {
    if (Date.now() > until) throw new Error('Job timed out');
    await sleep(500);
  }
  const result = jobs.view(id);
  assert.equal(result?.status, 'done', result?.error + '\n' + result?.log);
  return result;
}
async function command(id: string, cmd: string) {
  const result = await machines.exec(id, cmd, 30000);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}
try {
  if (process.env.SAKURA_TEST_DISTROS_ONLY !== '1') {
    const vm = await machines.create({ name: 'features-test', memoryMiB: 2048 });
    ids.push(vm.id);
    const id = vm.id;
    console.log('Starting isolated Alpine feature tests');
    await boot(id);
    await features.files.operation(id, 'mkdir', '/workspace/files');
    const binary = Buffer.from([0, 255, 127, 128, 10, 13, ...Buffer.from('中文 binary')]);
    await features.files.upload(id, '/workspace/files/test.bin', Readable.from(binary));
    const chunks: Buffer[] = [];
    await features.files.download(
      id,
      '/workspace/files/test.bin',
      new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      }),
      (size) => assert.equal(size, binary.length),
    );
    assert.deepEqual(Buffer.concat(chunks), binary);
    await assert.rejects(
      features.files.upload(id, '/workspace/files/test.bin', Readable.from('overwrite')),
      /目标已存在/,
    );
    await features.files.upload(id, '/workspace/files/test.bin', Readable.from(binary), true);
    const interrupted = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('interrupted transfer'));
      },
    });
    await assert.rejects(
      features.files.upload(id, '/workspace/files/test.bin', interrupted, true),
      /interrupted/,
    );
    assert.deepEqual(Buffer.from(await command(id, 'base64 /workspace/files/test.bin'), 'base64'), binary);
    const uploadAbort = new AbortController();
    const uploadSource = new PassThrough();
    const uploadResult = features.files
      .upload(id, '/workspace/files/test.bin', uploadSource, true, uploadAbort.signal)
      .then(
        () => null,
        (error: unknown) => error,
      );
    try {
      uploadSource.write(Buffer.alloc(64 * 1024, 'x'));
      const deadline = Date.now() + 10000;
      let temporary = '';
      while (!temporary && Date.now() < deadline) {
        temporary = await command(id, "find /workspace/files -name '.sakura-upload-*'");
        if (!temporary) await sleep(100);
      }
      assert.ok(temporary, 'The upload must have opened its remote temporary file before cancellation');
      uploadAbort.abort();
      assert.equal(((await uploadResult) as Error)?.name, 'AbortError');
      assert.deepEqual(Buffer.from(await command(id, 'base64 /workspace/files/test.bin'), 'base64'), binary);
      assert.equal(await command(id, "find /workspace/files -name '.sakura-upload-*'"), '');
    } finally {
      uploadAbort.abort();
      uploadSource.destroy();
      await uploadResult;
    }
    console.log('PASS canceled SFTP upload preserves the original and removes its temporary file');
    await features.files.operation(id, 'rename', '/workspace/files/test.bin', '/workspace/files/renamed.bin');
    await features.files.operation(id, 'delete', '/workspace/files/renamed.bin');
    await features.files.operation(id, 'delete', '/workspace/files');
    await command(
      id,
      'mkdir -p /workspace/remove-me/nested; printf keep > /workspace/keep.txt; ln -s /workspace/keep.txt /workspace/remove-me/link; printf remove > /workspace/remove-me/nested/file',
    );
    await features.files.operation(id, 'delete', '/workspace/remove-me', undefined, true);
    assert.equal(await machines.readGuestFile(id, '/workspace/keep.txt'), 'keep');
    console.log('PASS binary upload/download/overwrite/rename/delete');
    const metrics = await features.workspaces.metrics(id);
    assert.ok(metrics.memoryTotal > 0 && metrics.diskTotal > 0);
    assert.ok(metrics.cpuPercent >= 0 && metrics.cpuPercent <= 100);
    const hostPort = await freePort();
    await machines.setForwards(id, [{ name: 'SSH test', host: hostPort, guest: 22 }]);
    const { createConnection } = await import('node:net');
    await new Promise<void>((res, rej) => {
      const socket = createConnection(hostPort, '127.0.0.1');
      socket.setTimeout(10000);
      socket.on('timeout', () => {
        socket.destroy();
        rej(new Error('Forward timed out'));
      });
      socket.once('error', rej);
      socket.once('data', (data) => {
        assert.match(data.toString(), /^SSH-/);
        socket.destroy();
        res();
      });
    });
    await machines.setForwards(id, []);
    console.log('PASS guest metrics and live port updates');
    await features.workspaces.save(id, {
      directory: '/workspace/app',
      template: 'python',
      setup: 'printf prepared > ready.txt; printf x >> setup-runs.txt',
      command: 'python3 -m http.server 8088 --bind 0.0.0.0',
    });
    await features.workspaces.run(id, 'start');
    await job(features.workspaces.jobs, id);
    assert.equal((await features.workspaces.runtime(id)).status, 'running');
    assert.equal((await command(id, 'cat /workspace/app/ready.txt')).trim(), 'prepared');
    const savedProject = await features.workspaces.config(id);
    await features.workspaces.save(id, { ...savedProject, previewPort: 18088 });
    await features.workspaces.run(id, 'start');
    await job(features.workspaces.jobs, id);
    assert.equal(await machines.readGuestFile(id, '/workspace/app/setup-runs.txt'), 'x');
    await features.workspaces.run(id, 'stop');
    await job(features.workspaces.jobs, id);
    assert.equal((await features.workspaces.runtime(id)).status, 'stopped');
    await features.workspaces.save(id, {
      ...savedProject,
      command: 'python3 -m http.server 8089 --bind 0.0.0.0',
      previewPort: 18089,
    });
    await features.workspaces.run(id, 'start');
    await job(features.workspaces.jobs, id);
    assert.equal(await machines.readGuestFile(id, '/workspace/app/setup-runs.txt'), 'x');
    await features.workspaces.run(id, 'stop');
    await job(features.workspaces.jobs, id);
    // Already-running projects must be detected before a newly edited setup command runs.
    await features.workspaces.run(id, 'start');
    await job(features.workspaces.jobs, id);
    await features.workspaces.save(id, { ...savedProject, setup: 'printf unsafe > ready.txt' });
    await features.workspaces.run(id, 'start');
    await job(features.workspaces.jobs, id);
    assert.equal(await machines.readGuestFile(id, '/workspace/app/ready.txt'), 'prepared');
    await features.workspaces.run(id, 'stop');
    await job(features.workspaces.jobs, id);
    console.log('PASS template install, project preparation/start/logs/stop');
    if (process.env.SAKURA_TEST_TEMPLATES === '1') {
      for (const template of ['node', 'rust'] as const) {
        await features.workspaces.save(id, { directory: '/workspace/app', template });
        await features.workspaces.run(id, 'setup');
        await job(features.workspaces.jobs, id);
        console.log(
          await command(
            id,
            template === 'node' ? 'node --version; npm --version' : 'rustc --version; cargo --version',
          ),
        );
        console.log('PASS template', template);
      }
    }
    const host = join(root, 'shared');
    await mkdir(host);
    await mkdir(join(host, 'empty-directory'));
    await writeFile(join(host, 'hello.txt'), 'host-one');
    await writeFile(join(host, '__proto__'), 'ordinary-file');
    await features.sync.save(id, { host, guest: '/workspace/shared', auto: false });
    await features.sync.run(id, 'both');
    await job(features.sync.jobs, id);
    assert.equal(await machines.readGuestFile(id, '/workspace/shared/hello.txt'), 'host-one');
    await command(id, 'test -d /workspace/shared/empty-directory; mkdir /workspace/shared/guest-empty');
    await machines.writeGuestFile(id, '/workspace/shared/guest.txt', 'guest-one');
    await features.sync.run(id, 'both');
    await job(features.sync.jobs, id);
    assert.equal(await readFile(join(host, 'guest.txt'), 'utf8'), 'guest-one');
    assert.ok((await import('node:fs')).existsSync(join(host, 'guest-empty')));
    await machines.writeGuestFile(id, '/workspace/shared/__proto__', 'ordinary-updated-file');
    await features.sync.run(id, 'both');
    await job(features.sync.jobs, id);
    assert.equal(await readFile(join(host, '__proto__'), 'utf8'), 'ordinary-updated-file');
    await machines.writeGuestFile(id, '/workspace/shared/HELLO.txt', 'case-conflict');
    await features.sync.run(id, 'both');
    while (features.sync.jobs.view(id)?.status === 'running') await sleep(100);
    assert.equal(features.sync.jobs.view(id)?.status, 'error');
    assert.match(features.sync.jobs.view(id)?.error || '', /Windows.*冲突/);
    assert.equal(await readFile(join(host, 'hello.txt'), 'utf8'), 'host-one');
    await features.files.operation(id, 'delete', '/workspace/shared/HELLO.txt');
    await writeFile(join(host, 'hello.txt'), 'host-conflict');
    await machines.writeGuestFile(id, '/workspace/shared/hello.txt', 'guest-conflict');
    await features.sync.run(id, 'both');
    const conflict = await job(features.sync.jobs, id);
    assert.match(conflict.log, /冲突，保留两边/);
    assert.equal(await readFile(join(host, 'hello.txt'), 'utf8'), 'host-conflict');
    assert.equal(await machines.readGuestFile(id, '/workspace/shared/hello.txt'), 'guest-conflict');
    await features.sync.run(id, 'push');
    await job(features.sync.jobs, id);
    assert.equal(await machines.readGuestFile(id, '/workspace/shared/hello.txt'), 'host-conflict');
    console.log('PASS two-way folder sync, conflicts and explicit resolution');
    await machines.stop(id);
    const snapshot = await machines.snapshot(id, 'baseline');
    await machines.editSnapshot(id, snapshot.id, { name: 'baseline-note', note: 'verified' });
    await boot(id);
    await machines.writeGuestFile(id, '/workspace/after-snapshot.txt', 'after');
    await machines.stop(id);
    await machines.restore(id, snapshot.id, true);
    assert.equal(machines.get(id).snapshots.length, 2);
    await machines.editSnapshot(id, snapshot.id, null);
    assert.equal(machines.get(id).snapshots.length, 1);
    const clone = await features.bundles.clone(id, 'clone-test');
    ids.push(clone.id);
    const beforeFirstBoot = await machines.snapshot(clone.id, 'before-first-boot');
    await boot(clone.id);
    assert.equal((await features.workspaces.config(clone.id)).directory, '/workspace/app');
    assert.equal(await machines.readGuestFile(clone.id, '/workspace/shared/hello.txt'), 'host-conflict');
    assert.notEqual(
      await readFile(join(vmDir(id), 'id_rsa'), 'utf8'),
      await readFile(join(vmDir(clone.id), 'id_rsa'), 'utf8'),
    );
    await assert.rejects(machines.readGuestFile(clone.id, '/workspace/after-snapshot.txt'));
    await machines.stop(clone.id);
    await boot(clone.id);
    await machines.stop(clone.id);
    const historicalClone = await features.bundles.clone(clone.id, 'snapshot-clone-test', beforeFirstBoot.id);
    ids.push(historicalClone.id);
    await boot(historicalClone.id);
    assert.equal(
      await machines.readGuestFile(historicalClone.id, '/workspace/shared/hello.txt'),
      'host-conflict',
    );
    await machines.stop(historicalClone.id);
    await machines.restore(clone.id, beforeFirstBoot.id);
    await boot(clone.id);
    assert.equal(await machines.readGuestFile(clone.id, '/workspace/shared/hello.txt'), 'host-conflict');
    await machines.stop(clone.id);
    console.log('PASS pre-first-boot snapshot clone and restore preserve a usable SSH identity');
    const bundle = join(root, 'portable.sakura');
    await features.bundles.export(id, createWriteStream(bundle), () => {});
    const imported = await features.bundles.import('import-test', createReadStream(bundle));
    ids.push(imported.id);
    await boot(imported.id);
    assert.equal((await features.workspaces.config(imported.id)).directory, '/workspace/app');
    assert.equal(await machines.readGuestFile(imported.id, '/workspace/shared/hello.txt'), 'host-conflict');
    await machines.stop(imported.id);
    console.log('PASS snapshot backup/delete, clone key rotation, portable export/import');
  }
  if (process.env.SAKURA_TEST_DISTROS === '1' || process.env.SAKURA_TEST_DISTROS_ONLY === '1') {
    for (const distro of ['debian', 'ubuntu'] as const) {
      if (process.env.SAKURA_TEST_DISTRO && process.env.SAKURA_TEST_DISTRO !== distro) continue;
      const other = await machines.create({ name: distro + '-test', distro, memoryMiB: 2048, diskGiB: 8 });
      ids.push(other.id);
      console.log('Booting', distro);
      await boot(other.id);
      console.log(await command(other.id, 'cat /etc/os-release; uname -a'));
      await machines.writeGuestFile(other.id, '/workspace/persistence.txt', distro);
      await machines.stop(other.id);
      await boot(other.id);
      assert.equal(await machines.readGuestFile(other.id, '/workspace/persistence.txt'), distro);
      if (process.env.SAKURA_TEST_DISTRO_DESKTOP === '1') {
        const { Desktops } = await import('../server/desktop.ts');
        const { imeInstall } = await import('../server/desktop-guest.ts');
        const desktops = new Desktops(machines);
        desktops.start(other.id, 'install');
        const deadline = Date.now() + 1200000;
        for (;;) {
          const view = await desktops.view(other.id);
          if (view.status === 'ready') break;
          if (view.status === 'error') throw new Error(view.error + '\n' + view.log);
          assert.ok(Date.now() < deadline, 'Desktop install timeout');
          console.log(distro, view.status, view.log.slice(-180));
          await sleep(15000);
        }
        console.log('PASS', distro, 'KDE Plasma desktop');
        const result = await machines.exec(other.id, imeInstall(distro), 1200000);
        assert.equal(result.code, 0, result.stderr + result.stdout.slice(-3000));
        await command(other.id, 'pgrep -u sakura-desktop fcitx5');
        console.log('PASS', distro, 'Chinese input');
      }
      await machines.stop(other.id);
      console.log('PASS', distro, 'NoCloud, SSH/SFTP and reboot');
    }
  }
  console.log('PASS all new feature integration tests');
} finally {
  await features.close();
  for (const id of ids) {
    await machines.stop(id, true).catch(() => {});
    await machines.delete(id).catch(() => {});
  }
  await machines.close();
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-features-'));
  await rm(root, { recursive: true, force: true });
}
