import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// This script only borrows the explicitly released, stopped, single-VM fixture.
assert.equal(process.argv.length, 3, 'Pass the stopped owned Debian guest-task fixture.');
assert.ok(process.execArgv.includes('--no-addons'), 'Use node --no-addons --import tsx.');
assert.ok(process.execArgv.includes('--import') && process.execArgv.includes('tsx'));
const parent = await realpath(resolve('.data/network-remaining-test-temp'));
const root = await realpath(resolve(process.argv[2]));
assert.equal(dirname(root), parent);
assert.equal(basename(root), 'sakura-guest-task-i24quD');
const expectedVmId = '645d78d1-2848-4665-b2c1-e47903525834';
const priorPath = join(root, 'project-main-scope-evidence.json');
const priorBytes = await readFile(priorPath);
const prior = JSON.parse(priorBytes.toString('utf8'));
assert.equal(prior.fixture, root);
assert.equal(prior.vmId, expectedVmId);
assert.equal(prior.distro, 'debian');
assert.equal(prior.vmStopped, true);
assert.equal(prior.error, undefined);
assert.equal(prior.cases.length, 26);
const records = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
assert.ok(Array.isArray(records));
assert.equal(records.length, 1);
assert.equal(records[0].id, prior.vmId);
assert.equal(records[0].name, 'guest-task-cgroup-smoke');
assert.equal(records[0].distro, 'debian');
assert.equal(records[0].bootstrapped, true);
assert.equal(records[0].storagePoolId, undefined);
assert.equal(records[0].sandbox, undefined);
assert.equal(records[0].haPromotion, undefined);
assert.equal(records[0].haRetirement, undefined);
assert.equal(records[0].lastError, undefined);
const machineDirectory = await realpath(join(root, 'machines', expectedVmId));
assert.equal(dirname(machineDirectory), await realpath(join(root, 'machines')));
assert.equal(dirname(dirname(machineDirectory)), root);
assert.equal(dirname(await realpath(join(machineDirectory, 'disk.qcow2'))), machineDirectory);
const proofPath = join(root, 'command-input-evidence.json');
await assert.rejects(readFile(proofPath), { code: 'ENOENT' }, 'Keep any earlier proof intact.');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const machinesSource = resolve('server/machines.ts');
const machinesSourceSha256 = sha256(await readFile(machinesSource));
const mainSources = [
  'server/project-main.ts',
  'server/project-service-scope.ts',
  'server/project-services.ts',
  'server/workspaces.ts',
];
assert.deepEqual(Object.keys(prior.sourceSha256).sort(), mainSources.sort());
for (const source of mainSources)
  assert.equal(sha256(await readFile(resolve(source))), prior.sourceSha256[source], source);

process.env.TEMP = process.env.TMP = parent;
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/debian-12.qcow2');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { quote } = await import('../server/files.ts');
const { DATA, VM_ROOT } = await import('../server/model.ts');
assert.equal(await realpath(DATA), root);
assert.equal(await realpath(VM_ROOT), dirname(machineDirectory));

