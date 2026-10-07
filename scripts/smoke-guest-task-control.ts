/** 烟雾验收：验证已释放自有夹具中 guest-task 控制、回调及票据撤销。
 * Smoke acceptance for guest-task control, callbacks and ticket revocation in released owned fixtures. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.argv.length, 3, 'Pass the stopped, owned Debian boot-persistence fixture.');
const workspace = await realpath(resolve('.'));
const parent = await realpath(join(workspace, '.data', 'boot-persistence-test-temp'));
const root = await realpath(resolve(process.argv[2]));
assert.equal(dirname(root), parent);
assert.equal(basename(root), 'sakura-boot-persistence-53hCt6');
const vmId = '24230cbf-609b-4823-a6b4-9f599a122dc8';
const priorFile = join(root, 'boot-persistence-evidence.json'), priorBytes = await readFile(priorFile);
const prior = JSON.parse(priorBytes.toString());
assert.equal(prior.vmId, vmId); assert.equal(prior.passed, true); assert.equal(prior.vmStopped, true);
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.equal(records.length, 1); assert.equal(records[0].id, vmId); assert.equal(records[0].distro, 'debian');
/** 按 QEMU 可执行文件名和本夹具根目录/实例参数精确筛选主机进程，返回观测数量；该数量是残留证据，不赋予终止其他进程的权限。
 * Count host processes matching QEMU executable names and this fixture’s root/VM arguments; the count is residue evidence and grants no authority to terminate other processes. */
