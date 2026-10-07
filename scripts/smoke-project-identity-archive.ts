/** 烟雾验收：验证新 VM 运行票据归档、容量与冲突拒绝；明确区分真实运行和闭合记录夹具。
 * Smoke acceptance for fresh-VM run-ticket archives/capacity/conflict refusal, distinguishing real runs from closed-record fixtures. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import { diskOptions } from '../shared/hardware.ts';

const images = { alpine: 'alpine-3.23.qcow2', debian: 'debian-12.qcow2', ubuntu: 'ubuntu-24.04.qcow2' } as const;
if (process.argv.length === 2 || process.argv[2] === '--describe') {
  console.log('Explicit fresh-VM ticket archive check: --run-new <alpine|debian|ubuntu> [--seed-closed-capacity]. Copies one cached standalone image into a new fixture, generates a new SSH key, and preserves all existing fixtures. The default performs 1023 real prepare/stop pairs. The optional capacity fixture creates one real closed ticket and 1022 explicitly labeled closed receipt fixtures; it does not attest 1023 kernel runs. Both modes keep a real active neighbor and verify automatic archival, a fresh project command, replay refusal, readonly recovery, actual no-replace publication and injected fsync failure recovery.');
} else {
  assert.ok(process.argv.length === 4 || process.argv.length === 5); assert.equal(process.argv[2], '--run-new');
  if (process.argv.length === 5) assert.equal(process.argv[4], '--seed-closed-capacity');
  const distro = process.argv[3] as keyof typeof images; assert.ok(Object.hasOwn(images, distro));
  assert.deepEqual(process.execArgv, ['--import', 'tsx']); assert.equal(process.env.NODE_OPTIONS || '', '');
  await run(distro, process.argv.length === 5);
}

/** 在新建自有实例核验身份运行归档容量、同字节重复发布和碰撞/写失败恢复，保留源码/进程/资源证据；可显式选择真实全量或已标识 seed 容量模式。
 * Verify identity-run archive capacity/idempotent publication/collision-and-write recovery in a new owned VM, retaining source/process/resource evidence with explicitly labeled actual or seeded capacity modes. */
