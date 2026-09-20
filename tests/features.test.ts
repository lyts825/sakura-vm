import test from 'node:test';
import assert from 'node:assert/strict';
import { checksumFor } from '../server/images.ts';
import { validateDiskHeader } from '../server/bundles.ts';
import { safeRelative, validateSyncPaths } from '../server/sync.ts';
import { mutablePath, quote } from '../server/files.ts';
import { parseMetrics, projectSchema, provisionScript, setupFingerprint } from '../server/workspaces.ts';
import { cloudUserData, cloudNetwork } from '../server/seed.ts';
import { desktopCommands, imeInstall } from '../server/desktop-guest.ts';
import { Jobs } from '../server/jobs.ts';

test('portable disks reject backing paths, external data, encryption and oversized virtual disks before QEMU reads them', () => {
  const valid = Buffer.alloc(104);
  valid.writeUInt32BE(0x514649fb);
  valid.writeUInt32BE(3, 4);
  valid.writeBigUInt64BE(8n * 1024n ** 3n, 24);
  assert.doesNotThrow(() => validateDiskHeader(valid));
  for (const mutate of [
    (b: Buffer) => b.writeBigUInt64BE(104n, 8),
    (b: Buffer) => b.writeUInt32BE(1, 16),
    (b: Buffer) => b.writeUInt32BE(1, 32),
    (b: Buffer) => b.writeBigUInt64BE(4n, 72),
    (b: Buffer) => b.writeBigUInt64BE(129n * 1024n ** 3n, 24),
  ]) {
    const disk = Buffer.from(valid);
    mutate(disk);
    assert.throws(() => validateDiskHeader(disk));
  }
  assert.throws(() => validateDiskHeader(Buffer.from('not a disk')));
});
test('folder sync rejects traversal, Windows device names, streams and ambiguous names', () => {
  for (const name of [
    '../a',
    '/a',
    'a/../b',
    'a\\b',
    'C:secret',
    'a:stream',
    'NUL',
    'con.txt',
    'COM1',
    'a.',
    'a ',
    'a//b',
    'a/\0b',
  ])
    assert.throws(() => safeRelative(name), name);
  assert.equal(safeRelative('目录/my-app.txt'), '目录/my-app.txt');
  for (const name of ['/', '/a/..', 'relative']) assert.throws(() => mutablePath(name));
  assert.equal(mutablePath('/workspace/./a'), '/workspace/a');
  assert.equal(quote("a'; touch /tmp/oops"), "'a'\\''; touch /tmp/oops'");
});
test('official checksums match the entire filename, including Debian relative filenames', () => {
  const sum = 'a'.repeat(128);
  assert.equal(checksumFor(`${sum}  ./disk.qcow2\n`, 'disk.qcow2'), sum);
  assert.throws(() => checksumFor(`${sum}  disk.qcow2.old`, 'disk.qcow2'));
});

test('folder sync refuses Linux paths that collide on Windows before copying either side', () => {
  assert.throws(() => validateSyncPaths(['src', 'SRC', 'src/a.ts', 'SRC/b.ts']), /Windows.*冲突/);
  assert.throws(() => validateSyncPaths(['readme.md', 'README.md']), /Windows.*冲突/);
  assert.doesNotThrow(() => validateSyncPaths(['src', 'src', 'src/a.ts', 'src/b.ts', '__proto__']));
});
test('CPU deltas account for idle/iowait and guest counters are not counted twice', () => {
  const metrics = parseMetrics(
    'CPU\ncpu 10 0 10 100 0 0 0 0 5 0\ncpu 30 0 20 150 20 0 0 0 8 0\nMEMORY\nMemTotal: 1024 kB\nMemAvailable: 512 kB\nDISK\n/dev/vda1 1000 400 600 40% /\nPROCESSES\n123 python3\nUPTIME\n120.5 10.0\n',
  );
  assert.equal(metrics.cpuPercent, 30);
  assert.equal(metrics.memoryUsed, 512 * 1024);
  assert.equal(metrics.diskUsed, 400 * 1024);
  assert.equal(metrics.uptime, 120.5);
  assert.throws(() => parseMetrics('invalid'));
});
test('project boundaries accept explicit guest commands but reject invalid paths and repository protocols', () => {
  assert.equal(projectSchema.parse({}).directory, '/workspace');
  assert.equal(projectSchema.parse({ setup: 'echo hello; npm install' }).setup, 'echo hello; npm install');
  for (const input of [
    { directory: 'relative' },
    { repository: 'file:///etc/shadow' },
    { previewPort: 80 },
    { template: 'shell' },
    { hostCommand: 'cmd.exe' },
  ])
    assert.equal(projectSchema.safeParse(input).success, false);
  assert.match(provisionScript('python', 'alpine'), /apk add/);
  assert.match(provisionScript('python', 'alpine'), /--timeout 30/);
  assert.match(provisionScript('python', 'debian'), /python3-venv/);
});
test('cloud-init and systemd desktop adapters retain key-only access and a non-root graphical user', () => {
  const cloud = cloudUserData('test-vm', 'ssh-rsa test');
  assert.match(cloud, /disable_root: false/);
  assert.match(cloud, /PasswordAuthentication no/);
  assert.match(cloud, /ssh_authorized_keys/);
  assert.match(cloudNetwork, /virtio_net/);
  for (const distro of ['debian', 'ubuntu']) {
    const scripts = desktopCommands(distro);
    assert.doesNotMatch(scripts.install, /apk add|rc-service|rc-update/);
    assert.match(scripts.install, /User=sakura-desktop/);
    assert.match(scripts.install, /Xtigervnc :1/);
    assert.match(scripts.start, /systemctl restart/);
  }
  assert.match(imeInstall('alpine'), /fcitx5-chinese-addons/);
});

test('setup identity changes only when preparation inputs change', () => {
  const project = projectSchema.parse({ setup: 'npm ci', command: 'npm run dev', previewPort: 18080 });
  const original = setupFingerprint(project);
  assert.equal(setupFingerprint({ ...project, command: 'npm start', previewPort: 19000 }), original);
  for (const patch of [
    { directory: '/workspace/other' },
    { repository: 'https://example.com/repo.git' },
    { template: 'node' as const },
    { setup: 'npm install' },
  ])
    assert.notEqual(setupFingerprint({ ...project, ...patch }), original);
});
test('jobs bound output, reject duplicate work, report failure and allow retry', async () => {
  const jobs = new Jobs();
  let release!: () => void;
  jobs.start('test', async (log) => {
    log('x'.repeat(40000));
    await new Promise<void>((r) => {
      release = r;
    });
    throw new Error('failure');
  });
  assert.throws(() => jobs.start('test', async () => {}), /仍在进行/);
  await new Promise((r) => setImmediate(r));
  assert.equal(jobs.view('test')?.log.length, 32768);
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(jobs.view('test')?.error, 'failure');
  jobs.start('test', async () => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(jobs.view('test')?.status, 'done');
  await jobs.close();
});
