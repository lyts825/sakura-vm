import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

// Each invocation creates a fresh, single-VM fixture. It never accepts or
// resumes an existing data directory. Retain disks, serial logs and failed
// proofs so a failed persistence check can be inspected without reprovisioning.
assert.equal(process.argv.length, 3, 'Usage: node --no-addons --import tsx scripts/smoke-boot-persistence.ts alpine|debian|ubuntu');
const distro = process.argv[2] as 'alpine' | 'debian' | 'ubuntu';
assert.ok(['alpine', 'debian', 'ubuntu'].includes(distro));
assert.equal(process.platform, 'win32', 'This smoke records Windows-owned QEMU process evidence.');
const repository = resolve('.');
const parentPath = resolve('.data/boot-persistence-test-temp');
await mkdir(parentPath, { recursive: true });
const parent = await realpath(parentPath);
process.env.TEMP = process.env.TMP = parent;
const fixture = await realpath(await mkdtemp(join(parent, 'sakura-boot-persistence-')));
assert.equal(dirname(fixture), parent);
assert.match(basename(fixture), /^sakura-boot-persistence-[A-Za-z0-9_-]+$/);
process.env.SAKURA_DATA_DIR = fixture;
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
process.env.SAKURA_IMAGE_PATH = join(process.env.SAKURA_IMAGE_DIR, {
  alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2',
}[distro]);
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { vmDir } = await import('../server/model.ts');
const runFile = promisify(execFile);
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const sources = ['server/machines.ts', 'server/seed.ts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async source =>
  [source, sha256(await readFile(join(repository, source)))])));
