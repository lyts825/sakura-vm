/**
 * 模块职责：回归验证模块，围绕 `features` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `features`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: portable disks reject backing paths, external data, unexpected encryption and oversized virtual disks; folder sync rejects traversal, Windows device names, streams and ambiguous names.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: portable disks reject backing paths, external data, unexpected encryption and oversized virtual disks
 * 协作入口 / Collaborators: `Buffer.alloc`, `valid.writeUInt32BE`, `valid.writeBigUInt64BE`, `assert.doesNotThrow`.
 * 检查边界 / Checked boundaries: `assert.doesNotThrow(() => validateDiskHeader(valid))`; `assert.throws(() => validateDiskHeader(disk))`.
 */
test('portable disks reject backing paths, external data, unexpected encryption and oversized virtual disks', () => {
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
  const encrypted = Buffer.from(valid);
  encrypted.writeUInt32BE(2, 32);
  assert.throws(() => validateDiskHeader(encrypted));
  assert.doesNotThrow(() => validateDiskHeader(encrypted, true));
  assert.throws(() => validateDiskHeader(valid, true));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync rejects traversal, Windows device names, streams and ambiguous names
 * 协作入口 / Collaborators: `assert.throws`, `assert.equal`, `safeRelative`, `mutablePath`.
 * 检查边界 / Checked boundaries: `assert.throws(() => safeRelative(name), name)`; `assert.equal(safeRelative('目录/my-app.txt'), '目录/my-app.txt')`.
 */
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
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: official checksums match the entire filename, including Debian relative filenames
 * 协作入口 / Collaborators: `'a'.repeat`, `assert.equal`, `checksumFor`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(checksumFor(`${sum} ./disk.qcow2\n`, 'disk.qcow2'), sum)`; `assert.throws(() => checksumFor(`${sum} disk.qcow2.old`, 'disk.qcow2'))`.
 */
test('official checksums match the entire filename, including Debian relative filenames', () => {
  const sum = 'a'.repeat(128);
  assert.equal(checksumFor(`${sum}  ./disk.qcow2\n`, 'disk.qcow2'), sum);
  assert.throws(() => checksumFor(`${sum}  disk.qcow2.old`, 'disk.qcow2'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync refuses Linux paths that collide on Windows before copying either side
 * 协作入口 / Collaborators: `assert.throws`, `assert.doesNotThrow`.
 * 检查边界 / Checked boundaries: `assert.throws(() => validateSyncPaths(['src', 'SRC', 'src/a.ts', 'SRC/b.ts']), /Windows.*冲突/)`; `assert.throws(() => validateSyncPaths(['readme.md', 'README.md']), /Windows.*冲突/)`.
 */
test('folder sync refuses Linux paths that collide on Windows before copying either side', () => {
  assert.throws(() => validateSyncPaths(['src', 'SRC', 'src/a.ts', 'SRC/b.ts']), /Windows.*冲突/);
  assert.throws(() => validateSyncPaths(['readme.md', 'README.md']), /Windows.*冲突/);
  assert.doesNotThrow(() => validateSyncPaths(['src', 'src', 'src/a.ts', 'src/b.ts', '__proto__']));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CPU deltas account for idle/iowait and guest counters are not counted twice
 * 协作入口 / Collaborators: `parseMetrics`, `assert.equal`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.equal(metrics.cpuPercent, 30)`; `assert.equal(metrics.memoryUsed, 512 * 1024)`.
 */
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
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project boundaries accept explicit guest commands but reject invalid paths and repository protocols
 * 协作入口 / Collaborators: `assert.equal`, `projectSchema.parse`, `projectSchema.safeParse`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(projectSchema.parse({}).directory, '/workspace')`; `assert.equal(projectSchema.parse({ setup: 'echo hello; npm install' }).setup, 'echo hello; npm install')`.
 */
test('project boundaries accept explicit guest commands but reject invalid paths and repository protocols', () => {
  assert.equal(projectSchema.parse({}).directory, '/workspace');
  assert.equal(projectSchema.parse({ setup: 'echo hello; npm install' }).setup, 'echo hello; npm install');
  for (const input of [
    { directory: 'relative' },
    { repository: 'file:///etc/shadow' },
    { previewPort: 80 },
    { networkIsolation: 'private', previewPort: 18080 },
    { networkIsolation: 'unrestricted' },
    { template: 'shell' },
    { hostCommand: 'cmd.exe' },
  ])
    assert.equal(projectSchema.safeParse(input).success, false);
  assert.match(provisionScript('python', 'alpine'), /apk add/);
  assert.match(provisionScript('python', 'alpine'), /--timeout 30/);
  assert.match(provisionScript('python', 'debian'), /python3-venv/);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cloud-init and systemd desktop adapters retain key-only access and a non-root graphical user
 * 协作入口 / Collaborators: `cloudUserData`, `assert.match`, `desktopCommands`, `assert.doesNotMatch`.
 * 检查边界 / Checked boundaries: `assert.match(cloud, /disable_root: false/)`; `assert.match(cloud, /PasswordAuthentication no/)`.
 */
test('cloud-init and systemd desktop adapters retain key-only access and a non-root graphical user', () => {
  const cloud = cloudUserData('test-vm', 'ssh-rsa test');
  assert.match(cloud, /disable_root: false/);
  assert.match(cloud, /PasswordAuthentication no/);
  assert.match(cloud, /ssh_authorized_keys/);
  assert.match(cloudNetwork, /name: "e\*"/);
  assert.match(cloudNetwork, /dhcp6: true/);
  for (const distro of ['debian', 'ubuntu']) {
    const scripts = desktopCommands(distro);
    assert.doesNotMatch(scripts.install, /apk add|rc-service|rc-update/);
    assert.match(scripts.install, /User=root/);
    assert.match(scripts.install, /ExecStart=\/usr\/local\/libexec\/sakura-desktop-launcher/);
    assert.match(scripts.install, /\/usr\/bin\/setpriv --reuid/);
    assert.match(scripts.install, /kwin-x11/);
    assert.match(scripts.install, /test "\$uid" -ge 1000/);
    assert.match(scripts.install, /Xtigervnc :1/);
    assert.match(scripts.start, /systemctl restart/);
  }
  assert.match(imeInstall('alpine'), /fcitx5-chinese-addons/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: KDE desktop adapters expose validated appearance preferences for every distro
 * 协作入口 / Collaborators: `desktopCommands`, `assert.match`, `assert.doesNotMatch`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.match(commands.install, /KDE Plasma|kde-plasma-desktop/)`; `assert.match(commands.install, /RESOLUTION='1440x900'/)`.
 */
test('KDE desktop adapters expose validated appearance preferences for every distro', () => {
  const preferences = {
    resolution: '1440x900' as const,
    monitorLayout: 'dual-vertical' as const,
    scale: 125,
    theme: 'midnight' as const,
    wallpaper: 'midnight' as const,
    accent: '#e6a6cb',
    panel: 'top' as const,
    autoHidePanel: true,
    animations: false,
  };
  for (const distro of ['alpine', 'debian', 'ubuntu']) {
    const commands = desktopCommands(distro, preferences);
    assert.match(commands.install, /KDE Plasma|kde-plasma-desktop/);
    assert.match(commands.install, /RESOLUTION='1440x900'/);
    assert.match(commands.install, /MONITOR_LAYOUT='dual-vertical'/);
    assert.match(commands.install, /SCALE='125'/);
    assert.match(commands.configure, /desktop-preferences/);
    assert.match(commands.install, /ready_script=.*plasma-not-ready/);
    assert.match(commands.install, /WALLPAPER='midnight'/);
    assert.match(commands.install, /ps\[i\]\.hiding/);
    assert.match(commands.install, /sakura-applied-preferences/);
    assert.doesNotMatch(commands.install, /xfce4|xfwm4|xfdesktop/);
  }
  assert.throws(() => desktopCommands('alpine', { ...preferences, accent: 'red' } as never), /6 位十六进制/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: setup identity changes only when preparation inputs change
 * 协作入口 / Collaborators: `projectSchema.parse`, `setupFingerprint`, `assert.equal`, `assert.notEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(setupFingerprint({ ...project, command: 'npm start', previewPort: 19000 }), original)`; `assert.notEqual(setupFingerprint({ ...project, ...patch }), original)`.
 */
test('setup identity changes only when preparation inputs change', () => {
  const project = projectSchema.parse({ setup: 'npm ci', command: 'npm run dev', previewPort: 18080 });
  const original = setupFingerprint(project);
  assert.equal(setupFingerprint({ ...project, command: 'npm start', previewPort: 19000 }), original);
  for (const patch of [
    { directory: '/workspace/other' },
    { repository: 'https://example.com/repo.git' },
      { template: 'node' as const },
      { setup: 'npm install' },
      { networkIsolation: 'private' as const },
  ])
    assert.notEqual(setupFingerprint({ ...project, ...patch }), original);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: jobs bound output, reject duplicate work, report failure and allow retry
 * 协作入口 / Collaborators: `jobs.start`, `assert.throws`, `assert.equal`, `jobs.view`.
 * 检查边界 / Checked boundaries: `assert.throws(() => jobs.start('test', async () => {}), /仍在进行/)`; `assert.equal(jobs.view('test')?.log.length, 32768)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('jobs bound output, reject duplicate work, report failure and allow retry', async () => {
  const jobs = new Jobs();
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
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
