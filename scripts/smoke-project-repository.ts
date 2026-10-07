/** 烟雾验收：验证项目 Git 仓库认证、网络、操作与身份边界。
 * Smoke acceptance for project Git authentication/network/operations and identity boundaries. */
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
  console.log('Fresh disposable Alpine Git checkout check: --run-new alpine. Copies the cached standalone image, creates new SSH keys and a new VM, then tests the actual workspace setup/start routes, reviewed UID migration, authenticated object download, private checkout, existing/nonempty/empty repositories, reflected errors, redirect refusal and cancellation. Preserves all prior fixtures and shuts down only this new VM.');
} else {
  assert.deepEqual(process.argv.slice(2), ['--run-new', 'alpine']);
  assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  await run();
}

/** 建立真实自有仓库 HTTP 夹具和项目 UID，验收 clone/setup 的认证、私有网络、hooks/环境阻断及失败清理；所有 root 命令与资源归属留证。
 * Create real owned repository HTTP fixtures/project UIDs and verify clone/setup authentication/private networking/hooks-environment denial/failure cleanup, retaining root-command/resource ownership evidence. */
async function run() {
  const workspace = await realpath('.'), parent = join(workspace, '.data/project-repository-test-temp');
  await mkdir(parent, { recursive: true }); assert.equal(await realpath(parent), parent);
  const root = await mkdtemp(join(parent, 'sakura-repository-'));
  assert.equal(dirname(await realpath(root)), parent); assert.match(basename(root), /^sakura-repository-/);
  /** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
   * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
  const invocation = randomUUID(), hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  const proof: any = { version: 1, invocation, root, distro: 'alpine', passed: false, startedAt: new Date().toISOString(),
    sourceSha256: {}, executions: [], cases: [], phases: [], cleanupErrors: [], client: { node: process.version, execArgv: process.execArgv } };
  /** 保存阶段名与时间并输出进度，为中断或失败报告定位最后执行边界。
   * Retain phase name/time and print progress to locate the last execution boundary after interruption/failure. */
  const phase = (name: string) => { proof.phases.push({ name, at: new Date().toISOString() }); console.log('PHASE ' + name); };
  const files = ['server/project-repository.ts', 'server/project-repository-broker.py', 'server/repository-url.ts',
    'server/workspaces.ts', 'server/project-run-scope.ts', 'server/project-identity.ts', 'server/project-directory-migration.ts',
    'server/guest-task.ts', 'server/machines.ts', 'server/project-main.ts', 'server/project-service-scope.ts', 'server/project-services.ts',
    'server/project-network-isolation.ts', 'server/project-dependency-cache.ts', 'server/dependency-downloads.ts', 'server/network-profiles.ts',
    'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py',
    'scripts/smoke-project-repository.ts', 'scripts/project-repository-fixture.py', 'package.json', 'package-lock.json'];
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
  const ownImages = join(root, 'images'); await mkdir(ownImages);
  const base = join(ownImages, 'alpine-3.23.qcow2'); await copyFile(image, base, constants.COPYFILE_EXCL);
  assert.equal(hash(await readFile(base)), imageSha256);
  proof.base = { original: image, originalSha256: imageSha256, privateCopy: base, copiedSha256: imageSha256 };
  process.env.SAKURA_DATA_DIR = root; process.env.SAKURA_IMAGE_DIR = ownImages; process.env.SAKURA_IMAGE_PATH = base;
  process.env.TEMP = process.env.TMP = root;
  const { Machines } = await import('../server/machines.ts');
  const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
  const { Secrets } = await import('../server/secrets.ts');
  const { NetworkProfiles } = await import('../server/network-profiles.ts');
  const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
  const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
  const { projectIdentityTask } = await import('../server/project-run-scope.ts');
  const { guestTask } = await import('../server/guest-task.ts');
  const { quote } = await import('../server/files.ts');
  const { writeStore } = await import('../server/local-store.ts');
  const { vmDir } = await import('../server/model.ts');
  const sources = await projectIdentitySources(); proof.identityBuild = sources.manifest;
  for (const entry of sources.manifest.files) assert.equal(entry.sha256, proof.sourceSha256['native/project-identity/' + entry.name]);
  const qemu = join(workspace, '.tools/qemu/qemu-system-x86_64.exe'), img = join(workspace, '.tools/qemu/qemu-img.exe');
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
  const unsupported = () => { throw new Error('Unknown repository test engine operation'); };
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
  const machines = new Machines(engine), secrets = new Secrets(machines), network = new NetworkProfiles(machines);
  const spaces = new Workspaces(machines, { secrets, network });
  const migrations = new ProjectDirectoryMigrations(machines, spaces), identities = new ProjectIdentities(machines);
  const fixtureAbort = new AbortController(); let fixture: Promise<unknown> | undefined; let fixtureFailure: unknown;
  const token = 'owned-git-' + randomBytes(24).toString('hex');
  const fixtureDirectory = '/run/sakura-repository-fixture.' + invocation;
  const projectParent = '/srv/projects/repository-' + invocation;
  /** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
   * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
  const guest = async (command: string, timeout = 30_000) => {
    const result = await machines.exec(vmId, command, timeout); assert.equal(result.code, 0, result.stderr || result.stdout); return result.stdout.trim();
  };
  /** 用真实 SFTP wx/0600 写入专用夹具文件，拒绝覆盖已有路径。
   * Write dedicated fixture files using real SFTP wx/0600 and reject existing paths. */
  const write = (path: string, value: string) => machines.sftp(vmId, ftp =>
    pipeline(Readable.from([Buffer.from(value)]), ftp.createWriteStream(path, { flags: 'wx', mode: 0o600 })));
  /** 执行前后检查仓库夹具异步失败，再保存成功观测；夹具故障即使操作返回也必须使场景失败。
   * Check asynchronous repository-fixture failures before/after work, retaining success only when neither failed; fixture faults fail even if operations returned. */
  const check = async (name: string, work: /** 仓库用例异步工作返回观测，外层在已有夹具失败时跳过并记录结果；工作异常仍传播以触发资源清理。
 * Repository-case work returns observations; the outer wrapper skips after fixture failure and records outcomes while propagating operation errors for cleanup. */ () => Promise<unknown>) => {
    if (fixtureFailure) throw fixtureFailure; phase(name); const observation = await work();
    if (fixtureFailure) throw fixtureFailure;
    proof.cases.push({ name, observation }); console.log('PASS ' + name); };
  /** 在精确项目上下文运行并返回工作结果，固定仓库配置与账号归属。
   * Execute/return work in the exact project context, binding repository settings/account ownership. */
  const projectScope = <T>(id: string, work: /** 在选定仓库项目作用域执行异步 work 并返回 T，绑定下载/设置请求到目标身份。
 * Execute asynchronous work in the selected repository project scope and return T, binding download/setup requests to the target identity. */ () => Promise<T>) => spaces.projects.with(vmId, id, work);
  /** 读取自有仓库请求 JSONL 并逐行解析，返回实际服务流量证据。
   * Read/parse owned repository request JSONL and return actual service-traffic evidence. */
  const requests = async () => (await guest(`cat ${quote(fixtureDirectory + '/requests.jsonl')}`)).split('\n').filter(Boolean).map(line => JSON.parse(line));
  /** 运行项目 setup/start/stop 并等任务，验证输出不含认证令牌；失败额外保存仓库请求诊断，返回终态供场景比较。
   * Run project setup/start/stop/await its job and reject token leakage; on failure retain repository-request diagnostics and return the final record for scenario comparison. */
  const runAction = (id: string, action: 'setup' | 'start' | 'stop') => projectScope(id, async () => {
    await spaces.run(vmId, action); const key = spaces.projects.key(vmId); await spaces.jobs.wait(key);
    const result = spaces.jobs.view(key)!; assert.ok(!JSON.stringify(result).includes(token));
    if (result.status === 'error') {
      const diagnostics = await requests();
      (proof.jobFailures ||= []).push({ projectId: id, action, error: result.error, diagnostics });
      console.log(JSON.stringify({ expectedOrUnexpectedJobFailure: { projectId: id, action, error: result.error, diagnostics } }));
    }
    return result;
  });
  // Observe a failed admission before runProjectMain rolls its exact scope back.
  // These diagnostics are confined to this fresh test VM and contain no input frame.
  const nativeInput = machines.execInput.bind(machines);
  /** 仅观察正式主进程启动标记，按精确 guest 路径读取 owner、锁、PID/cgroup 与 tmux 诊断，帮助定位受保护入场等待。
   * Observe only production main-start markers and read owner/lock/PID-cgroup/tmux diagnostics at the exact guest path to diagnose protected admission waits. */
  const captureMainAdmission = async (command: string) => {
    if (!command.startsWith('# SAKURA_PROJECT_MAIN_START')) return;
    const line = command.split('\n').find(value => value.startsWith('# SAKURA_PROJECT_MAIN_REQUEST='))!;
    const request = JSON.parse(Buffer.from(line.split('=')[1], 'base64').toString());
    const code = `import json,os,subprocess,time
folder=${JSON.stringify(request.guest)}
record=json.load(open(folder+'/owner.json'))
result={'record':record,'monotonic':time.monotonic(),'processes':{}}
def snapshot(pid):
 value={'pid':pid}
 for name in ['stat','cgroup','wchan','stack']:
  try:value[name]=open('/proc/'+str(pid)+'/'+name).read()[:8192]
  except OSError as e:value[name]={'errno':e.errno}
 return value
if record['panePid'] is not None:
 result['processes']['pane']=snapshot(record['panePid'])
 status=result['processes']['pane'].get('stat')
 if isinstance(status,str):result['processes']['parent']=snapshot(int(status.rsplit(') ',1)[1].split()[1]))
info=os.stat(folder+'/lock');result['lock']={'device':str(info.st_dev),'inode':str(info.st_ino)}
result['locks']=open('/proc/locks').read()[:16384]
for name,args in [('pane',['capture-pane','-p','-t',record['paneId'] or request['session'],'-S','-50']),('server',['display-message','-p','#{pid}'])]:
 run=subprocess.run(['/usr/bin/tmux']+args,capture_output=True,text=True)
 result[name]={'code':run.returncode,'stdout':run.stdout[:8192],'stderr':run.stderr[:8192]}
print(json.dumps(result))`;
    try {
      const captured = await machines.exec(vmId, '/usr/bin/python3 -I -S -c ' + quote(code), 60_000);
      assert.ok(!captured.stdout.includes(token) && !captured.stderr.includes(token));
      (proof.mainAdmissionDiagnostics ||= []).push({ code: captured.code, stdout: captured.stdout, stderr: captured.stderr });
      console.log(JSON.stringify({ mainAdmissionDiagnostics: proof.mainAdmissionDiagnostics.at(-1) }));
    } catch (error) { (proof.mainAdmissionDiagnostics ||= []).push({ error: String(error) }); }
  };
  machines.execInput = (/** 真实 execInput 抛错或非零后补采 main 入场证据，再返回原结果/重抛原错误；用于核验失败前是否已取得原运行资源。
 * Capture main-admission evidence after real execInput throws or exits nonzero, then preserve the original result/error to establish whether original run resources were acquired before failure. */ async (...args: Parameters<typeof machines.execInput>) => {
    let result;
    try { result = await nativeInput(...args); }
    catch (error) { await captureMainAdmission(args[1]); throw error; }
    if (result.code !== 0) await captureMainAdmission(args[1]);
    return result;
  }) as typeof machines.execInput;
  let endpoint = '', credentialReads = 0;
  const originalValue = secrets.value.bind(secrets);
  secrets.value = /** 只对 git-reader 密钥读取计数，所有名称仍调用正式 Secrets.value 并返回原值，证明预检拒绝未提前取凭据。
 * Count only git-reader credential reads while forwarding every name to formal Secrets.value, proving preflight refusals did not read credentials early. */ async (id, name) => { if (name === 'git-reader') ++credentialReads; return originalValue(id, name); };
  /** 建立自有目录、仓库 URL 和故意不安全环境，正式创建项目并确认迁移计划授权；返回 ID/配置/身份供 hooks 与认证边界验收。
   * Create owned directories/repository URLs/intentionally unsafe environment, use production project creation/reviewed migration and return ID/settings/identity for hooks/authentication boundary checks. */
  const createProject = async (name: string, remote: string, setup = '', networkIsolation: 'private' | 'host' = 'private') => {
    const directory = projectParent + '/' + name; await guest(`mkdir ${quote(directory)}`);
    const config = projectSchema.parse({ directory, networkIsolation, repository: endpoint + '/' + remote,
      template: 'none', setup, environment: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: fixtureDirectory, PYTHONPATH: fixtureDirectory, GIT_ASKPASS: fixtureDirectory + '/forbidden-askpass' } });
    const index = await spaces.projects.create(vmId, name, () => writeStore(projectMetadataFile(vmId, spaces.projects.current(vmId)), config));
    const id = index.active;
    const applied = await projectScope(id, async () => {
      const preview = await migrations.preview(vmId); assert.ok(preview.plan); assert.equal(preview.plan.state, 'preview');
      const result = await migrations.apply(vmId, { action: 'apply', version: 1, planId: preview.plan.proposal.planId,
        sha256: preview.plan.sha256, reviewed: true }); assert.equal(result.plan?.state, 'applied'); return result.plan!.activatedIdentity!;
    });
    return { id, directory, identity: applied };
  };
  try {
    const info = JSON.parse(await execute(img, ['info', '--output=json', base])); assert.equal(info.format, 'qcow2'); assert.equal(info['backing-filename'], undefined);
    await machines.init(); assert.equal((await machines.list()).length, 0);
    vmId = (await machines.create({ name: 'repository-alpine', distro: 'alpine', ...hardware, diskGiB: 8, accelerator: 'tcg', forwards: [] })).id;
    proof.vmId = vmId; console.log(JSON.stringify({ root, vmId, identityBuild: sources.manifest.build }));
    phase('fresh Alpine boot'); await machines.start(vmId);
    const deadline = Date.now() + 300_000; while (machines.state(vmId) === 'starting' && Date.now() < deadline) await delay(250);
    assert.equal(machines.state(vmId), 'running', (await machines.view(vmId)).lastError);
    phase('install fixed native identity and Git tools'); await identities.install(vmId);
    // Alpine places its server-only CGI in git-daemon; the product client only
    // needs git. See alpinelinux/aports 3.23-stable main/git/APKBUILD daemon().
    await guest('apk add --no-cache git git-daemon tmux iproute2', 180_000);
    proof.gitVersion = await guest('/usr/bin/git --version; test -x "$(/usr/bin/git --exec-path)/git-http-backend"');
    await guest(`umask 077; mkdir ${quote(fixtureDirectory)}; mkdir -p /srv/projects; mkdir ${quote(projectParent)}; chmod 755 /srv/projects ${quote(projectParent)}`);
    await write(fixtureDirectory + '/token.json', JSON.stringify({ token }));
    await write(fixtureDirectory + '/server.py', await readFile(join(workspace, 'scripts/project-repository-fixture.py'), 'utf8'));
    await write(fixtureDirectory + '/post-checkout', '#!/bin/sh\nprintf forbidden > ' + quote(fixtureDirectory + '/forbidden-hook') + '\n');
    await guest(`chmod 755 ${quote(fixtureDirectory + '/post-checkout')}; touch ${quote(fixtureDirectory + '/requests.jsonl')}`);
    phase('start owned smart-HTTP fixture');
    fixture = guestTask(machines, vmId, `env -i PATH=/usr/bin:/bin HOME=/ LANG=C LC_ALL=C /usr/bin/python3 -I -S ${quote(fixtureDirectory + '/server.py')} ${quote(fixtureDirectory)}`,
      fixtureAbort.signal, undefined, 6_000_000).then(() => {
        if (!fixtureAbort.signal.aborted) throw new Error('Owned Git fixture exited before test completion');
      }).catch(error => {
        // Consume the rejection immediately; report it through the normal test
        // result so an early fixture failure cannot orphan the owned QEMU.
        if (!fixtureAbort.signal.aborted || /CLEANUP_FAILED$/.test(error?.code || '')) fixtureFailure = error;
      });
    const ready = JSON.parse(await guest(`for i in $(seq 1 100); do if [ -s ${quote(fixtureDirectory + '/ready.json')} ]; then cat ${quote(fixtureDirectory + '/ready.json')}; exit 0; fi; sleep 0.2; done; exit 1`, 60_000));
    endpoint = 'http://127.0.0.1:' + ready.port;
    await secrets.save(vmId, { name: 'git-reader', value: token });
    const preview = await network.preview(vmId, { dependencyDownloads: { git: { kind: 'bearer', endpoint: endpoint + '/', tokenSecret: 'git-reader' } } });
    await network.apply(vmId, preview.config, preview.token);
    const setup = `/usr/bin/python3 -I -S -c ${quote(`import json,os,urllib.request\nblocked=False\ntry: urllib.request.urlopen('${endpoint}/public.git/info/refs?service=git-upload-pack',timeout=2)\nexcept OSError: blocked=True\nassert blocked\njson.dump({'uid':os.getuid(),'gid':os.getgid(),'networkBlocked':blocked},open('setup.json','w'))`)}`;
    const authenticated = await createProject('authenticated', 'private.git', setup);
    await check('workspace authenticated private first checkout and setup UID', async () => {
      const job = await runAction(authenticated.id, 'setup'); assert.equal(job.status, 'done', job.error);
      const observed = JSON.parse(await guest(`cat ${quote(authenticated.directory + '/setup.json')}`));
      assert.equal(observed.uid, authenticated.identity.uid); assert.equal(observed.gid, authenticated.identity.gid); assert.equal(observed.networkBlocked, true);
      const result = await projectScope(authenticated.id, async () => projectIdentityTask(machines, vmId, await spaces.config(vmId),
        { command: "env -i PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git symbolic-ref HEAD; env -i PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git rev-parse HEAD; env -i PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git remote get-url origin; cat hello.txt" }, new AbortController().signal));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout.trim(), ['refs/heads/main', ready.commit, endpoint + '/private.git', 'owned repository source'].join('\n'));
      const downloaded = await requests(); assert.ok(downloaded.length); assert.ok(downloaded.every(value => value.authorized && value.path.startsWith('/private.git/')));
      await guest(`test ! -e ${quote(fixtureDirectory + '/forbidden-hook')}; test ! -e ${quote(authenticated.directory + '/unused')}`);
      return { ...observed, head: 'refs/heads/main', commit: ready.commit, requestCount: downloaded.length, credentialInLogs: false };
    });
    await check('existing repository skips network and credential resolution', async () => {
      const before = (await requests()).length, reads = credentialReads;
      const job = await runAction(authenticated.id, 'setup'); assert.equal(job.status, 'done', job.error);
      assert.equal((await requests()).length, before); assert.equal(credentialReads, reads);
      return { unchangedRequestCount: before, unchangedCredentialReads: reads };
    });
    await check('project main starts and stops without affecting the download fixture', async () => {
      await projectScope(authenticated.id, async () => spaces.save(vmId, { ...(await spaces.config(vmId)),
        command: `/usr/bin/python3 -I -S -c ${quote("import os,json;json.dump({'uid':os.getuid(),'gid':os.getgid()},open('main.json','w'))")}; sleep 300` }));
      const started = await runAction(authenticated.id, 'start'); assert.equal(started.status, 'done', started.error);
      const observed = JSON.parse(await guest(`for i in $(seq 1 100); do if [ -s ${quote(authenticated.directory + '/main.json')} ]; then cat ${quote(authenticated.directory + '/main.json')}; exit 0; fi; sleep 0.2; done; exit 1`, 60_000)); assert.equal(observed.uid, authenticated.identity.uid);
      const stopped = await runAction(authenticated.id, 'stop'); assert.equal(stopped.status, 'done', stopped.error);
      await guest(`/usr/bin/python3 -I -S -c ${quote(`import os;os.kill(${ready.pid},0)`)}`);
      return { ...observed, fixtureStillAlive: true };
    });
    const nonempty = await createProject('nonempty', 'private.git'); await guest(`printf preserved > ${quote(nonempty.directory + '/existing.txt')}; chown ${nonempty.identity.uid}:${nonempty.identity.gid} ${quote(nonempty.directory + '/existing.txt')}`);
    await check('nonempty directory is preserved before credentials or network', async () => {
      const before = (await requests()).length, reads = credentialReads;
      const job = await runAction(nonempty.id, 'setup'); assert.equal(job.status, 'error'); assert.match(job.error || '', /目录为空/);
      assert.equal(await guest(`cat ${quote(nonempty.directory + '/existing.txt')}`), 'preserved');
      assert.equal((await requests()).length, before); assert.equal(credentialReads, reads);
      return { filePreserved: true, credentialReadsUnchanged: true, networkUnchanged: true };
    });
    const empty = await createProject('empty', 'empty.git');
    await check('empty repository initializes under the project UID', async () => {
      const job = await runAction(empty.id, 'setup'); assert.equal(job.status, 'done', job.error);
      const owner = await guest(`stat -c '%u:%g' ${quote(empty.directory + '/.git')}`); assert.equal(owner, empty.identity.uid + ':' + empty.identity.gid);
      return { owner, empty: true };
    });
    await check('redirect and reflected upstream errors fail without credential disclosure', async () => {
      for (const remote of ['redirect.git', 'error.git']) {
        const project = await createProject(remote.replace('.git', ''), remote);
        const job = await runAction(project.id, 'setup'); assert.equal(job.status, 'error'); assert.match(job.error || '', /Git 对象预取失败/);
        assert.ok(!JSON.stringify(job).includes(token)); await guest(`test ! -e ${quote(project.directory + '/.git')}`);
      }
      assert.ok((await requests()).every(value => !value.path.startsWith('/foreign.git/')));
      return { redirectedRequests: 0, credentialInLogs: false, worktreesUntouched: true };
    });
    const observer = await createProject('shared-observer', 'public.git', '', 'host');
    const cancelled = await createProject('cancelled', 'slow.git');
    await check('cancelled download retires its cgroup and exact protected resources', /** 启动慢仓库下载后以邻 UID 验证 root 环境不可读、公用 nonce 不可访问，再取消；要求下载目录、完整 cgroup 和状态均关闭。
 * After starting slow repository download, use a neighbor UID to prove root environment unreadable/public nonce unusable, then cancel and require download-directory/whole-cgroup/state closure. */ async () => {
      await projectScope(cancelled.id, /** 在被取消项目作用域等待真实 slow.git 请求，核实 pending 下载票据；邻身份观测完成后取消并等待正式 job，不能以发送 cancel 代替取消已完成。
 * Within the cancelled project scope await a real slow.git request and validate its pending download receipt; after neighbor observation cancel and await the formal job instead of equating cancel delivery with completion. */ async () => {
        await spaces.run(vmId, 'setup'); const key = spaces.projects.key(vmId), deadline = Date.now() + 600_000;
        while (!(await requests()).some(value => value.path.startsWith('/slow.git/'))) { assert.ok(Date.now() < deadline); await delay(200); }
        const pending = JSON.parse(await readFile(join(vmDir(vmId), 'project-repository-' + cancelled.id + '.json'), 'utf8'));
        assert.equal(pending.phase, 'pending');
        const source = `import glob,hashlib,json,os,urllib.request,urllib.error\nroot='/run/sakura-repository-download.${pending.owner.runId.replaceAll('-', '')}/repository.git'\nfound=None\nfor path in glob.glob('/proc/[0-9]*/cmdline'):\n try:\n  if os.stat(path).st_uid!=0: continue\n  parts=open(path,'rb').read().split(b'\\0')\n  if root.encode() not in parts: continue\n  url=next((p.decode() for p in parts if p.startswith(b'http://127.0.0.1:')),None)\n  if url: found=(path.rsplit('/',1)[0],url);break\n except (OSError,UnicodeError): pass\nassert found\nprocess,url=found\nassert '/sakura-task-${pending.owner.runId}' in open(process+'/cgroup').read()\nprotected=False\ntry: open(process+'/environ','rb').read()\nexcept PermissionError: protected=True\nassert protected\ndenied=False\ntry: urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url+'/info/refs?service=git-upload-pack',timeout=2)\nexcept urllib.error.HTTPError as e: denied=e.code==403\nassert denied\nprint(json.dumps({'uid':os.getuid(),'rootEnvironmentProtected':protected,'publicNonceDenied':denied,'urlSha256':hashlib.sha256(url.encode()).hexdigest()}))`;
        const denied = await projectScope(observer.id, async () => projectIdentityTask(machines, vmId, await spaces.config(vmId),
          { command: '/usr/bin/python3 -I -S -c ' + quote(source) }, new AbortController().signal));
        assert.equal(denied.code, 0, denied.stderr);
        const observed = JSON.parse(denied.stdout); assert.equal(observed.uid, observer.identity.uid);
        proof.sharedObserver = observed;
        spaces.jobs.cancel(key); await spaces.jobs.wait(key);
        const result = spaces.jobs.view(key)!; assert.equal(result.status, 'cancelled', result.error);
      });
      const state = JSON.parse(await readFile(join(vmDir(vmId), 'project-repository-' + cancelled.id + '.json'), 'utf8'));
      assert.equal(state.phase, 'closed'); await guest(`test ! -e ${quote('/run/sakura-repository-download.' + state.owner.runId.replaceAll('-', ''))}; test ! -e ${quote('/sys/fs/cgroup/sakura-task-' + state.owner.runId)}`);
      return { phase: state.phase, downloaderScopeAbsent: true, exactDirectoryAbsent: true, sharedUIDCannotUsePublicNonce: true };
    });
    await guest(`test ! -e ${quote(fixtureDirectory + '/forbidden-hook')}`);
    const stages = await guest("find /run -maxdepth 1 -name 'sakura-repository-download.*' -print"); assert.equal(stages, '');
    proof.bodyPassed = true;
  } catch (error) { proof.error = error instanceof Error ? error.message : String(error); console.error(error); }
  finally {
    fixtureAbort.abort(); if (fixture) await fixture;
    if (fixtureFailure) proof.cleanupErrors.push(String(fixtureFailure));
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
    proof.passed = proof.bodyPassed === true && proof.cases.length === 7 && !proof.cleanupErrors.length && !changed.length &&
      proof.originalImageUnchanged && proof.vmStopped && proof.liveEntries === 0 && proof.ownedChildren === 0 && proof.exactQemuMatches === 0 &&
      proof.executions.every((entry: any) => entry.exit && entry.close && entry.stdoutClosed && entry.stderrClosed);
    const proofFile = join(root, 'project-repository-' + invocation + '.json');
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ proofFile, passed: proof.passed, cases: proof.cases.map((entry: any) => entry.name), cleanup: {
      vmStopped: proof.vmStopped, live: proof.liveEntries, children: proof.ownedChildren, exactQemu: proof.exactQemuMatches }, error: proof.error || null }));
  }
  if (!proof.passed) process.exitCode = 1;
}