const exactQemu = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  "$r='" + root.replaceAll("'", "''") + "';$v='" + vmId + "';@(" +
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(sakura-qemu|qemu-system[^.]*)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains($r) -and $_.CommandLine.Contains($v) }).Count"
], { encoding: 'utf8', windowsHide: true }).trim());
assert.equal(exactQemu(), 0);
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = join(workspace, '.data', 'images');
process.env.SAKURA_IMAGE_PATH = join(workspace, '.data', 'images', 'debian-12.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { guestTask, guestTaskControlPaths, guestTaskControlRoot } = await import('../server/guest-task.ts');
const { quote } = await import('../server/files.ts');
/** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
 * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['server/guest-task.ts', 'server/machines.ts', 'scripts/smoke-guest-task-control.ts'];
const sources: Record<string, string> = {};
for (const file of sourceFiles) sources[file] = digest(await readFile(join(workspace, file)));
const invocation = randomUUID(), fixtureDirectory = '/run/sakura-task-control-smoke-' + invocation;
const proofFile = join(root, 'guest-task-control-evidence-' + invocation + '.json');
const proof: any = { version: 1, vmId, fixture: root, invocation, distro: 'debian',
  scope: 'Private task control permissions, stdin, exit status, cancellation, retirement acknowledgement and concurrent run ownership.',
  client: { node: process.version, execArgv: process.execArgv }, startedAt: new Date().toISOString(),
  previousEvidence: { file: priorFile, sha256: digest(priorBytes) }, sourceSha256: sources, checks: [], cleanup: {} };
const machines = new Machines(await createRuntime());
const nativeExec = machines.exec.bind(machines);
/** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
 * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
const run = async (command: string) => {
  const result = await nativeExec(vmId, command, 10_000);
  assert.equal(result.code, 0, result.stderr + result.stdout); return result.stdout.trim();
};
/** 按运行 ID 断言专属 cgroup 和任务控制目录均不存在，证明停止后控制资源已撤销。
 * Assert the run-specific cgroup/task-control directory are absent, proving stop revoked control resources. */
const absent = async (runId: string) => {
  await run('test ! -e ' + quote('/sys/fs/cgroup/sakura-task-' + runId) + '\n' +
    'test ! -e ' + quote(guestTaskControlPaths(runId).directory));
};
/** 将已经通过断言的命名证据加入本轮检查报告并输出进度；调用者先完成核验，这里只负责保留结论。
 * Add named evidence already validated by assertions to this run’s checks and print progress; callers validate first and this helper retains the result. */
const check = (name: string, evidence: object = {}) => {
  proof.checks.push({ name, ...evidence, passed: true }); console.log('PASS ' + name);
};
let initialized = false, active: Promise<unknown> | undefined, abort: AbortController | undefined;
const inputHelper = `import hashlib,json,sys\ndata=sys.stdin.buffer.read(131073)\nassert len(data)<=131072\nprint(json.dumps({'length':len(data),'sha256':hashlib.sha256(data).hexdigest(),'cgroup':open('/proc/self/cgroup').read().strip()}))\nif len(sys.argv)>1:sys.stderr.write('owned-input-exit\\n');sys.exit(23)`;
try {
  await machines.init(); initialized = true;
  assert.equal(machines.records.size, 1); assert.equal(machines.state(vmId), 'stopped');
  await machines.start(vmId);
  const deadline = Date.now() + 270_000;
  while (machines.state(vmId) === 'starting' && Date.now() < deadline) await delay(250);
  assert.equal(machines.state(vmId), 'running');
  await run('test -x /usr/bin/python3\numask 077\nmkdir -m 700 ' + quote(fixtureDirectory));
  const payloads: [string, Buffer, boolean, boolean][] = [
    ['empty-eof', Buffer.alloc(0), false, false],
    ['all-bytes-and-nul', Buffer.from(Array.from({ length: 256 }, (_, i) => i)), false, false],
    ['utf8-body', Buffer.from('任务控制输入\0' + invocation), false, false],
    ['128kib-input', Buffer.from(Array.from({ length: 131072 }, (_, i) => i % 256)), false, false],
    ['copy-before-await', Buffer.from('原始输入\0' + invocation), true, false],
    ['nonzero-output-preserved', Buffer.from('非零输入'), false, true],
  ];
  for (const [name, input, mutate, nonzero] of payloads) {
    const runId = randomUUID(), expected = { length: input.length, sha256: digest(input) };
    const operation = guestTask(machines, vmId, '/usr/bin/python3 -I -S -c ' + quote(inputHelper) + (nonzero ? ' nonzero' : ''),
      new AbortController().signal, undefined, 15_000, undefined, undefined, { input, runId });
    if (mutate) input.fill(0);
    const result = await operation, actual = JSON.parse(result.stdout);
    assert.equal(result.code, nonzero ? 23 : 0); assert.equal(result.stderr, nonzero ? 'owned-input-exit\n' : '');
    assert.equal(actual.length, expected.length); assert.equal(actual.sha256, expected.sha256);
    assert.equal(actual.cgroup, '0::/sakura-task-' + runId);
    await absent(runId); check(name, { runId, expected, actual, exitCode: result.code, controlRetired: true });
  }
  const execInput = machines.execInput.bind(machines); let attempted = 0;
  machines.exec = /** 计数实际进入 root 传输的调用并原样转发参数和结果，用于证明预检拒绝路径完全没有发出 exec/execInput。
 * Count calls actually entering root transport and forward arguments/results unchanged, proving preflight refusal paths never issue exec/execInput. */ async (...args) => { attempted++; return nativeExec(...args); };
  machines.execInput = /** 计数实际进入 root 传输的调用并原样转发参数和结果，用于证明预检拒绝路径完全没有发出 exec/execInput。
 * Count calls actually entering root transport and forward arguments/results unchanged, proving preflight refusal paths never issue exec/execInput. */ async (...args) => { attempted++; return execInput(...args); };
  try {
    await assert.rejects(guestTask(machines, vmId, 'true', new AbortController().signal, undefined,
      15_000, undefined, undefined, { input: Buffer.alloc(131073) }), { code: 'GUEST_INPUT_INVALID' });
    assert.equal(attempted, 0); check('oversize-refused-before-control', { attempted });
  } finally { machines.exec = nativeExec; machines.execInput = execInput; }

  const runId = randomUUID(), paths = guestTaskControlPaths(runId), started = fixtureDirectory + '/started.json';
  const waitScript = `import json,os,signal,time\nassert open('/proc/self/cgroup').read().strip()==${JSON.stringify('0::/sakura-task-' + runId)}\n` +
    `if os.fork()==0:\n os.setsid()\n signal.signal(signal.SIGTERM,signal.SIG_IGN)\n` +
    ` with open(${JSON.stringify(started)},'w') as stream:json.dump({'pid':os.getpid(),'cgroup':open('/proc/self/cgroup').read().strip()},stream)\n` +
    ` while True:time.sleep(1)\ntime.sleep(600)`;
  abort = new AbortController();
  active = guestTask(machines, vmId, '/usr/bin/python3 -I -S -c ' + quote(waitScript), abort.signal,
    undefined, 30_000, undefined, undefined, { runId });
  const outcome = active.then(() => ({ rejected: false }), error => ({ rejected: true, message: String(error) }));
  for (let attempt = 0; attempt < 150; attempt++) {
    if ((await nativeExec(vmId, 'test -f ' + quote(started), 5000)).code === 0) break;
    await delay(50);
  }
  const child = JSON.parse(await run('cat ' + quote(started)));
  const recordsScript = `import json,os,stat\nroot=${JSON.stringify(guestTaskControlRoot)}\ndirectory=${JSON.stringify(paths.directory)}\n` +
    `for path in [root,directory]:\n s=os.lstat(path);assert stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700\n` +
    `files=[]\nfor name in os.listdir(directory):\n p=directory+'/'+name;s=os.lstat(p)\n assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1\n files.append(name)\n` +
    `print(json.dumps({'directory':directory,'files':sorted(files),'owner':open(directory+'/owner').read(),'receipt':open(${JSON.stringify(paths.receipt)}).read()}))`;
  const metadata = JSON.parse(await run('/usr/bin/python3 -I -S -c ' + quote(recordsScript)));
  assert.equal(metadata.owner.trim().split(/\s+/).length, 3);
  assert.equal(metadata.receipt.trim().split(/\s+/)[6], 'sakura-task-' + runId);
  check('root0700-controls-and-root0600-records', metadata);
  const restricted = await run('/usr/bin/python3 -I -S -c ' + quote(
    `import os\nos.setgroups([]);os.setgid(65534);os.setuid(65534)\n` +
    `for path in [${JSON.stringify(guestTaskControlRoot)},${JSON.stringify(paths.directory)}]:\n` +
    ` try:os.listdir(path)\n except PermissionError:continue\n raise AssertionError('private control directory was accessible')\nprint(os.getuid())`));
  assert.equal(restricted, '65534'); check('unprivileged-uid-cannot-open-private-controls', { uid: 65534 });

  const extra = fixtureDirectory + '/collision-must-not-run';
  await assert.rejects(guestTask(machines, vmId, 'printf bad > ' + quote(extra), new AbortController().signal,
    undefined, 10_000, undefined, undefined, { runId }), { code: 'GUEST_TASK_CLEANUP_FAILED' });
  assert.equal((await nativeExec(vmId, 'test -e ' + quote(extra), 5000)).code, 1);
  assert.equal(await run('cat ' + quote(paths.directory + '/owner')), metadata.owner.trim());
  await run('kill -0 ' + child.pid);
  check('concurrent-run-id-cannot-adopt-existing-controls', { runId, originalOwnerPreserved: true, originalChildAlive: true });

  abort.abort(); assert.equal((await outcome).rejected, true); active = undefined; abort = undefined;
  await absent(runId);
  await run('/usr/bin/python3 -I -S -c ' + quote(`import os\ntry:\n state=open('/proc/${child.pid}/stat').read().rsplit(') ',1)[1].split()[0]\n assert state in ['Z','X']\nexcept FileNotFoundError:pass`));
  check('cancel-removes-descendant-scope-and-private-controls', { runId, child, controlRetired: true });

  const acknowledgementRun = randomUUID(); let retirements = 0, callbacks = 0;
  machines.exec = (/** 先真实完成退役命令，仅第一次故意丢失确认回包；重试应依靠原票据幂等验收，不能重复创建权限或把传输失败当成未执行。
 * Execute retirement for real, then lose only the first acknowledgement deliberately; retries must validate idempotently by original receipt instead of issuing fresh authority or assuming transport failure means no execution. */ async (...args: Parameters<typeof nativeExec>) => {
    const result = await nativeExec(...args);
    if (args[1].startsWith('# SAKURA_GUEST_TASK_RETIRE\n') && ++retirements === 1)
      throw new Error('Owned retirement acknowledgement lost after successful execution');
    return result;
  }) as typeof machines.exec;
  try {
    const result = await guestTask(machines, vmId, 'printf owned-status; exit 23', new AbortController().signal,
      undefined, 10_000, undefined, async () => { callbacks++; }, { runId: acknowledgementRun });
    assert.equal(result.code, 23); assert.equal(result.stdout, 'owned-status');
    assert.equal(retirements, 2); assert.equal(callbacks, 1); await absent(acknowledgementRun);
    check('lost-retirement-acknowledgement-is-idempotent', { runId: acknowledgementRun, retirements, callbacks });
  } finally { machines.exec = nativeExec; }
  // Delete only files this invocation created in its verified private directory.
  await run('test "$(stat -c %u:%g:%a ' + quote(fixtureDirectory) + ')" = 0:0:700\n' +
    'rm -- ' + quote(started) + '\nrmdir -- ' + quote(fixtureDirectory));
  proof.cleanup.fixtureRemoved = true;
} catch (error) {
  proof.error = error instanceof Error ? error.stack : String(error); console.error(proof.error);
} finally {
  abort?.abort();
  if (active) await active.catch(() => {});
  machines.exec = nativeExec;
  if (initialized && machines.live.has(vmId)) {
    try { await run('/bin/sync'); proof.cleanup.synced = true; }
    catch (error) { proof.cleanup.syncError = String(error); }
  }
  try {
    if (initialized) {
      const done = machines.live.get(vmId)?.done; await machines.stop(vmId, true); if (done) await done;
      proof.cleanup.vmStopped = machines.state(vmId) === 'stopped' && machines.live.size === 0;
    }
    await machines.close(); proof.cleanup.closed = true;
  } catch (error) { proof.cleanup.error = String(error); }
  proof.sourceUnchanged = true;
  for (const [file, expected] of Object.entries(sources))
    if (digest(await readFile(join(workspace, file))) !== expected) proof.sourceUnchanged = false;
  proof.previousEvidenceUnchanged = digest(await readFile(priorFile)) === digest(priorBytes);
  proof.cleanup.exactQemuMatches = exactQemu(); proof.completedAt = new Date().toISOString();
  proof.passed = !proof.error && proof.checks.length === 12 && proof.sourceUnchanged && proof.previousEvidenceUnchanged &&
    proof.cleanup.fixtureRemoved && proof.cleanup.synced && proof.cleanup.vmStopped && proof.cleanup.closed &&
    !proof.cleanup.error && proof.cleanup.exactQemuMatches === 0;
  await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ proof: proofFile, passed: proof.passed, checks: proof.checks.length, vmStopped: proof.cleanup.vmStopped }));
  if (!proof.passed) process.exitCode = 1;
}