const maxInput = 128 * 1024;
const helper = [
  'import hashlib,json,sys',
  `data=sys.stdin.buffer.read(${maxInput + 1})`,
  `assert len(data)<=${maxInput},'owned helper input bound exceeded'`,
  "print(json.dumps({'length':len(data),'sha256':hashlib.sha256(data).hexdigest()},sort_keys=True,separators=(',',':')),flush=True)",
  "if len(sys.argv)>1 and sys.argv[1]=='nonzero':",
  " sys.stderr.write('owned-command-input-stderr\\n');sys.stderr.flush();sys.exit(23)",
].join('\n');
const command = '/usr/bin/python3 -I -S -c ' + quote(helper);
const proof: {
  version: number;
  runId: string;
  startedAt: string;
  fixture: string;
  vmId: string;
  distro: string;
  client: { node: string; platform: string; arch: string; execArgv: string[]; noAddons: boolean };
  prior: { path: string; sha256: string; caseCount: number; vmStopped: boolean };
  sourceSha256: Record<string, string>;
  helper: { sha256: string; maxRead: number; readOnly: boolean; printsBody: boolean };
  checks: Record<string, unknown>[];
  cleanup: Record<string, unknown>;
  error?: string;
  sourceUnchanged?: boolean;
  completedAt?: string;
  passed?: boolean;
} = {
  version: 1,
  runId: randomUUID(),
  startedAt: new Date().toISOString(),
  fixture: root,
  vmId: expectedVmId,
  distro: 'debian',
  client: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    execArgv: process.execArgv,
    noAddons: true,
  },
  prior: { path: priorPath, sha256: sha256(priorBytes), caseCount: prior.cases.length, vmStopped: true },
  sourceSha256: {
    'server/machines.ts': machinesSourceSha256,
    'scripts/smoke-command-input.ts': sha256(await readFile(resolve('scripts/smoke-command-input.ts'))),
  },
  helper: { sha256: sha256(Buffer.from(helper)), maxRead: maxInput + 1, readOnly: true, printsBody: false },
  checks: [],
  cleanup: {},
};
const machines = new Machines(await createRuntime());
let initialized = false;
const check = (value: Record<string, unknown>) => {
  proof.checks.push({ ...value, passed: true });
  console.log('PASS ' + value.name);
};
const metadata = (bytes: Buffer) => ({ length: bytes.length, sha256: sha256(bytes) });
async function roundtrip(name: string, payload: Buffer, mutateAfterCall = false, nonzero = false) {
  const expected = metadata(payload);
  const chunks: string[] = [];
  const pending = machines.execInput(
    expectedVmId,
    command + (nonzero ? ' nonzero' : ''),
    payload,
    15000,
    undefined,
    (value) => chunks.push(value),
  );
  if (mutateAfterCall) payload.fill(0xa5);
  const result = await pending;
  assert.equal(result.code, nonzero ? 23 : 0, name);
  assert.equal(result.stdout, JSON.stringify(expected) + '\n', name);
  assert.deepEqual(JSON.parse(result.stdout), expected, name);
  assert.equal(result.stderr, nonzero ? 'owned-command-input-stderr\n' : '', name);
  const output = chunks.join('');
  assert.ok(output.includes(result.stdout), 'Output callback must preserve stdout: ' + name);
  if (nonzero) assert.ok(output.includes(result.stderr), 'Output callback must preserve stderr.');
  if (mutateAfterCall) assert.notEqual(sha256(payload), expected.sha256);
  check({
    name,
    expected,
    received: JSON.parse(result.stdout),
    exitCode: result.code,
    stderr: result.stderr,
    outputCallbackPreserved: true,
    callerBufferMutated: mutateAfterCall,
    inputAbsentFromCommand: true,
    realSshChannel: true,
  });
}
try {
  await machines.init();
  initialized = true;
  assert.equal(machines.records.size, 1);
  assert.equal(machines.get(expectedVmId).name, records[0].name);
  assert.equal(machines.state(expectedVmId), 'stopped');
  assert.equal(machines.live.size, 0);
  check({ name: 'owned-single-debian-main26-stopped-preflight', mainCases: 26 });

  // The trap only instruments this new Machines instance while its VM is stopped.
  // It proves execInput rejects before even attempting its actual connect entry.
  const originalConnect = machines.connect;
  let connectionAttempts = 0;
  machines.connect = async () => {
    ++connectionAttempts;
    throw new Error('Oversize input attempted SSH.');
  };
  try {
    await assert.rejects(machines.execInput(expectedVmId, command, Buffer.alloc(maxInput + 1)), {
      status: 413,
      code: 'GUEST_INPUT_INVALID',
    });
    assert.equal(connectionAttempts, 0);
    check({
      name: 'oversize-rejected-before-ssh-connect',
      inputLength: maxInput + 1,
      connectionAttempts,
      status: 413,
      code: 'GUEST_INPUT_INVALID',
      realSshChannel: false,
    });
  } finally {
    machines.connect = originalConnect;
  }

  console.log('Starting exclusively owned Debian fixture ' + expectedVmId);
  await machines.start(expectedVmId);
  const deadline = Date.now() + 270000;
  while (machines.state(expectedVmId) !== 'running') {
    assert.ok(Date.now() < deadline, 'Owned Debian fixture startup timed out.');
    assert.equal(machines.state(expectedVmId), 'starting', 'Owned Debian fixture startup failed.');
    await delay(300);
  }
  const availability = await machines.exec(expectedVmId, 'test -x /usr/bin/python3', 10000);
  assert.equal(
    availability.code,
    0,
    'The existing fixture must already have Python; no installation is performed.',
  );
  await roundtrip('embedded-nul', Buffer.concat([Buffer.from(randomUUID()), Buffer.from([0, 0, 1, 0])]));
  await roundtrip('all-256-byte-values', Buffer.from(Array.from({ length: 256 }, (_, index) => index)));
  await roundtrip('utf8-chinese-and-nul', Buffer.from('专属命令输入验证\0中文测试 ' + randomUUID(), 'utf8'));
  const maximum = Buffer.alloc(maxInput);
  for (let index = 0; index < maximum.length; ++index) maximum[index] = index % 256;
  await roundtrip('exact-128kib-maximum', maximum);
  await roundtrip('snapshot-before-first-await', Buffer.from('原始副本\0' + randomUUID()), true);
  await roundtrip('empty-input-delivers-eof', Buffer.alloc(0));
  await roundtrip(
    'nonzero-exit-retains-stdout-and-stderr',
    Buffer.from('非零退出验证 ' + randomUUID()),
    false,
    true,
  );
} catch (error) {
  proof.error = error instanceof Error ? error.message : String(error);
  console.error(proof.error);
} finally {
  // Never touch another machine or a guest PID. Stop is confined to the sole fixture.
  if (initialized && machines.live.has(expectedVmId)) {
    try {
      const result = await machines.exec(expectedVmId, 'sync', 15000);
      assert.equal(result.code, 0, 'Owned guest sync failed.');
      proof.cleanup.synced = true;
    } catch (error) {
      proof.cleanup.syncError = error instanceof Error ? error.message : String(error);
    }
  }
  try {
    if (initialized) {
      const ownedExit = machines.live.get(expectedVmId)?.done;
      await machines.stop(expectedVmId, true);
      if (ownedExit) {
        await ownedExit;
        proof.cleanup.ownedQemuExitResolved = true;
      }
      assert.equal(machines.live.size, 0);
      assert.equal(machines.state(expectedVmId), 'stopped');
      proof.cleanup.forceStopped = true;
    }
  } catch (error) {
    proof.cleanup.stopError = error instanceof Error ? error.message : String(error);
  }
  try {
    await machines.close();
    proof.cleanup.closed = true;
  } catch (error) {
    proof.cleanup.closeError = error instanceof Error ? error.message : String(error);
  }
  proof.cleanup.liveCount = machines.live.size;
  proof.cleanup.vmStopped =
    initialized && machines.live.size === 0 && machines.state(expectedVmId) === 'stopped';
  proof.sourceUnchanged = sha256(await readFile(machinesSource)) === machinesSourceSha256;
  proof.completedAt = new Date().toISOString();
  proof.passed =
    !proof.error &&
    proof.checks.length === 9 &&
    proof.sourceUnchanged &&
    proof.cleanup.synced === true &&
    proof.cleanup.forceStopped === true &&
    proof.cleanup.closed === true &&
    proof.cleanup.ownedQemuExitResolved === true &&
    proof.cleanup.vmStopped === true &&
    !proof.cleanup.syncError &&
    !proof.cleanup.stopError &&
    !proof.cleanup.closeError;
  await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      proof: proofPath,
      passed: proof.passed,
      checks: proof.checks.length,
      vmStopped: proof.cleanup.vmStopped,
      liveCount: machines.live.size,
    }),
  );
  if (!proof.passed) process.exitCode = 1;
}