const publicText = (privateKey: Buffer) => {
  const key = createPublicKey(createPrivateKey(privateKey)).export({ format: 'jwk' });
  const field = (value: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(value.length);
    return Buffer.concat([length, value]);
  };
  const mpint = (value: string) => {
    const bytes = Buffer.from(value, 'base64url');
    return field(bytes[0] & 128 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
  };
  return 'ssh-rsa ' + Buffer.concat([
    field(Buffer.from('ssh-rsa')), mpint(key.e!), mpint(key.n!),
  ]).toString('base64') + ' sakura';
};
type Event = { sequence: number; at: string; milliseconds: number; event: string; round?: number };
const proof: any = {
  version: 1, distro, fixture, startedAt: new Date().toISOString(),
  client: { node: process.version, execArgv: process.execArgv, platform: process.platform },
  sourceSha256: await sourceHashes(), scriptSha256: sha256(await readFile(join(repository, 'scripts/smoke-boot-persistence.ts'))),
  observation: 'Only append read-only boot_id output to the existing initialization SSH script, before running; no additional sync or first-running SSH command.',
  events: [] as Event[], rounds: [], controllers: [], qemuExecutions: [], cleanup: [],
};
const stamp = (event: string, round?: number) => {
  const entry: Event = { sequence: proof.events.length + 1, at: new Date().toISOString(),
    milliseconds: performance.now(), event, ...(round ? { round } : {}) };
  proof.events.push(entry); return entry;
};
const saveProof = () => writeFile(join(fixture, 'boot-persistence-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
const ownedProcesses = async () => {
  // The environment carries a literal path; no command is constructed from it.
  // Query only QEMU and match this new fixture, never a name or a guessed PID.
  const query = "$ErrorActionPreference='Stop'; @((Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'qemu-system-*' -and $_.CommandLine -and $_.CommandLine.Contains($env:SAKURA_BOOT_FIXTURE_NEEDLE) }) | Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine) | ConvertTo-Json -Depth 4 -Compress";
  const result = await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
    env: { ...process.env, SAKURA_BOOT_FIXTURE_NEEDLE: fixture }, timeout: 30000, maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  const data = JSON.parse(result.stdout.trim() || '[]');
  return Array.isArray(data) ? data : [data];
};
let machines: InstanceType<typeof Machines> | undefined;
let id = '', expectedKey = '', expectedPrivateHash = '', expectedSeedHash = '';
let currentRound: any;
let generation = 0, explicitGuestCommands = 0;
const marker = distro === 'alpine' ? '/var/lib/cloud/.bootstrap-complete' : '/var/lib/cloud/instance/boot-finished';
const hostname = 'boot-persistence-' + distro;
const controller = async () => {
  const engine = await createRuntime();
  const nativeRun = engine.run.bind(engine);
  engine.run = (async (...args: Parameters<typeof nativeRun>) => {
    if (args[0] !== 'sakura-qemu' || !args[1].some(value => value.includes(fixture))) return nativeRun(...args);
    const execution: any = { generation, round: currentRound?.number, tool: args[0],
      argvSha256: sha256(JSON.stringify(args[1])), started: stamp('owned-qemu-run-started', currentRound?.number), settled: false };
    proof.qemuExecutions.push(execution);
    try { return await nativeRun(...args); }
    catch (error) { execution.error = String(error); throw error; }
    finally { execution.settled = true; execution.ended = stamp('owned-qemu-run-settled', execution.round); }
  }) as typeof engine.run;
  machines = new Machines(engine);
  await machines.init();
  generation++;
  proof.controllers.push({ generation, initialized: stamp('machines-initialized'),
    records: [...machines.records.values()].map(value => ({ id: value.id, name: value.name, distro: value.distro })),
    engine: engine.version });
  const nativeExec = machines.exec.bind(machines);
  machines.exec = async (...args: Parameters<typeof nativeExec>) => {
    assert.equal(args[0], id, 'Only this fresh fixture may execute guest commands.');
    const boot = args[1].includes('test -f ' + marker) && args[1].includes('/bin/sync');
    const command: any = { kind: boot ? 'product-initialization' : 'smoke-read-only-verification',
      originalSha256: sha256(args[1]), started: stamp('guest-command-started', currentRound?.number),
      stateBefore: machines!.state(id), productSync: boot };
    currentRound.commands.push(command);
    if (!boot) {
      explicitGuestCommands++;
      assert.ok(currentRound.number > 1, 'No extra SSH command is allowed on the first running boot.');
      assert.equal(args[1], verificationCommand, 'Only the fixed read-only verification script is allowed.');
    }
    // Append to this same SSH command, only on successful initialization. Keep
    // its original status/stdout. The observation happens before running and
    // neither writes guest files nor creates another SSH connection or sync.
    const suffix = '\nsakura_smoke_status=$?\nif [ "$sakura_smoke_status" = 0 ]; then\n printf "\\nSAKURA_SMOKE_BOOT_ID="\n cat /proc/sys/kernel/random/boot_id\nfi\nexit "$sakura_smoke_status"\n';
    const result = await nativeExec(args[0], args[1] + (boot ? suffix : ''), ...args.slice(2) as [number?, AbortSignal?, ((data: string) => void)?, string?]);
    command.completed = stamp('guest-command-completed', currentRound?.number);
    command.code = result.code;
    if (!boot || result.code !== 0) return result;
    const found = /\nSAKURA_SMOKE_BOOT_ID=([a-f0-9-]{36})\r?\n$/.exec(result.stdout);
    assert.ok(found, 'Initialization did not return an observed boot ID.');
    currentRound.observedBootId = found[1];
    command.bootId = found[1];
    return { ...result, stdout: result.stdout.slice(0, found.index) };
  };
  return machines;
};
const verificationCommand = `set -e
printf 'ROOT_UID='; id -u
printf 'BOOT_ID='; cat /proc/sys/kernel/random/boot_id
printf 'HOSTNAME='; hostname
printf 'HOSTNAME_FILE='; cat /etc/hostname
printf 'AUTHORIZED_KEYS_BEGIN\\n'; cat /root/.ssh/authorized_keys; printf 'AUTHORIZED_KEYS_END\\n'
test -f ${marker}; printf 'CLOUD_INIT_COMPLETE=true\\n'
test -d /workspace; printf 'WORKSPACE_EXISTS=true\\n'
`;
const checkReloadedIdentity = async () => {
  assert.equal(machines!.records.size, 1);
  const record = machines!.get(id);
  assert.equal(record.name, hostname); assert.equal(record.distro, distro);
  assert.equal(machines!.state(id), 'stopped');
  assert.equal(sha256(await readFile(join(vmDir(id), 'id_rsa'))), expectedPrivateHash);
  assert.equal(sha256(await readFile(join(vmDir(id), 'seed.iso'))), expectedSeedHash);
  return { singleRecord: true, vmId: id, hostname, privateKeyUnchanged: true, seedUnchanged: true };
};
const forceStop = (round: any) => {
  round.forceStopRequested = stamp('force-stop-requested', round.number);
  round.guestCommandsAtStop = explicitGuestCommands;
  return machines!.stop(id, true).then(() => {
    round.forceStopCompleted = stamp('force-stop-completed', round.number);
    round.liveRemoved = !machines!.live.has(id);
    round.stateAfterStop = machines!.state(id);
    assert.equal(round.liveRemoved, true); assert.equal(round.stateAfterStop, 'stopped');
  });
};
const start = async (round: any, stopImmediately: boolean) => {
  currentRound = round;
  const ownMachines = machines!;
  let settled = false;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {}); // A host process query can finish after a boot failure.
  const changed = () => {
    if (settled) return;
    const state = ownMachines.state(id);
    if (state === 'running') {
      settled = true;
      round.running = stamp('first-running-notification', round.number);
      round.guestCommandsAtRunning = explicitGuestCommands;
      // Issue stop in the actual readiness listener before yielding, writing a
      // proof/log or querying the host/guest. These checkpoints follow stop.
      if (stopImmediately) forceStop(round).then(resolveReady, rejectReady);
      else resolveReady();
    } else if (state === 'error' || state === 'stopped') {
      settled = true; rejectReady(new Error('Boot ended before running: ' + ownMachines.logs.get(id)));
    }
  };
  ownMachines.on('change', changed);
  const timer = setTimeout(() => {
    if (!settled) { settled = true; rejectReady(new Error('Boot did not become running within 270 seconds.')); }
  }, 270000);
  try {
    round.startRequested = stamp('start-requested', round.number);
    await ownMachines.start(id);
    round.ownedQemuDuringStart = await ownedProcesses();
    await ready;
    assert.match(round.observedBootId, /^[a-f0-9-]{36}$/);
    if (round.number > 1) assert.notEqual(round.observedBootId, proof.rounds[round.number - 2].observedBootId);
    if (stopImmediately) {
      assert.equal(round.guestCommandsAtRunning, 0); assert.equal(round.guestCommandsAtStop, 0);
      assert.equal(round.forceStopRequested.sequence, round.running.sequence + 1);
      round.readyToForceStopMilliseconds = round.forceStopRequested.milliseconds - round.running.milliseconds;
      assert.equal(round.commands.some((command: any) => command.stateBefore === 'running'), false);
    }
  } finally { clearTimeout(timer); ownMachines.off('change', changed); }
};
const stopEvidence = async (round: any) => {
  round.ownedQemuAfterStop = await ownedProcesses();
  assert.equal(round.ownedQemuAfterStop.length, 0, 'This owned fixture still has a QEMU process.');
  const executions = proof.qemuExecutions.filter((execution: any) => execution.round === round.number);
  assert.equal(executions.length, 1); assert.equal(executions[0].settled, true);
  await writeFile(join(fixture, `boot-round-${round.number}.serial.log`), machines!.logs.get(id) || '');
  await machines!.close();
  round.closed = stamp('machines-closed', round.number);
  proof.cleanup.push({ round: round.number, liveRemoved: true, qemuExecutionSettled: true, ownedQemuCount: 0,
    runtimeClosed: true, at: round.closed.at });
  machines = undefined;
  await saveProof();
};
console.log('Fresh owned ' + distro + ' boot persistence fixture: ' + fixture);
await saveProof();
try {
  await controller();
  assert.equal(machines!.records.size, 0, 'Fresh fixture unexpectedly contains a VM.');
  const vm = await machines!.create({ name: hostname, distro, memoryMiB: 1024, cpus: 2,
    diskGiB: 8, accelerator: 'auto', forwards: [] });
  id = vm.id; proof.vmId = id;
  assert.equal(machines!.records.size, 1); assert.equal(dirname(vmDir(id)), join(fixture, 'machines'));
  const key = await readFile(join(vmDir(id), 'id_rsa'));
  expectedKey = publicText(key); expectedPrivateHash = sha256(key);
  expectedSeedHash = sha256(await readFile(join(vmDir(id), 'seed.iso')));
  proof.expected = { hostname, publicKeySha256: sha256(expectedKey), privateKeySha256: expectedPrivateHash,
    seedSha256: expectedSeedHash, cloudInitMarker: marker, workspace: '/workspace' };
  await saveProof();
  for (let number = 1; number <= 3; ++number) {
    const round: any = { number, generation: number, commands: [] };
    proof.rounds.push(round);
    if (number > 1) { await controller(); round.reloadedIdentity = await checkReloadedIdentity(); }
    await start(round, number === 1);
    if (number > 1) {
      const result = await machines!.exec(id, verificationCommand, 10000);
      // Stop immediately after the read-only response; parse/check on the host
      // after issuing it, with no guest writes or synchronization by the smoke.
      const stopped = forceStop(round);
      void stopped.catch(() => {}); // Finally also waits for this owned stop if a check fails.
      assert.equal(result.code, 0, result.stderr);
      const get = (name: string) => new RegExp('^' + name + '=([^\\r\\n]+)', 'm').exec(result.stdout)?.[1];
      const keys = /AUTHORIZED_KEYS_BEGIN\r?\n([\s\S]*?)AUTHORIZED_KEYS_END/.exec(result.stdout)?.[1].trim();
      assert.equal(get('ROOT_UID'), '0'); assert.equal(get('BOOT_ID'), round.observedBootId);
      assert.equal(get('HOSTNAME'), hostname); assert.equal(get('HOSTNAME_FILE'), hostname);
      assert.equal(keys, expectedKey);
      assert.equal(get('CLOUD_INIT_COMPLETE'), 'true'); assert.equal(get('WORKSPACE_EXISTS'), 'true');
      round.checks = { rootSsh: true, rootUid: 0, bootId: get('BOOT_ID'), changedBootId: true,
        hostname: get('HOSTNAME'), hostnameFile: get('HOSTNAME_FILE'),
        authorizedKeysSha256: sha256(keys!), authorizedKeysMatchFixedHostKey: true,
        cloudInitComplete: true, workspaceExists: true };
      await stopped;
    }
    await stopEvidence(round);
    console.log(distro + ' round ' + number + ' passed; owned QEMU stopped and controller closed.');
  }
  proof.sourceSha256After = await sourceHashes();
  assert.deepEqual(proof.sourceSha256After, proof.sourceSha256, 'Production source changed during the smoke.');
  proof.vmStopped = true; proof.passed = true; proof.finishedAt = new Date().toISOString();
} catch (error) {
  proof.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  process.exitCode = 1;
} finally {
  if (machines) {
    try {
      if (id && machines.live.has(id)) { stamp('failure-force-stop-requested', currentRound?.number); await machines.stop(id, true); }
      if (id) await writeFile(join(fixture, 'failure.serial.log'), machines.logs.get(id) || '');
      await machines.close();
      proof.failureControllerClosed = true;
    } catch (error) { proof.cleanupError = String(error); process.exitCode = 1; }
  }
  try {
    proof.finalOwnedQemu = await ownedProcesses();
    assert.equal(proof.finalOwnedQemu.length, 0, 'Owned QEMU survived final cleanup.');
    proof.vmStopped = !!id && proof.finalOwnedQemu.length === 0 && (!machines || !machines.live.has(id));
  } catch (error) { proof.finalCleanupError = String(error); process.exitCode = 1; }
  proof.sourceSha256After ||= await sourceHashes();
  proof.finishedAt ||= new Date().toISOString();
  await saveProof();
}
console.log(JSON.stringify({ distro, fixture, vmId: id, passed: proof.passed === true, vmStopped: proof.vmStopped,
  proof: join(fixture, 'boot-persistence-evidence.json'), error: proof.error, cleanupError: proof.cleanupError,
  finalCleanupError: proof.finalCleanupError }));
