/** 烟雾验收：验证新建单 VM 的启动持久性、源文件身份与最终 QEMU 关闭证据。
 * Smoke acceptance for a newly owned VM’s boot persistence, exact source identity and final QEMU exit evidence. */
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
/** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
 * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const sources = ['server/machines.ts', 'server/seed.ts'];
/** 并行读取已列源码并返回路径到 SHA-256 映射，供多轮启动前后确认生产实现未改变。
 * Read enumerated sources concurrently and return path-to-SHA-256 mappings for production-source preservation across boot rounds. */
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async source =>
  [source, sha256(await readFile(join(repository, source)))])));
/** 从本夹具 RSA 私钥导出公开 JWK 并编码 SSH 公钥行，不把私钥正文写入云初始化配置。
 * Derive public JWK from the fixture RSA key/encode an SSH public-key line without publishing private-key bytes to cloud-init. */
const publicText = (privateKey: Buffer) => {
  const key = createPublicKey(createPrivateKey(privateKey)).export({ format: 'jwk' });
  /** 按大端四字节长度封装 SSH 二进制字段，返回新拼接 Buffer。
   * Wrap an SSH binary field with four-byte big-endian length in a newly concatenated Buffer. */
  const field = (value: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(value.length);
    return Buffer.concat([length, value]);
  };
  /** 解码 base64url 正整数，最高位为一时补零避免 SSH mpint 被解释为负数，再封装长度。
   * Decode a base64url positive integer, prefix zero if its top bit is set to avoid negative SSH mpint interpretation, then wrap length. */
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
/** 为事件增加单调序号、墙上时间和性能时钟，关联可选轮次并保存后返回，供启动/停止时序证明。
 * Add monotonic sequence/wall time/performance clock and optional round, retaining/returning events for boot/stop timing evidence. */
const stamp = (event: string, round?: number) => {
  const entry: Event = { sequence: proof.events.length + 1, at: new Date().toISOString(),
    milliseconds: performance.now(), event, ...(round ? { round } : {}) };
  proof.events.push(entry); return entry;
};
/** 把完整启动持久性证据写入自有夹具文件，返回写入完成 Promise。
 * Write complete boot-persistence evidence to the owned fixture and return its completion promise. */
const saveProof = () => writeFile(join(fixture, 'boot-persistence-evidence.json'), JSON.stringify(proof, null, 2) + '\n');
/** 按专用根目录 needle 查询真实 Windows QEMU 出生元组，规范返回数组，供零残留核查。
 * Query actual Windows QEMU birth tuples using the dedicated-root needle and normalize arrays for zero-residue checks. */
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
/** 创建真实运行时与 Machines，包装自有 QEMU/exec 以记录执行起止和初始化边界；其他调用保持生产实现，重建时保留落盘身份。
 * Create the real runtime/Machines and observe owned QEMU/exec start-end/initialization boundaries while forwarding other work unchanged, preserving saved identity across reconstruction. */
const controller = async () => {
  const engine = await createRuntime();
  const nativeRun = engine.run.bind(engine);
  engine.run = (/** 只为 argv 引用本夹具的 sakura-qemu 记录轮次、参数哈希与结算时间，其他调用直接转发；异常保留并重抛，finally 不论退出方式都标记结算。
 * Record round, argv digest and settlement only for sakura-qemu referencing this fixture, forwarding other calls directly; retain/rethrow errors and mark settlement in finally for every exit path. */ async (...args: Parameters<typeof nativeRun>) => {
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
  machines.exec = /** 仅允许自有 VM 命令，首轮不额外发 SSH；对正式初始化追加成功 bootId 观测并从返回 stdout 剥离，后续只允许固定只读验证，保持退出码与输入参数。
 * Allow only owned-VM commands and no extra first-round SSH; append a successful bootId observation to formal initialization and strip it from returned stdout, allowing only fixed read-only later verification while preserving exit codes/arguments. */ async (...args: Parameters<typeof nativeExec>) => {
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
    const result = await nativeExec(args[0], args[1] + (boot ? suffix : ''), ...args.slice(2) as [number?, AbortSignal?, (/** 沿用原 exec 的增量文本输出回调，观测包装不改变原调用方接收的数据。
 * Preserve the original exec incremental-text output callback; the observer wrapper does not alter data delivered to its caller. */ (data: string) => void)?, string?]);
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
/** 重载后要求唯一原实例、名称/发行版/停机状态和私钥/seed 摘要不变，返回身份保留证据。
 * After reload require the unique original VM/name/distribution/stopped state and unchanged private-key/seed hashes, returning identity-preservation evidence. */
const checkReloadedIdentity = async () => {
  assert.equal(machines!.records.size, 1);
  const record = machines!.get(id);
  assert.equal(record.name, hostname); assert.equal(record.distro, distro);
  assert.equal(machines!.state(id), 'stopped');
  assert.equal(sha256(await readFile(join(vmDir(id), 'id_rsa'))), expectedPrivateHash);
  assert.equal(sha256(await readFile(join(vmDir(id), 'seed.iso'))), expectedSeedHash);
  return { singleRecord: true, vmId: id, hostname, privateKeyUnchanged: true, seedUnchanged: true };
};
/** 记录首次强停时刻与来宾命令计数，等待正式 stop 并核对 live 撤销及 stopped，记录完成时序。
 * Record forced-stop time/guest-command count, await production stop and verify live revocation/stopped state with completion timing. */
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
/** 用首次 running 事件作为就绪边界，可立刻强停以验证生产初始化已经同步；270 秒期限且 finally 清理监听/计时器，逐轮核对新 bootId。
 * Use the first running event as readiness, optionally force-stop immediately to verify synchronized production initialization; bound by 270 seconds/clean listeners-timer in finally and compare new boot IDs per round. */
const start = async (round: any, stopImmediately: boolean) => {
  currentRound = round;
  const ownMachines = machines!;
  let settled = false;
  /** 用启动或停止错误拒绝本轮 ready Promise，保证失败不会被后续状态变化改成成功。
   * Reject this round’s ready promise with boot/stop errors so later state changes cannot convert failure to success. */
  /** 兑现本轮首次 running 等待，无参数；调用方在该边界之后才能核验持久性。
   * Resolve this round’s first-running wait without arguments, establishing the boundary for subsequent persistence checks. */
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {}); // A host process query can finish after a boot failure.
  /** 仅处理首个终态：running 记录就绪并可强停，error/stopped 拒绝；settled 防止重复事件重入。
   * Handle only the first terminal observation: record running/optionally force-stop, reject error/stopped, and use settled to prevent repeated-event reentry. */
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
/** 核对该轮精确 QEMU 计数为零且唯一执行 settled，保存串口日志并关闭 Machines，再落盘关闭证据。
 * Require zero exact QEMU matches/one settled execution, retain serial logs/close Machines and persist closure evidence. */
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
      /** 从来宾自检 stdout 提取指定固定字段的一行值，不存在返回 undefined 供断言失败。
       * Extract one fixed named field from guest self-check stdout, returning undefined if absent for assertion failure. */
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
