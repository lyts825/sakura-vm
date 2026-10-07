/** 烟雾验收：验证新自有 VM 的项目 PTY/tmux、只读连接、作用域清理和陈旧 ID 拒绝。
 * Smoke acceptance for fresh owned-VM PTY/tmux/read-only connections/scope cleanup and stale-ID refusal. */
import { projectMetadataFile } from '../server/project-catalog.ts';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import { diskOptions } from '../shared/hardware.ts';

if (process.argv.length === 2 || process.argv[2] === '--describe') {
  console.log('Project UID terminal check: --run-new alpine. Creates one owned VM, compiles the fixed native launcher and checks real PTY input, persistent tmux windows, readonly attachment, scoped cleanup and stale shared IDs.');
} else {
  const reused = process.argv[2] === '--run-owned';
  if (reused) { assert.equal(process.argv.length, 5); assert.equal(process.argv[3], 'alpine'); }
  else assert.deepEqual(process.argv.slice(2), ['--run-new', 'alpine']);
  assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  await run(reused ? process.argv[4] : undefined);
}

/** 新建或核验自有 Alpine 夹具，使用正式终端入场票据检验 PTY 的项目 UID、只读/迁移门控与整域回收，保留原生和主机证据。
 * Create or validate an owned Alpine fixture, testing production PTY admission for project UID/read-only-migration gates/whole-domain retirement with host/native evidence. */