async function run(distro: keyof typeof images, seededCapacity: boolean) {
  const workspace = await realpath('.');
  const parent = join(workspace, '.data', 'project-identity-archive-test-temp');
  await mkdir(parent, { recursive: true }); assert.equal(await realpath(parent), parent);
  const root = await mkdtemp(join(parent, 'sakura-identity-archive-'));
  assert.equal(dirname(await realpath(root)), parent); assert.match(basename(root), /^sakura-identity-archive-/);
  const invocation = randomUUID(), proofFile = join(root, 'project-identity-archive-' + invocation + '.json');
  /** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
   * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  const proof: any = { version: 1, invocation, distro, root, passed: false, startedAt: new Date().toISOString(),
    sourceSha256: {}, executions: [], cases: [], phases: [], bootProbes: [], cleanupErrors: [], vmId: '', client: { node: process.version, execArgv: process.execArgv } };
  const hardware = { memoryMiB: 1536, cpus: 2 };
  proof.capacityMode = seededCapacity ? 'one actual closed run and 1022 explicitly seeded closed receipts' : '1023 actual prepare/stop pairs';
  proof.testBudgets = { vmMs: 3600000, capacityMs: 1800000, neighborMs: 3600000, hardware };
  /** 保存阶段名与时间并输出进度，为中断或失败报告定位最后执行边界。
   * Retain phase name/time and print progress to locate the last execution boundary after interruption/failure. */
  const phase = (name: string) => { proof.phases.push({ name, at: new Date().toISOString() }); console.log('PHASE ' + name); };
  const sources = ['native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py',
    'server/project-identity.ts', 'server/project-run-scope.ts', 'server/guest-task.ts', 'server/machines.ts',
    'server/workspaces.ts', 'server/project-directory-migration.ts', 'server/project-network-isolation.ts',
    'scripts/smoke-project-identity-archive.ts', 'tests/project-identity-archive-model.py', 'tests/project-identity-archive.test.ts'];
  for (const file of sources) proof.sourceSha256[file] = hash(await readFile(join(workspace, file)));
  await writeFile(join(root, 'intent-' + invocation + '.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
  const image = await realpath(join(workspace, '.data', 'images', images[distro]));
  assert.equal(image, join(workspace, '.data', 'images', images[distro]));
  const imageInfo = await lstat(image); assert.ok(imageInfo.isFile() && !imageInfo.isSymbolicLink());
  const imageSha256 = hash(await readFile(image));
  const ownImages = join(root, 'images'); await mkdir(ownImages);
  const base = join(ownImages, images[distro]); await copyFile(image, base, constants.COPYFILE_EXCL);
  assert.equal(hash(await readFile(base)), imageSha256);
  assert.equal(hash(await readFile(image)), imageSha256);
  proof.base = { original: image, originalSha256: imageSha256, privateCopy: base, copiedSha256: imageSha256 };
  process.env.SAKURA_DATA_DIR = root; process.env.SAKURA_IMAGE_DIR = ownImages; process.env.SAKURA_IMAGE_PATH = base;
  process.env.TEMP = process.env.TMP = root;
  const { Machines } = await import('../server/machines.ts');
  const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
  const { projectIdentityTask } = await import('../server/project-run-scope.ts');
  const { guestTask } = await import('../server/guest-task.ts');
  const { quote } = await import('../server/files.ts');
  const source = await projectIdentitySources();
  for (const entry of source.manifest.files) assert.equal(entry.sha256, proof.sourceSha256['native/project-identity/' + entry.name]);
  proof.identityBuild = source.manifest;
  const qemu = join(workspace, '.tools', 'qemu', 'qemu-system-x86_64.exe'), img = join(workspace, '.tools', 'qemu', 'qemu-img.exe');
  proof.binarySha256 = { [qemu]: hash(await readFile(qemu)), [img]: hash(await readFile(img)) };
  const children = new Map<ChildProcess, Promise<void>>();
  let vmId = '', qemuStarted = false;
  /** 启动前核验已冻结二进制摘要，登记 argv/PID/exit/close 并限制累计输出；取消只终止自有 child，等待真实 close 后返回结果并清理监听。
   * Verify frozen binary hashes before spawning, record argv/PID/exit/close and bound accumulated output; cancellation targets only the owned child, then await actual close/clean listeners before returning. */
  async function execute(executable: string, args: string[], options: Parameters<Engine['run']>[2] = {}, vm = false) {
    assert.equal(hash(await readFile(executable)), proof.binarySha256[executable]);
    const actualArgs = [...args];
    const receipt: any = { executable, argvSha256: hash(JSON.stringify(actualArgs)), requestedArgvSha256: hash(JSON.stringify(args)),
      vm, testOnlyEngine: vm ? 'original single-threaded TCG with icount' : 'fixed image operation', pid: null,
      exit: null, close: null, stdoutClosed: false, stderrClosed: false };
    proof.executions.push(receipt);
    const child = spawn(executable, actualArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    receipt.pid = child.pid;
    const output: Buffer[] = [], errors: Buffer[] = []; let size = 0, spawnError: Error | undefined;
    for (const [stream, chunks] of [[child.stdout, output], [child.stderr, errors]] as const)
      stream!.on('data', (bytes: Buffer) => { size += bytes.length; if (size > 1048576) { receipt.outputLimit = true; child.kill(); }
        else chunks.push(bytes); options?.output?.(bytes); });
    child.once('error', error => { spawnError = error; receipt.spawnError = error.message; });
    child.once('exit', (code, signal) => { receipt.exit = { code, signal }; });
    const closed = new Promise<void>(done => child.once('close', (code, signal) => {
      receipt.close = { code, signal }; receipt.stdoutClosed = child.stdout!.closed; receipt.stderrClosed = child.stderr!.closed;
      children.delete(child); done();
    })); children.set(child, closed);
    /** 取消只绑定当前自有 child 句柄，终止该进程；存在 receipt/entry 时同时记录取消证据，实际 close 仍由外层等待。
     * Bind cancellation only to the current owned child and terminate it, recording receipt/entry evidence when present; outer code still awaits physical close. */
    const abort = () => { receipt.abortRequested = true; child.kill(); };
    options?.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { receipt.timeoutRequested = true; child.kill(); }, options?.timeoutMs || (vm ? proof.testBudgets.vmMs : 30000));
    if (options?.signal?.aborted) abort();
    try {
      await closed;
      if (spawnError) throw spawnError;
      if (options?.signal?.aborted) return '';
      assert.equal(receipt.close.code, 0, Buffer.concat(errors).toString('utf8')); assert.equal(receipt.close.signal, null);
      return Buffer.concat(output).toString('utf8');
    } finally { clearTimeout(timer); options?.signal?.removeEventListener('abort', abort); }
  }
  /** 显式拒绝夹具没有授权的运行时能力，使意外走入其他主机操作立即失败，不能静默用替身绕过生产路径。
   * Explicitly reject runtime capabilities not authorized by this fixture so accidental host operations fail immediately instead of silently bypassing production paths with a substitute. */
  const unsupported = () => { throw new Error('Unknown archive-test runtime operation.'); };
  const engine = { version: 'test-only direct Engine', whpxAvailable: false, qemuIoAvailable: false, aarch64Available: false,
    runtime: { /** 终止此适配器登记的全部自有子进程并等待实际关闭 Promise；存在总期限时届满失败且清理计时器，不把 kill 调用等同于完成。
 * Terminate all owned children registered by this adapter and await actual closure promises; where bounded, expiry fails and clears the timer, since calling kill is not completion. */ close: async () => { for (const child of children.keys()) child.kill(); await Promise.all(children.values()); } },
    runStatus: unsupported, /** 拒绝通用 service 访问，维持此夹具只允许明确 QEMU 启动的最小运行时边界。
 * Reject generic service access, preserving the fixture’s minimum runtime boundary of explicitly permitted QEMU launch only. */ get service() { return unsupported(); },
    /** 只允许指定自有磁盘的固定镜像创建和一次精确 QEMU 启动，逐项校验驱动器/启动参数并拒绝其他入口；调用 execute 保留实际进程关闭证据。
     * Allow only fixed owned-disk image creation/one exact QEMU boot, validating drives/launch arguments and rejecting other entry points; execute retains physical-process closure evidence. */
    run: async (tool: string, args: string[], options?: Parameters<Engine['run']>[2]) => {
      if (tool === 'sakura-img') {
        const disk = args.at(-2)!;
        assert.deepEqual(args.slice(0, 7), ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', base]);
        assert.equal(args.length, 9); assert.equal(args.at(-1), '8G'); assert.equal(basename(disk), 'disk.qcow2');
        assert.match(basename(dirname(disk)), /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
        assert.equal(dirname(dirname(disk)), join(root, 'machines')); assert.equal(await realpath(dirname(disk)), dirname(disk));
        return execute(img, args, options);
      }
      assert.equal(tool, 'sakura-qemu'); assert.ok(vmId && !qemuStarted); qemuStarted = true;
      /** 转义正则表达式元字符，保证自有路径作为字面匹配条件使用。
       * Escape regular-expression metacharacters so owned paths remain literal matching conditions. */
      const escaped = (value: string) => value.replaceAll(',', ',,');
      const drives = args.flatMap((arg, index) => arg === '-drive' ? [args[index + 1]] : []);
      assert.deepEqual(drives, [`file=${escaped(join(root, 'machines', vmId, 'disk.qcow2'))},if=virtio,id=sakura-disk,format=qcow2,${diskOptions(hardware)}`,
        `file=${escaped(join(root, 'machines', vmId, 'seed.iso'))},${distro === 'alpine' ? 'media=cdrom' : 'if=virtio,format=raw'},readonly=on`]);
      assert.ok(args.includes('-no-reboot')); for (const flag of ['-snapshot', '-blockdev', '-incoming', '-object', '-kernel', '-initrd', '-readconfig']) assert.ok(!args.includes(flag));
      return execute(qemu, args, options, true);
    } } as unknown as Engine;
  const machines = new Machines(engine), identities = new ProjectIdentities(machines);
  const originalExec = machines.exec.bind(machines);
  machines.exec = /** 仅为已知 boot readiness 命令记录开始、摘要、耗时及原结果/错误；不延长或替换命令，finally 输出诊断证据。
 * Record start/digest/duration and original results/errors only for known boot-readiness commands; never extend or substitute commands and emit diagnostic evidence in finally. */ async (...args) => {
    const boot = args[1].startsWith('test -f /var/lib/cloud/instance/boot-finished') || args[1].includes('test -f /var/lib/cloud/.bootstrap-complete');
    if (!boot) return originalExec(...args);
    const probe: any = { startedAt: new Date().toISOString(), timeoutMs: args[2], commandSha256: hash(args[1]) };
    proof.bootProbes.push(probe); const started = performance.now();
    try { const result = await originalExec(...args); probe.code = result.code; return result; }
    catch (error) { probe.error = String(error); throw error; }
    finally { probe.elapsedMs = performance.now() - started; console.log(JSON.stringify({ bootProbe: probe })); }
  };
  const neighborAbort = new AbortController(); let neighbor: Promise<any> | undefined;
  /** 按名称执行异步断言，成功后记录返回证据；异常直接传播，不记录通过。
   * By case name, run asynchronous assertions and retain returned evidence on success; propagate errors without recording a pass. */
  const check = async (name: string, work: /** 用例异步工作返回观测，外层检查器保存通过证据并传播失败；不自行覆盖归档票据。
 * Asynchronous case work returns observations for the outer checker to persist pass evidence/propagate failures without overwriting archived receipts. */ () => Promise<unknown>) => { const observation = await work(); proof.cases.push({ name, observation }); console.log('PASS ' + name); };
  /** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
   * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
  const guest = async (script: string, timeout = 30000) => {
    const result = await machines.exec(vmId, script, timeout); assert.equal(result.code, 0, result.stderr || result.stdout); return result.stdout.trim();
  };
  /** 执行清空环境、禁用 site 的固定 heredoc Python，传入期限并返回来宾结果，避免环境改变归档故障注入。
   * Execute clean-environment/site-disabled fixed heredoc Python under the supplied timeout and return results without environmental interference in archive fault injection. */
  const python = (script: string, timeout = 30000) => guest('env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C /usr/bin/python3 -I -S - <<\'ARCHIVE_FIXTURE\'\n' + script + '\nARCHIVE_FIXTURE', timeout);
  const imported = `import importlib.util,json,os,stat,uuid\nspec=importlib.util.spec_from_file_location('owned',${JSON.stringify(source.directory + '/controller.py')});m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);build=m.sources();boot=open('/proc/sys/kernel/random/boot_id').read().strip()\n`;
  try {
    const info = JSON.parse(await execute(img, ['info', '--output=json', base])); assert.equal(info.format, 'qcow2'); assert.equal(info['backing-filename'], undefined);
    await machines.init(); assert.equal((await machines.list()).length, 0);
    vmId = (await machines.create({ name: 'identity-archive-' + distro, distro, ...hardware, diskGiB: 8, accelerator: 'tcg', forwards: [] })).id;
    proof.vmId = vmId; console.log(JSON.stringify({ root, vmId, distro, build: source.manifest.build }));
    phase('fresh boot');
    await machines.start(vmId);
    const deadline = Date.now() + 300000;
    while (machines.state(vmId) === 'starting' && Date.now() < deadline) await delay(250);
    assert.equal(machines.state(vmId), 'running', (await machines.view(vmId)).lastError);
    phase('install native identity launcher');
    await identities.install(vmId);
    phase('prepare two project accounts and the active neighbor');
    const directory = '/srv/sakura-archive-' + invocation;
    await guest(`mkdir ${quote(directory)}; mkdir ${quote(directory + '/alpha')} ${quote(directory + '/beta')}; chmod 755 ${quote(directory)}`);
    /** 要求目录未授权时只生成 intent，显式授权自有目录并建私有网络后再次 ensure，返回真实项目身份。
     * Require unapproved directories create only intent, explicitly authorize the owned directory/create private network and re-ensure the real project identity. */
    async function identity(projectId: string, suffix: string) {
      await assert.rejects(identities.ensure(vmId, { projectId, directory: directory + '/' + suffix, networkIsolation: 'private' }), /DIRECTORY_MIGRATION_REQUIRED/);
      const intent = await identities.inspect(vmId, projectId); assert.ok(intent); assert.equal(intent.phase, 'intent');
      await guest(`chown ${intent.uid}:${intent.gid} ${quote(intent.directory)}; chmod 700 ${quote(intent.directory)}`);
      await guest(`ip netns add sk-${projectId}; ip -n sk-${projectId} link set lo up`);
      return identities.ensure(vmId, { projectId, directory: intent.directory, networkIsolation: 'private' });
    }
    const alpha = await identity('default', 'alpha'), beta = await identity('1111111111111111', 'beta');
    proof.identities = { alpha, beta }; assert.notEqual(alpha.uid, beta.uid);
    let neighborOutput = '';
    neighbor = projectIdentityTask(machines, vmId, { directory: beta.directory, networkIsolation: 'private', _workspace: beta.projectId } as any,
      { command: "printf 'ARCHIVE_NEIGHBOR_READY\\n'; while :; do /bin/sleep 1; done" }, neighborAbort.signal,
      text => { neighborOutput += text; }, proof.testBudgets.neighborMs).then(value => ({ fulfilled: true, value }), error => ({ fulfilled: false, error: String(error) }));
    for (let attempt = 0; !neighborOutput.includes('ARCHIVE_NEIGHBOR_READY\n') && attempt < 240; attempt++) await delay(250);
    assert.ok(neighborOutput.includes('ARCHIVE_NEIGHBOR_READY\n'));
    const betaRuns = JSON.parse(await python(imported + `lock=m.initialize_readonly()\ntry:\n print(json.dumps(m.runs_for(m.binding_read(${JSON.stringify(beta.projectId)}))))\nfinally: os.close(lock)`));
    assert.equal(betaRuns.length, 1); const betaRun = betaRuns[0]; assert.equal(betaRun.phase, 'active'); proof.neighborRun = betaRun;
    await check('1024 hot receipts preserve the actual active neighbor', async () => {
      phase(seededCapacity ? 'seed explicitly labeled closed capacity receipts' : 'fill 1024 actual native receipts');
      const fill = seededCapacity ? `ticket=m.prepare(value,{},boot,build);closed=m.stop(value,ticket,boot);assert closed['phase']=='closed';assert m.cgroup_fd(closed) is None;created.append(closed['runId']);actual=1;seeded=0\n while len(m.run_entries())<m.RUN_LIMIT:\n  clone={**closed,'runId':str(uuid.uuid4())};clone['cgroupName']='sakura-identity-'+clone['runId'];assert m.read(m.run_path(clone['runId']),m.RUN.size,True) is None;assert m.run_archive_read(clone['runId']) is None;assert m.cgroup_fd(clone) is None;m.run_write(clone);assert m.run_read(clone['runId'])==clone;created.append(clone['runId']);seeded+=1` :
        `actual=0;seeded=0\n while len(m.run_entries())<m.RUN_LIMIT:\n  ticket=m.prepare(value,{'runId':str(uuid.uuid4())},boot,build);closed=m.stop(value,ticket,boot);assert closed['phase']=='closed';created.append(closed['runId']);actual+=1`;
      const reply = JSON.parse(await python(imported + `lock=m.initialize()\ntry:\n value=m.active('default',{'expected':${JSON.stringify({ registryId: alpha.registryId, identityId: alpha.identityId, revision: alpha.revision })}},m.registry());created=[]\n ${fill}\n print(json.dumps({'hot':len(m.run_entries()),'actualPrepareStopPairs':actual,'explicitlySeededClosedReceipts':seeded,'boot':boot,'first':created[0],'last':created[-1]}))\nfinally: os.close(lock)`, proof.testBudgets.capacityMs));
      assert.equal(reply.hot, 1024); assert.equal(reply.actualPrepareStopPairs, seededCapacity ? 1 : 1023);
      assert.equal(reply.explicitlySeededClosedReceipts, seededCapacity ? 1022 : 0);
      assert.deepEqual(await identities.runReadonly(vmId, beta, betaRun.runId), betaRun);
      assert.equal((await identities.status(vmId, beta, betaRun)).populated, true); return reply;
    });
    let archived: any;
    await check('fresh native command executes after automatic complete archival', async () => {
      const beforeBoot = proof.cases[0].observation.boot;
      const ticket = await identities.prepare(vmId, alpha);
      const result = await identities.exec(vmId, alpha, ticket, { command: '/usr/bin/id -u; /usr/bin/id -g; pwd' });
      assert.equal(result.code, 0, result.stderr); assert.deepEqual(result.stdout.trim().split(/\r?\n/), [String(alpha.uid), String(alpha.gid), alpha.directory]);
      const state = JSON.parse(await python(imported + `lock=m.initialize_readonly()\ntry:\n arcs=[]\n for folder,dirs,files in os.walk(m.RUNTIME+'/archives'):\n  for name in files:\n   assert name.endswith('.bin');r=m.run_read(name[:-4]);assert r['phase']=='closed';arcs.append(r)\n print(json.dumps({'hot':len(m.run_entries()),'archived':len(arcs),'first':arcs[0],'boot':boot}))\nfinally: os.close(lock)`));
      assert.equal(state.archived, 512); assert.equal(state.hot, 513); assert.equal(state.boot, beforeBoot);
      archived = state.first; assert.deepEqual(await identities.runReadonly(vmId, alpha, archived.runId), archived);
      assert.deepEqual(await identities.runReadonly(vmId, beta, betaRun.runId), betaRun); assert.equal((await identities.status(vmId, beta, betaRun)).populated, true);
      return { ...state, executedRun: ticket, actualUid: alpha.uid, actualGid: alpha.gid };
    });
    await check('archived ID refuses normal and inherited replay before the body', /** 对已归档 runId 的重新 prepare/正文执行必须 RUN_ARCHIVED 且无标记；只读与重复 stop 返回原归档并不重建热票据，证明归档终态不可复活。
 * Require RUN_ARCHIVED and no body marker for prepare/body execution using an archived runId; read-only/repeated stop return the original archive without rebuilding hot receipts, proving terminal archives cannot revive. */ async () => {
      await assert.rejects(identities.prepare(vmId, alpha, { runId: archived.runId }), /RUN_ARCHIVED/);
      const marker = 'archived-must-not-run-' + invocation;
      const payload = await identities.inheritedInput(alpha, { command: 'touch ' + quote(marker) }, { runId: archived.runId });
      assert.ok(!payload.command.includes(marker));
      const result = await guestTask(machines, vmId, payload.command, new AbortController().signal, undefined, 30000,
        undefined, undefined, { input: payload.input, runId: archived.runId });
      assert.equal(result.code, 1); assert.equal(JSON.parse(result.stdout.trim()).code, 'RUN_ARCHIVED');
      await guest(`test ! -e ${quote(alpha.directory + '/' + marker)}`);
      const snapshot = await identities.runReadonly(vmId, alpha, archived.runId); assert.deepEqual(snapshot, archived);
      const stopped = await identities.stop(vmId, alpha, archived); assert.deepEqual(stopped, archived);
      await guest(`test ! -e ${quote('/run/sakura-project-identities/runs/' + archived.runId + '.bin')}`);
      return { runId: archived.runId, actualCode: result.code, refusalCode: 'RUN_ARCHIVED', noBodyMarker: true, repeatedStopDidNotRecreateHotReceipt: true };
    });
    await check('real no-replace collision and injected directory fsync loss preserve complete originals', async () => {
      const result = JSON.parse(await python(imported + faultChecks(alpha), 60000));
      assert.deepEqual(result.checks, ['actual-renameat2-no-replace', 'injected-directory-fsync-loss-and-exact-retry']);
      return result;
    });
    await check('project cannot read root archives and neighbor cancellation retires its exact ticket', async () => {
      const path = '/run/sakura-project-identities/archives/' + archived.runId.slice(0, 2) + '/' + archived.runId + '.bin';
      const ticket = await identities.prepare(vmId, alpha);
      const body = `import errno,os\ntry: os.open(${JSON.stringify(path)},os.O_RDONLY)\nexcept PermissionError as e: assert e.errno==errno.EACCES;print('ARCHIVE_ACCESS_DENIED')\nelse: raise RuntimeError('archive readable')`;
      const result = await identities.exec(vmId, alpha, ticket, { command: '/usr/bin/python3 -I -S -c ' + quote(body) });
      assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout.trim(), 'ARCHIVE_ACCESS_DENIED');
      neighborAbort.abort(); const settled = await neighbor; assert.equal(settled.fulfilled, false); neighbor = undefined;
      const closed = await identities.runReadonly(vmId, beta, betaRun.runId); assert.equal(closed.phase, 'closed');
      assert.deepEqual({ ...closed, phase: betaRun.phase }, betaRun); assert.equal((await identities.status(vmId, beta, closed)).populated, false);
      assert.deepEqual(await identities.inspect(vmId, alpha.projectId), alpha); assert.deepEqual(await identities.inspect(vmId, beta.projectId), beta);
      return { access: result.stdout.trim(), neighborClosed: closed, unchangedAccounts: true };
    });
    proof.bodyPassed = true;
  } catch (error) { proof.error = error instanceof Error ? error.message : String(error); console.error(error); }
  finally {
    neighborAbort.abort(); if (neighbor) await neighbor;
    await writeFile(join(root, 'boot-' + invocation + '.log'), machines.logs.get(vmId) || '', { flag: 'wx' });
    try { if (vmId) { const done = machines.live.get(vmId)?.done; await machines.stop(vmId, true); if (done) await done;
      proof.vmStopped = machines.state(vmId) === 'stopped'; } } catch (error) { proof.cleanupErrors.push(String(error)); }
    try { await machines.close(); } catch (error) { proof.cleanupErrors.push(String(error)); }
    proof.liveEntries = machines.live.size; proof.ownedChildren = children.size;
    if (vmId && process.platform === 'win32') {
      const request = JSON.stringify({ image: qemu, disk: join(root, 'machines', vmId, 'disk.qcow2') });
      const query = "$ProgressPreference='SilentlyContinue';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$p=@(Get-CimInstance Win32_Process|Where-Object { $_.ExecutablePath -eq $r.image -and $_.CommandLine -and $_.CommandLine.Contains($r.disk) });[Console]::Out.WriteLine($p.Count)";
      proof.exactQemuMatches = Number(execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')],
        { input: request, encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim());
    }
    const changed = [];
    for (const [file, checksum] of Object.entries(proof.sourceSha256)) if (hash(await readFile(join(workspace, file))) !== checksum) changed.push(file);
    for (const [file, checksum] of Object.entries(proof.binarySha256)) if (hash(await readFile(file)) !== checksum) changed.push(file);
    const afterImage = await lstat(image); proof.originalImageUnchanged = hash(await readFile(image)) === imageSha256 &&
      afterImage.ino === imageInfo.ino && afterImage.size === imageInfo.size && afterImage.mtimeMs === imageInfo.mtimeMs;
    proof.changed = changed; proof.finishedAt = new Date().toISOString();
    proof.passed = proof.bodyPassed === true && proof.cases.length === 5 && proof.cleanupErrors.length === 0 && !changed.length &&
      proof.originalImageUnchanged && proof.vmStopped && proof.liveEntries === 0 && proof.ownedChildren === 0 && proof.exactQemuMatches === 0 &&
      proof.executions.every((entry: any) => entry.exit && entry.close && entry.stdoutClosed && entry.stderrClosed);
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ proofFile, passed: proof.passed, cases: proof.cases.map((entry: any) => entry.name), cleanup: {
      vmStopped: proof.vmStopped, live: proof.liveEntries, children: proof.ownedChildren, exactQemu: proof.exactQemuMatches }, error: proof.error || null }));
  }
  if (!proof.passed) process.exitCode = 1;
}

/** 生成持有正式控制器锁的归档碰撞/写入故障脚本，验证外来目标不被替换、原运行票据保持可恢复且无暂存残留。
 * Generate archive-collision/write-failure checks under the production controller lock, verifying foreign targets preserved/original receipts recoverable/no staging residue. */
function faultChecks(identity: { projectId: string }) {
  return `import errno,hashlib\nlock=m.initialize()\nchecks=[]\ntry:\n value=m.binding_read(${JSON.stringify(identity.projectId)});ticket=m.prepare(value,{},boot,build);closed=m.stop(value,ticket,boot);path=m.run_path(closed['runId']);original=m.read(path);inode=os.lstat(path).st_ino\n real_publish=m.run_archive_publish;foreign={}\n def collision(parent,temp,target):\n  fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)\n  try: os.write(fd,b'OWNED_ARCHIVE_COLLISION');os.fsync(fd);foreign['inode']=os.fstat(fd).st_ino\n  finally: os.close(fd)\n  real_publish(parent,temp,target)\n m.run_archive_publish=collision\n try:\n  m.run_archive(closed,boot);raise AssertionError('collision accepted')\n except m.Refusal as e: assert e.code=='RUN_ARCHIVE_CONFLICT'\n finally: m.run_archive_publish=real_publish\n parent=m.run_archive_fd(closed['runId']);name=closed['runId']+'.bin';fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)\n try: assert os.fstat(fd).st_ino==foreign['inode'];assert os.read(fd,1024)==b'OWNED_ARCHIVE_COLLISION'\n finally: os.close(fd)\n assert m.read(path)==original and os.lstat(path).st_ino==inode\n os.unlink(name,dir_fd=parent);os.fsync(parent);os.close(parent);assert m.run_archive(closed,boot);assert m.run_read(closed['runId'])==closed;checks.append('actual-renameat2-no-replace')\n ticket=m.prepare(value,{},boot,build);closed=m.stop(value,ticket,boot);path=m.run_path(closed['runId']);original=m.read(path);inode=os.lstat(path).st_ino\n parent=m.run_archive_fd(closed['runId'],True);target=os.fstat(parent);os.close(parent);real_sync=os.fsync\n def lose_sync(fd):\n  info=os.fstat(fd)\n  if stat.S_ISDIR(info.st_mode) and (info.st_dev,info.st_ino)==(target.st_dev,target.st_ino): raise OSError(errno.EIO,'owned injected archive-directory fsync loss')\n  real_sync(fd)\n os.fsync=lose_sync\n try:\n  m.run_archive(closed,boot);raise AssertionError('sync loss accepted')\n except OSError as e: assert e.errno==errno.EIO\n finally: os.fsync=real_sync\n assert m.read(path)==original and os.lstat(path).st_ino==inode;assert m.run_archive_read(closed['runId'])==original\n assert m.run_archive(closed,boot);assert not os.path.lexists(path);assert m.run_read(closed['runId'])==closed;checks.append('injected-directory-fsync-loss-and-exact-retry')\n print(json.dumps({'checks':checks,'allOriginalBytesPreserved':True,'failureIsExplicitlyInjected':True}))\nfinally: os.close(lock)`;
}
