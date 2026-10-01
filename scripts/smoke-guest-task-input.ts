import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.argv.length, 3, 'Pass the released Debian boot-persistence fixture.');
assert.ok(process.execArgv.includes('--no-addons') && process.execArgv.includes('tsx'));
const parent = await realpath(resolve('.data/boot-persistence-test-temp'));
const root = await realpath(resolve(process.argv[2]));
assert.equal(dirname(root), parent); assert.equal(basename(root), 'sakura-boot-persistence-53hCt6');
const prior = JSON.parse(await readFile(join(root, 'boot-persistence-evidence.json'), 'utf8'));
const vmId = '24230cbf-609b-4823-a6b4-9f599a122dc8';
assert.equal(prior.vmId, vmId); assert.equal(prior.passed, true); assert.equal(prior.vmStopped, true);
assert.equal(prior.rounds.length, 3); assert.equal(prior.distro, 'debian');
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.equal(records.length, 1); assert.equal(records[0].id, vmId); assert.equal(records[0].distro, 'debian');
const proofPath = join(root, 'guest-task-input-evidence.json');
await assert.rejects(readFile(proofPath), { code: 'ENOENT' });
process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root; process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/debian-12.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { quote } = await import('../server/files.ts');
const { guestTask } = await import('../server/guest-task.ts');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const sourceFiles = ['server/guest-task.ts', 'server/machines.ts', 'scripts/smoke-guest-task-input.ts'];
const sources: Record<string, string> = {};
for (const file of sourceFiles) sources[file] = sha(await readFile(resolve(file)));
const proof: any = { version: 1, vmId, fixture: root, distro: 'debian', client: { node: process.version,
  execArgv: process.execArgv }, startedAt: new Date().toISOString(), sourceSha256: sources, checks: [], cleanup: {} };