async function run(ownedDirectory?: string) {
  const workspace = await realpath('.'), parent = join(workspace, '.data/project-terminal-test-temp');
  await mkdir(parent, { recursive: true }); assert.equal(await realpath(parent), parent);
  const root = ownedDirectory ? await realpath(ownedDirectory) : await mkdtemp(join(parent, 'sakura-terminal-'));
  assert.equal(dirname(await realpath(root)), parent); assert.match(basename(root), /^sakura-terminal-/);
  /** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
   * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
  const invocation = randomUUID(), hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  const proof: any = { version: 1, invocation, root, distro: 'alpine', passed: false, startedAt: new Date().toISOString(),
    sourceSha256: {}, executions: [], cases: [], phases: [], cleanupErrors: [], client: { node: process.version, execArgv: process.execArgv } };
  let prior: any;
  if (ownedDirectory) {
    const proofs = (await readdir(root)).filter(name => /^project-terminal-[a-f0-9-]{36}\.json$/.test(name));
    assert.ok(proofs.length);
    const completed = await Promise.all(proofs.map(async name => JSON.parse(await readFile(join(root, name), 'utf8'))));
    prior = completed.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))[0];
    assert.equal(prior.root, root); assert.equal(prior.vmStopped, true); assert.equal(prior.liveEntries, 0);
    assert.equal(prior.ownedChildren, 0); assert.equal(prior.exactQemuMatches, 0);
    assert.ok(prior.executions.every((entry: any) => entry.exit && entry.close && entry.stdoutClosed && entry.stderrClosed));
    proof.kind = 'owned-terminal-fixture-new-boot'; proof.previousInvocation = prior.invocation;
  } else proof.kind = 'fresh-owned-terminal-fixture';
  /** 保存阶段名与时间并输出进度，为中断或失败报告定位最后执行边界。
   * Retain phase name/time and print progress to locate the last execution boundary after interruption/failure. */
  const phase = (name: string) => { proof.phases.push({ name, at: new Date().toISOString() }); console.log('PHASE ' + name); };
  const files = ['server/project-repository.ts', 'server/project-repository-broker.py', 'server/repository-url.ts',
    'server/workspaces.ts', 'server/project-run-scope.ts', 'server/project-identity.ts', 'server/project-directory-migration.ts',
    'server/guest-task.ts', 'server/machines.ts', 'server/project-main.ts', 'server/project-service-scope.ts', 'server/project-services.ts',
    'server/project-network-isolation.ts', 'server/project-dependency-cache.ts', 'server/dependency-downloads.ts', 'server/network-profiles.ts',
    'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py',
    'scripts/smoke-project-terminal-identity.ts', 'plugins/terminal-workspace/server.ts', 'plugins/terminal-workspace/manifest.ts', 'package.json', 'package-lock.json'];
  /** 递归收集工作区源码相对路径并拒绝符号链接，供冻结摘要验证入口及依赖未被替换。
   * Recursively collect workspace-relative source paths and reject symbolic links for frozen-hash checks against replaced entry points/dependencies. */
  const capture = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await capture(path);
      else if (entry.isFile()) files.push(relative(workspace, path).replaceAll('\\', '/'));
    }
  };
  await capture(join(workspace, 'server')); await capture(join(workspace, 'shared'));
  for (const file of new Set(files)) proof.sourceSha256[file] = hash(await readFile(join(workspace, file)));
  proof.sourceContract = 'All local server/shared sources, package manifests, selected native identity sources and this harness; external dependency binaries are outside this source snapshot.';
  await writeFile(join(root, 'intent-' + invocation + '.json'), JSON.stringify(proof, null, 2), { flag: 'wx' });
  const image = await realpath(join(workspace, '.data/images/alpine-3.23.qcow2'));
  assert.equal(image, join(workspace, '.data/images/alpine-3.23.qcow2'));
  const imageInfo = await lstat(image); assert.ok(imageInfo.isFile() && !imageInfo.isSymbolicLink());
  const imageSha256 = hash(await readFile(image));
  const ownImages = join(root, 'images'); if (!ownedDirectory) await mkdir(ownImages);
  const base = join(ownImages, 'alpine-3.23.qcow2'); if (!ownedDirectory) await copyFile(image, base, constants.COPYFILE_EXCL);
  if (ownedDirectory) assert.equal(prior.base.privateCopy, base);
  assert.equal(hash(await readFile(base)), imageSha256);
  proof.base = { original: image, originalSha256: imageSha256, privateCopy: base, copiedSha256: imageSha256 };
  process.env.SAKURA_DATA_DIR = root; process.env.SAKURA_IMAGE_DIR = ownImages; process.env.SAKURA_IMAGE_PATH = base;
  process.env.TEMP = process.env.TMP = root;
  const { Machines } = await import('../server/machines.ts');
  const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
  const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
  const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
  const { projectIdentityTask } = await import('../server/project-run-scope.ts');
  const { ProjectTerminals } = await import('../server/project-terminals.ts');
  const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
  const { quote } = await import('../server/files.ts');
  const { writeStore } = await import('../server/local-store.ts');
  const { vmDir } = await import('../server/model.ts');
  const sources = await projectIdentitySources(); proof.identityBuild = sources.manifest;
  for (const entry of sources.manifest.files) assert.equal(entry.sha256, proof.sourceSha256['native/project-identity/' + entry.name]);
  const qemu = join(workspace, '.tools/qemu/qemu-system-x86_64.exe'), img = join(workspace, '.tools/qemu/qemu-img.exe');
  if (ownedDirectory) {
    const query = "$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;[Console]::Write(@(Get-CimInstance Win32_Process|Where-Object { $_.ExecutablePath -eq $r.image -and $_.CommandLine -and $_.CommandLine.Contains($r.disk) }).Count)";
    assert.equal(Number(execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')],
      { input: JSON.stringify({ image: qemu, disk: join(root, 'machines', prior.vmId, 'disk.qcow2') }), encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim()), 0);
  }
  proof.binarySha256 = { [qemu]: hash(await readFile(qemu)), [img]: hash(await readFile(img)) };
  const children = new Map<ChildProcess, Promise<void>>();
  let vmId = '', qemuStarted = false;
  /** 启动前核验已冻结二进制摘要，登记 argv/PID/exit/close 并限制累计输出；取消只终止自有 child，等待真实 close 后返回结果并清理监听。
   * Verify frozen binary hashes before spawning, record argv/PID/exit/close and bound accumulated output; cancellation targets only the owned child, then await actual close/clean listeners before returning. */
  async function execute(executable: string, args: string[], options: Parameters<Engine['run']>[2] = {}, vm = false) {
    assert.equal(hash(await readFile(executable)), proof.binarySha256[executable]);
    const entry: any = { executable, argvSha256: hash(JSON.stringify(args)), vm, pid: null, exit: null, close: null };
    proof.executions.push(entry);
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); entry.pid = child.pid;
    const stdout: Buffer[] = [], stderr: Buffer[] = []; let count = 0, failure: Error | undefined;
    for (const [stream, output] of [[child.stdout, stdout], [child.stderr, stderr]] as const)
      stream!.on('data', (value: Buffer) => { count += value.length; if (count > 1048576) child.kill();
        else output.push(value); options?.output?.(value); });
    child.once('error', error => { failure = error; entry.spawnError = error.message; });
    child.once('exit', (code, signal) => { entry.exit = { code, signal }; });
    const closed = new Promise<void>(done => child.once('close', (code, signal) => {
      entry.close = { code, signal }; entry.stdoutClosed = child.stdout!.closed; entry.stderrClosed = child.stderr!.closed;
      children.delete(child); done();
    })); children.set(child, closed);
    /** 取消只绑定当前自有 child 句柄，终止该进程；存在 receipt/entry 时同时记录取消证据，实际 close 仍由外层等待。
     * Bind cancellation only to the current owned child and terminate it, recording receipt/entry evidence when present; outer code still awaits physical close. */
    const abort = () => { entry.abortRequested = true; child.kill(); };
    options?.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { entry.timeoutRequested = true; child.kill(); }, options?.timeoutMs || (vm ? 7_200_000 : 30000));
    if (options?.signal?.aborted) abort();
    try { await closed; if (failure) throw failure; if (options?.signal?.aborted) return '';
      assert.equal(entry.close.code, 0, Buffer.concat(stderr).toString()); assert.equal(entry.close.signal, null);
      return Buffer.concat(stdout).toString();
    } finally { clearTimeout(timer); options?.signal?.removeEventListener('abort', abort); }
  }
  const hardware = { memoryMiB: 1536, cpus: 2 };
  /** 显式拒绝夹具没有授权的运行时能力，使意外走入其他主机操作立即失败，不能静默用替身绕过生产路径。
   * Explicitly reject runtime capabilities not authorized by this fixture so accidental host operations fail immediately instead of silently bypassing production paths with a substitute. */
  const unsupported = () => { throw new Error('Unknown terminal test engine operation'); };
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
        assert.equal(dirname(dirname(disk)), join(root, 'machines')); assert.equal(await realpath(dirname(disk)), dirname(disk));
        return execute(img, args, options);
      }
      assert.equal(tool, 'sakura-qemu'); assert.ok(vmId && !qemuStarted); qemuStarted = true;
      /** 转义正则表达式的元字符，按字面匹配夹具路径或标记，避免名称被解释为匹配规则。
       * Escape regular-expression metacharacters so fixture paths/markers match literally rather than act as pattern syntax. */
      const escape = (value: string) => value.replaceAll(',', ',,');
      const drives = args.flatMap((arg, index) => arg === '-drive' ? [args[index + 1]] : []);
      assert.deepEqual(drives, [`file=${escape(join(root, 'machines', vmId, 'disk.qcow2'))},if=virtio,id=sakura-disk,format=qcow2,${diskOptions(hardware)}`,
        `file=${escape(join(root, 'machines', vmId, 'seed.iso'))},media=cdrom,readonly=on`]);
      assert.ok(args.includes('-no-reboot'));
      for (const flag of ['-snapshot', '-blockdev', '-incoming', '-object', '-kernel', '-initrd', '-readconfig']) assert.ok(!args.includes(flag));
      return execute(qemu, args, options, true);
    } } as unknown as Engine;
  const machines = new Machines(engine);
  const spaces = new Workspaces(machines);
  const migrations = new ProjectDirectoryMigrations(machines, spaces), identities = new ProjectIdentities(machines);
  const terminals = new ProjectTerminals(machines, spaces), scopes = new ProjectRunScopes(machines);
  const projectParent = '/srv/projects/terminal-' + invocation;
  const channels = new Set<Awaited<ReturnType<typeof open>>>();
  /** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
   * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
  async function guest(command: string, timeout = 30000) {
    const result = await machines.exec(vmId, command, timeout);
    assert.equal(result.code, 0, result.stderr || result.stdout); return result.stdout.trim();
  }
  /** 按名称执行异步断言，成功后记录返回证据；异常直接传播，不记录通过。
   * By case name, run asynchronous assertions and retain returned evidence on success; propagate errors without recording a pass. */
  async function check(name: string, action: () => Promise<unknown>) {
    phase(name); const observation = await action(); proof.cases.push({ name, observation }); console.log('PASS ' + name);
  }
  /** 创建自有私有网络终端项目并确认迁移计划；仅新夹具的明确 NNP 拒绝允许重启 SSH/cron 后重试，旧夹具和其他错误不自动修复。
   * Create/authorize an owned private-network terminal project; only explicit NNP denial on a new fixture permits SSH/cron restart/retry, while old fixtures/other errors are not automatically repaired. */
  async function project(name: string) {
    const directory = projectParent + '/' + name; await guest('mkdir ' + quote(directory));
    const config = projectSchema.parse({ directory, networkIsolation: 'private', template: 'none' });
    const index = await spaces.projects.create(vmId, name + '-' + invocation.slice(0, 8), () => writeStore(projectMetadataFile(vmId, spaces.projects.current(vmId)), config));
    const identity = await spaces.projects.with(vmId, index.active, /** 正式迁移 preview 遇 NNP 重启拒绝时，仅新建自有 VM 可一次显式重启 sshd/crond，前后核实原 live+boot；既有目录或重复拒绝直接失败，再按冻结计划 apply 身份。
 * When formal migration preview requires NNP restart, only a fresh owned VM may restart sshd/crond once with original live/boot checks; existing directories/repeated refusal fail, then apply identity using the frozen plan. */ async () => {
      let preview: Awaited<ReturnType<typeof migrations.preview>>;
      try { preview = await migrations.preview(vmId); }
      catch (error) {
        // The new private-project binding installs the OpenRC NNP configuration.
        // Its already-running ordinary daemons must explicitly adopt that policy.
        // This matches smoke-project-egress-vm; production refusal stays intact.
        if (ownedDirectory || proof.nnpServiceRestart ||
            (error as { code?: string }).code !== 'PROJECT_IDENTITY_EGRESS_NNP_RESTART_REQUIRED') throw error;
        const live = machines.live.get(vmId); assert.ok(live);
        const bootId = await guest('cat /proc/sys/kernel/random/boot_id'); assert.match(bootId, /^[a-f0-9-]{36}$/);
        phase('new owned VM explicitly restarts SSH and cron after NNP admission refusal');
        proof.nnpServiceRestart = { refusal: { code: (error as { code: string }).code,
          message: error instanceof Error ? error.message : String(error) }, vmId, bootId,
          boundary: 'Only sshd/crond in this invocation fresh owned test VM; no preexisting VM or user session.',
          restarted: [] };
        // The engine already binds this VM to its exclusive private disk and
        // generated SSH key. Alpine Tiny Cloud does not expose cloud-init IDs.
        const sameBoot = 'test "$(cat /proc/sys/kernel/random/boot_id)" = ' + quote(bootId);
        for (const service of ['sshd', 'crond']) {
          assert.equal(machines.live.get(vmId), live);
          await guest('set -eu; ' + sameBoot + '; rc-service ' + service + ' restart');
          proof.nnpServiceRestart.restarted.push(service);
        }
        assert.equal(machines.live.get(vmId), live); await guest('set -eu; ' + sameBoot);
        preview = await migrations.preview(vmId);
        proof.nnpServiceRestart.retryAccepted = true;
      }
      assert.ok(preview.plan);
      const applied = await migrations.apply(vmId, { action: 'apply', version: 1, planId: preview.plan.proposal.planId,
        sha256: preview.plan.sha256, reviewed: true }); assert.equal(applied.plan?.state, 'applied');
      return applied.plan!.activatedIdentity!;
    });
    return { id: index.active, directory, identity };
  }
  /** 由生产 prepare 取得精确终端 lease，再经真实 SSH PTY attach，三分钟内要求初始化输出；返回流、观测和 lease 清理句柄。
   * Obtain the exact terminal lease through production prepare/attach via real SSH PTY and require initialized output within three minutes, returning stream/observation/lease-cleanup handles. */
  async function open(id: string, session?: string, readOnly = false, terminalId?: string) {
    const lease = await terminals.prepare(vmId, id, session, readOnly, undefined, terminalId);
    const ssh = await machines.connect(vmId); let output = '';
    const stream = await new Promise<import('ssh2').ClientChannel>((resolve, reject) => {
      ssh.exec(lease.command, { pty: { term: 'xterm-256color', cols: 100, rows: 28 } }, (error, channel) => {
        if (error) reject(error); else resolve(channel);
      });
    });
    stream.on('data', (bytes: Buffer) => { output += bytes.toString(); });
    stream.stderr.on('data', (bytes: Buffer) => { output += bytes.toString(); });
    const connection = { lease, ssh, stream, /** 读取本次 PTY 累积的两路输出，供交互就绪和命令结果断言。
 * Read both accumulated PTY outputs for interactive readiness/command-result assertions. */ output: () => output,
      /** 关闭 PTY 与 SSH，再等待精确 lease.release 并移除本连接登记，撤销生产终端所有者。
       * Close PTY/SSH, await exact lease.release and remove this connection registration to revoke the production terminal owner. */
      close: async () => { stream.close(); ssh.end(); await lease.release(); channels.delete(connection); } };
    channels.add(connection);
    const deadline = Date.now() + 180000;
    while (!output.includes('\x1b[')) {
      assert.ok(Date.now() < deadline && !stream.closed, output || 'PTY attach did not initialize'); await delay(100);
    }
    return connection;
  }
  /** 在六十秒内读取自有目录的指定 JSON 标记，未发布即失败，避免复用缺失身份报告。
   * Read the owned directory’s JSON marker within sixty seconds, failing on absence rather than using missing identity reports. */
  async function observed(directory: string, name: string) {
    const deadline = Date.now() + 60000;
    for (;;) {
      const result = await machines.exec(vmId, 'cat ' + quote(directory + '/' + name), 10000);
      if (result.code === 0) return JSON.parse(result.stdout);
      assert.ok(Date.now() < deadline, 'project terminal did not write ' + name); await delay(200);
    }
  }
  try {
    await machines.init(); const records = await machines.list();
    if (ownedDirectory) {
      assert.equal(records.length, 1); assert.equal(records[0].id, prior.vmId);
      assert.equal(records[0].name, 'terminal-identity-alpine'); assert.equal(records[0].distro, 'alpine');
      assert.equal(machines.state(prior.vmId), 'stopped'); vmId = prior.vmId;
    } else {
      assert.equal(records.length, 0);
      vmId = (await machines.create({ name: 'terminal-identity-alpine', distro: 'alpine', ...hardware,
        diskGiB: 8, accelerator: 'tcg', forwards: [] })).id;
    }
    proof.vmId = vmId; phase(ownedDirectory ? 'new boot of closed owned fixture' : 'fresh owned Alpine boot'); await machines.start(vmId);
    const deadline = Date.now() + 300000;
    while (machines.state(vmId) === 'starting' && Date.now() < deadline) await delay(250);
    assert.equal(machines.state(vmId), 'running', (await machines.view(vmId)).lastError);
    phase('compile fixed native identity and install tmux'); await identities.install(vmId);
    await guest('apk add --no-cache tmux iproute2', 180000);
    await guest('mkdir -p /srv/projects; mkdir ' + quote(projectParent) + '; chmod 755 /srv/projects ' + quote(projectParent));
    const alpha = await project('alpha'), beta = await project('beta');
    await guest('printf protected > ' + quote(beta.directory + '/private.txt') + '; chown ' + beta.identity.uid + ':' +
      beta.identity.gid + ' ' + quote(beta.directory + '/private.txt') + '; chmod 600 ' + quote(beta.directory + '/private.txt'));
    let namedId = '';
    await check('actual interactive PTY runs as the private project UID and cannot read another project', /** 通过项目 PTY 验证实际 UID/GID/Home、TTY、原 cgroup/网络且邻目录不可读；关闭匿名终端后原域必须消失，返回来宾观测。
 * Verify actual UID/GID/Home, TTY, original cgroup/network and neighbor-directory denial through project PTY; after anonymous-terminal close require original-domain disappearance and return guest observations. */ async () => {
      const connection = await open(alpha.id);
      const script = `import json,os\ndenied=False\ntry:open(${JSON.stringify(beta.directory + '/private.txt')}).read()\nexcept PermissionError:denied=True\nassert denied\njson.dump({'uid':os.getuid(),'gid':os.getgid(),'home':os.environ['HOME'],'tty':os.isatty(0),'scope':open('/proc/self/cgroup').read().strip(),'namespace':str(os.stat('/proc/self/ns/net').st_ino),'otherProjectDenied':denied},open('pty.json','w'))`;
      connection.stream.write('/usr/bin/python3 -I -S -c ' + quote(script) + '\r');
      const actual = await observed(alpha.directory, 'pty.json');
      assert.equal(actual.uid, alpha.identity.uid); assert.equal(actual.gid, alpha.identity.gid);
      assert.equal(actual.home, alpha.identity.home); assert.equal(actual.tty, true);
      const ticket = await scopes.terminalRun(vmId, alpha.id, connection.lease.terminalId!);
      assert.equal(actual.scope, '0::/' + ticket.run.cgroupName); assert.equal(actual.namespace, ticket.run.networkInode);
      await connection.close();
      await guest('test ! -e ' + quote('/sys/fs/cgroup/' + ticket.run.cgroupName));
      return actual;
    });
    await check('named terminals and additional windows retain UID and full ownership across disconnect', /** 命名终端创建额外 tmux 窗口，客户端关闭后用正式票据重连须复用 terminalId；后台窗仍为项目 UID 且位于原终端域。
 * Create an extra tmux window in a named terminal and require formal-receipt reconnection to reuse terminalId after client closure; the background window retains project UID/original terminal domain. */ async () => {
      const connection = await open(alpha.id, 'main'); namedId = connection.lease.terminalId!;
      const child = '/bin/sh -c ' + quote('echo $$ > window.pid; exec sleep 600');
      connection.stream.write('tmux new-window -d -n worker ' + quote(child) + '; printf \'{"created":true}\' > window.json\r');
      assert.equal((await observed(alpha.directory, 'window.json')).created, true);
      await connection.close();
      const saved = await scopes.terminalRun(vmId, alpha.id, namedId);
      const checked = await identities.terminal(vmId, saved.identity, saved.run, saved.terminal.name);
      const connected = await open(alpha.id, 'main'); assert.equal(connected.lease.terminalId, namedId); await connected.close();
      const windowPid = Number(await guest('cat ' + quote(alpha.directory + '/window.pid')));
      const status = await guest('/usr/bin/python3 -I -S -c ' + quote(`import json,os\np=${windowPid}\nprint(json.dumps({'uid':os.stat('/proc/'+str(p)).st_uid,'scope':open('/proc/'+str(p)+'/cgroup').read().strip()}))`));
      const window = JSON.parse(status); assert.equal(window.uid, alpha.identity.uid); assert.equal(window.scope, '0::/' + saved.run.cgroupName);
      return { terminalId: namedId, checked, window };
    });
    await check('readonly terminal attachment rejects typed shell commands', async () => {
      const viewer = await open(alpha.id, 'main', true, namedId);
      viewer.stream.write('printf forbidden > readonly-write.txt\r'); await delay(1500);
      await guest('test ! -e ' + quote(alpha.directory + '/readonly-write.txt')); await viewer.close();
      return { terminalId: namedId, readonlyWriteRefused: true };
    });
    await check('exact terminal stop kills detached windows and invalidates the old shared UUID', /** 停止命名终端必须删精确 cgroup、控制目录及身份票据，旧共享 ID 永久 stale；新终端发新 ID 且邻项目终端仍可核验，最后关两者。
 * Stopping a named terminal must remove its exact cgroup/control directory/identity receipt and permanently stale the shared ID; fresh terminals get new IDs while neighbor verification works, then close both. */ async () => {
      const saved = await scopes.terminalRun(vmId, alpha.id, namedId);
      const betaConnection = await open(beta.id, 'main'); await betaConnection.close();
      await terminals.stop(vmId, alpha.id, 'main');
      await guest('test ! -e ' + quote('/sys/fs/cgroup/' + saved.run.cgroupName) + '; test ! -e ' +
        quote('/run/sakura-project-terminals/' + namedId) + '; test ! -e ' +
        quote('/run/sakura-project-identities/terminals/' + namedId + '.json'));
      await assert.rejects(terminals.prepare(vmId, alpha.id, 'main', true, undefined, namedId), { code: 'PROJECT_TERMINAL_SHARE_STALE' });
      const next = await open(alpha.id, 'main'); assert.notEqual(next.lease.terminalId, namedId); await next.close();
      await assert.rejects(terminals.prepare(vmId, alpha.id, 'main', true, undefined, namedId), { code: 'PROJECT_TERMINAL_SHARE_STALE' });
      const betaSaved = await scopes.terminalRun(vmId, beta.id, betaConnection.lease.terminalId!);
      await identities.terminal(vmId, betaSaved.identity, betaSaved.run, betaSaved.terminal.name);
      await terminals.stop(vmId, alpha.id); await terminals.stop(vmId, beta.id);
      return { original: namedId, replacement: next.lease.terminalId, otherProjectPreserved: true, exactResourcesAbsent: true };
    });
    await check('terminal payload requires an actual read/write PTY and never accepts ordinary output pipes', async () => {
      const run = await identities.prepare(vmId, alpha.identity);
      try {
        const plan = identities.input(alpha.identity, run, { command: "printf forbidden > no-pty.txt" });
        plan.input.writeUInt32LE(1, 12);
        const sha = hash(plan.input), command = plan.command.replace(plan.sha256, sha);
        const result = await machines.execInput(vmId, command, plan.input, 30000);
        assert.notEqual(result.code, 0); assert.match(result.stderr, /PAYLOAD_TERMINAL_REQUIRED/);
        await guest('test ! -e ' + quote(alpha.directory + '/no-pty.txt'));
        return { code: result.code, refusal: 'PAYLOAD_TERMINAL_REQUIRED', projectCodeExecuted: false };
      } finally { await identities.stop(vmId, alpha.identity, run); }
    });
    proof.bodyPassed = true;
  } catch (error) { proof.error = error instanceof Error ? error.stack || error.message : String(error); console.error(error); }
  finally {
    for (const connection of [...channels]) { try { await connection.close(); } catch (error) { proof.cleanupErrors.push(String(error)); } }
    try {
      if (vmId && machines.state(vmId) === 'running') {
        const catalog = await spaces.projects.list(vmId);
        for (const project of catalog.projects) await terminals.stop(vmId, project.id);
      }
    } catch (error) { proof.cleanupErrors.push(String(error)); }
    try { await terminals.close(); } catch (error) { proof.cleanupErrors.push(String(error)); }

    await writeFile(join(root, 'boot-' + invocation + '.log'), machines.logs.get(vmId) || '', { flag: 'wx' });
    try { await spaces.close(); } catch (error) { proof.cleanupErrors.push(String(error)); }
    try { if (vmId) { const done = machines.live.get(vmId)?.done; await machines.stop(vmId, true); if (done) await done; proof.vmStopped = machines.state(vmId) === 'stopped'; } }
    catch (error) { proof.cleanupErrors.push(String(error)); }
    try { await machines.close(); } catch (error) { proof.cleanupErrors.push(String(error)); }
    proof.liveEntries = machines.live.size; proof.ownedChildren = children.size;
    if (vmId && process.platform === 'win32') {
      const query = "$ProgressPreference='SilentlyContinue';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$p=@(Get-CimInstance Win32_Process|Where-Object { $_.ExecutablePath -eq $r.image -and $_.CommandLine -and $_.CommandLine.Contains($r.disk) });[Console]::Out.WriteLine($p.Count)";
      proof.exactQemuMatches = Number(execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(query, 'utf16le').toString('base64')],
        { input: JSON.stringify({ image: qemu, disk: join(root, 'machines', vmId, 'disk.qcow2') }), encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim());
    }
    const changed = [];
    for (const [file, checksum] of Object.entries(proof.sourceSha256)) if (hash(await readFile(join(workspace, file))) !== checksum) changed.push(file);
    for (const [file, checksum] of Object.entries(proof.binarySha256)) if (hash(await readFile(file)) !== checksum) changed.push(file);
    const afterImage = await lstat(image); proof.originalImageUnchanged = hash(await readFile(image)) === imageSha256 &&
      afterImage.ino === imageInfo.ino && afterImage.size === imageInfo.size && afterImage.mtimeMs === imageInfo.mtimeMs;
    proof.changed = changed; proof.finishedAt = new Date().toISOString();
    proof.passed = proof.bodyPassed === true && proof.cases.length === 5 && !proof.cleanupErrors.length && !changed.length &&
      proof.originalImageUnchanged && proof.vmStopped && proof.liveEntries === 0 && proof.ownedChildren === 0 && proof.exactQemuMatches === 0 &&
      proof.executions.every((entry: any) => entry.exit && entry.close && entry.stdoutClosed && entry.stderrClosed);
    const proofFile = join(root, 'project-terminal-' + invocation + '.json');
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ proofFile, passed: proof.passed, cases: proof.cases.map((entry: any) => entry.name), cleanup: {
      vmStopped: proof.vmStopped, live: proof.liveEntries, children: proof.ownedChildren, exactQemu: proof.exactQemuMatches }, error: proof.error || null }));
  }
  if (!proof.passed) process.exitCode = 1;
}