const machines = new Machines(await createRuntime());
let initialized = false, marker: string | undefined;
const helper = `import hashlib,json,os,sys\ndata=sys.stdin.buffer.read(131073)\nassert len(data)<=131072\nprint(json.dumps({'length':len(data),'sha256':hashlib.sha256(data).hexdigest(),'cgroup':open('/proc/self/cgroup').read().strip()}),flush=True)\nif len(sys.argv)>1:\n sys.stderr.write('owned-input-exit\\n');sys.exit(23)\n`;
const command = '/usr/bin/python3 -I -S -c ' + quote(helper);
const run = async (script: string) => {
  const result = await machines.exec(vmId, script, 10000);
  assert.equal(result.code, 0, result.stderr); return result.stdout.trim();
};
async function roundtrip(name: string, data: Buffer, mutate = false, nonzero = false) {
  const expected = { length: data.length, sha256: sha(data) }, runId = randomUUID();
  const operation = guestTask(machines, vmId, command + (nonzero ? ' nonzero' : ''),
    new AbortController().signal, undefined, 15000, undefined, undefined, { input: data, runId });
  if (mutate) data.fill(0);
  const result = await operation, actual = JSON.parse(result.stdout);
  assert.equal(result.code, nonzero ? 23 : 0); assert.equal(result.stderr, nonzero ? 'owned-input-exit\n' : '');
  assert.equal(actual.length, expected.length); assert.equal(actual.sha256, expected.sha256);
  assert.equal(actual.cgroup, '0::/sakura-task-' + runId);
  await run(`test ! -e /sys/fs/cgroup/sakura-task-${runId}\n` +
    `test ! -e /tmp/.sakura-job-${runId}.pid.scope\ntest ! -e /tmp/.sakura-job-${runId}.pid`);
  proof.checks.push({ name, runId, expected, actual, exitCode: result.code, scopeRemoved: true, passed: true });
  console.log('passed ' + name);
}
try {
  await machines.init(); initialized = true;
  assert.equal(machines.records.size, 1); assert.equal(machines.state(vmId), 'stopped');
  await machines.start(vmId);
  for (let attempt = 0; machines.state(vmId) === 'starting' && attempt < 600; attempt++) await delay(250);
  assert.equal(machines.state(vmId), 'running'); await run('test -x /usr/bin/python3');
  await roundtrip('empty-eof-through-background-worker', Buffer.alloc(0));
  await roundtrip('all-bytes-and-nul', Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
  await roundtrip('utf8-body', Buffer.from('完整后台标准输入\0' + randomUUID()));
  const maximum = Buffer.alloc(131072); for (let i = 0; i < maximum.length; i++) maximum[i] = i % 256;
  await roundtrip('128kib-input', maximum);
  await roundtrip('copy-before-await', Buffer.from('原始后台副本\0' + randomUUID()), true);
  await roundtrip('nonzero-output-preserved', Buffer.from('非零结果'), false, true);
  const exec = machines.exec.bind(machines), execInput = machines.execInput.bind(machines);
  let attempted = 0;
  machines.exec = async (...args) => { attempted++; return exec(...args); };
  machines.execInput = async (...args) => { attempted++; return execInput(...args); };
  try {
    await assert.rejects(guestTask(machines, vmId, command, new AbortController().signal, undefined,
      15000, undefined, undefined, { input: Buffer.alloc(131073) }), { code: 'GUEST_INPUT_INVALID' });
    assert.equal(attempted, 0);
    proof.checks.push({ name: 'oversize-refused-before-channel-and-receipt', attempted, passed: true });
  } finally { machines.exec = exec; machines.execInput = execInput; }
  const runId = randomUUID(); marker = '/tmp/.sakura-task-input-' + runId + '.json';
  const waitScript = `import hashlib,json,os,signal,sys,time\ndata=sys.stdin.buffer.read(131073)\nassert data==b'owned-cancel-input'\n` +
    `if os.fork()==0:\n os.setsid()\n signal.signal(signal.SIGTERM,signal.SIG_IGN)\n` +
    ` with open(${JSON.stringify(marker)},'w') as stream: json.dump({'pid':os.getpid(),'cgroup':open('/proc/self/cgroup').read().strip()},stream)\n` +
    ` while True: time.sleep(1)\ntime.sleep(600)\n`;
  const abort = new AbortController();
  const operation = guestTask(machines, vmId, '/usr/bin/python3 -I -S -c ' + quote(waitScript),
    abort.signal, undefined, 30000, undefined, undefined, { input: Buffer.from('owned-cancel-input'), runId });
  // Attach rejection handling immediately while waiting for the owned marker.
  const outcome = operation.then(() => ({ rejected: false }), () => ({ rejected: true }));
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await machines.exec(vmId, 'test -f ' + quote(marker), 5000)).code === 0) break;
    await delay(50);
  }
  const child = JSON.parse(await run('cat ' + quote(marker)));
  assert.equal(child.cgroup, '0::/sakura-task-' + runId);
  abort.abort(); assert.equal((await outcome).rejected, true);
  await run(`test ! -e /sys/fs/cgroup/sakura-task-${runId}\ntest ! -e /tmp/.sakura-job-${runId}.pid.scope`);
  await run('/usr/bin/python3 -I -S -c ' + quote(`import os\ntry:\n state=open('/proc/${child.pid}/stat').read().rsplit(') ',1)[1].split()[0]\n assert state in ['Z','X']\nexcept FileNotFoundError: pass\n`));
  await run('rm -- ' + quote(marker)); marker = undefined;
  proof.checks.push({ name: 'cancel-cleans-detached-descendant-and-input-channel', runId, child,
    scopeRemoved: true, receiptRetired: true, passed: true });
} catch (error) {
  proof.error = error instanceof Error ? error.message : String(error); console.error(proof.error);
} finally {
  if (initialized && machines.live.has(vmId)) {
    try { await run('/bin/sync'); proof.cleanup.synced = true; }
    catch (error) { proof.cleanup.syncError = String(error); }
  }
  try {
    if (initialized) {
      const exit = machines.live.get(vmId)?.done; await machines.stop(vmId, true); if (exit) await exit;
      proof.cleanup.vmStopped = machines.state(vmId) === 'stopped' && machines.live.size === 0;
      proof.cleanup.qemuSettled = true;
    }
    await machines.close(); proof.cleanup.closed = true;
  } catch (error) { proof.cleanup.error = String(error); }
  proof.sourceUnchanged = true;
  for (const file of sourceFiles) if (sha(await readFile(resolve(file))) !== sources[file]) proof.sourceUnchanged = false;
  proof.completedAt = new Date().toISOString();
  proof.passed = !proof.error && proof.checks.length === 8 && proof.sourceUnchanged &&
    proof.cleanup.synced && proof.cleanup.vmStopped && proof.cleanup.qemuSettled && proof.cleanup.closed && !proof.cleanup.error;
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ proof: proofPath, passed: proof.passed, checks: proof.checks.length,
    vmStopped: proof.cleanup.vmStopped }));
  if (!proof.passed) process.exitCode = 1;
}
