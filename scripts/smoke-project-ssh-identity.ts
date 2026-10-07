/** 烟雾验收：验证项目 SSH 的持久账户、目录/网络绑定及真实客户端身份。
 * Smoke acceptance for persistent SSH accounts, directory/network binding and real client identity. */
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
import ssh2 from 'ssh2';
import type { Engine } from '../server/runtime.ts';
import { diskOptions } from '../shared/hardware.ts';

if (process.argv.length === 2 || process.argv[2] === '--describe') {
  console.log(
    'Project UID SSH check: --run-new alpine, or --run-owned alpine <closed owned fixture>. Checks real project UID command/PTY/binary stdin/SFTP, readonly reload, protected configuration, lost activation acknowledgement and complete service cleanup. Partial-ticket recovery uses an explicitly recorded owned-file fault injection.',
  );
} else {
  const reused = process.argv[2] === '--run-owned';
  if (reused) {
    assert.equal(process.argv.length, 5);
    assert.equal(process.argv[3], 'alpine');
  } else assert.deepEqual(process.argv.slice(2), ['--run-new', 'alpine']);
  assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  await run(reused ? process.argv[4] : undefined);
}

/** 新建或核验指定自有 Alpine 夹具，通过正式 SSH 端点验证登录、exec/SFTP/转发的 UID 与域隔离、替代票据拒绝及完整清理。
 * Create or validate an owned Alpine fixture and verify production SSH login/exec/SFTP/forwarding UID-domain isolation/replacement-receipt denial/full cleanup. */
async function run(ownedDirectory?: string) {
  const workspace = await realpath('.'),
    parent = join(workspace, '.data/project-ssh-identity-test-temp');
  await mkdir(parent, { recursive: true });
  assert.equal(await realpath(parent), parent);
  const root = ownedDirectory
    ? await realpath(ownedDirectory)
    : await mkdtemp(join(parent, 'sakura-ssh-identity-'));
  assert.equal(dirname(await realpath(root)), parent);
  assert.match(basename(root), /^sakura-ssh-identity-/);
  /** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
   * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
  const invocation = randomUUID(),
    hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
  const proof: any = {
    version: 1,
    invocation,
    root,
    distro: 'alpine',
    passed: false,
    startedAt: new Date().toISOString(),
    sourceSha256: {},
    executions: [],
    cases: [],
    phases: [],
    cleanupErrors: [],
    client: { node: process.version, execArgv: process.execArgv },
  };
  let prior: any;
  if (ownedDirectory) {
    const proofs = (await readdir(root)).filter((name) =>
      /^project-ssh-identity-[a-f0-9-]{36}\.json$/.test(name),
    );
    assert.ok(proofs.length);
    const completed = await Promise.all(
      proofs.map(async (name) => JSON.parse(await readFile(join(root, name), 'utf8'))),
    );
    prior = completed.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))[0];
    assert.equal(prior.root, root);
    assert.equal(prior.vmStopped, true);
    assert.equal(prior.liveEntries, 0);
    assert.equal(prior.ownedChildren, 0);
    assert.equal(prior.exactQemuMatches, 0);
    assert.ok(
      prior.executions.every(
        (entry: any) => entry.exit && entry.close && entry.stdoutClosed && entry.stderrClosed,
      ),
    );
    proof.kind = 'owned-ssh-identity-fixture-new-boot';
    proof.previousInvocation = prior.invocation;
  } else proof.kind = 'fresh-owned-ssh-identity-fixture';
  /** 保存阶段名与时间并输出进度，为中断或失败报告定位最后执行边界。
   * Retain phase name/time and print progress to locate the last execution boundary after interruption/failure. */
  const phase = (name: string) => {
    proof.phases.push({ name, at: new Date().toISOString() });
    console.log('PHASE ' + name);
  };
  const files = [
    'server/project-repository.ts',
    'server/project-repository-broker.py',
    'server/repository-url.ts',
    'server/workspaces.ts',
    'server/project-run-scope.ts',
    'server/project-identity.ts',
    'server/project-directory-migration.ts',
    'server/guest-task.ts',
    'server/machines.ts',
    'server/project-main.ts',
    'server/project-service-scope.ts',
    'server/project-services.ts',
    'server/project-network-isolation.ts',
    'server/project-dependency-cache.ts',
    'server/dependency-downloads.ts',
    'server/network-profiles.ts',
    'native/project-identity/protocol.h',
    'native/project-identity/launcher.c',
    'native/project-identity/controller.py',
    'scripts/smoke-project-ssh-identity.ts',
    'plugins/terminal-workspace/server.ts',
    'plugins/terminal-workspace/manifest.ts',
    'package.json',
    'package-lock.json',
  ];
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
  await capture(join(workspace, 'server'));
  await capture(join(workspace, 'shared'));
  for (const file of new Set(files)) proof.sourceSha256[file] = hash(await readFile(join(workspace, file)));
  proof.sourceContract =
    'All local server/shared sources, package manifests, selected native identity sources and this harness; external dependency binaries are outside this source snapshot.';
  await writeFile(join(root, 'intent-' + invocation + '.json'), JSON.stringify(proof, null, 2), {
    flag: 'wx',
  });
  const image = await realpath(join(workspace, '.data/images/alpine-3.23.qcow2'));
  assert.equal(image, join(workspace, '.data/images/alpine-3.23.qcow2'));
  const imageInfo = await lstat(image);
  assert.ok(imageInfo.isFile() && !imageInfo.isSymbolicLink());
  const imageSha256 = hash(await readFile(image));
  const ownImages = join(root, 'images');
  if (!ownedDirectory) await mkdir(ownImages);
  const base = join(ownImages, 'alpine-3.23.qcow2');
  if (!ownedDirectory) await copyFile(image, base, constants.COPYFILE_EXCL);
  if (ownedDirectory) assert.equal(prior.base.privateCopy, base);
  assert.equal(hash(await readFile(base)), imageSha256);
  proof.base = { original: image, originalSha256: imageSha256, privateCopy: base, copiedSha256: imageSha256 };
  process.env.SAKURA_DATA_DIR = root;
  process.env.SAKURA_IMAGE_DIR = ownImages;
  process.env.SAKURA_IMAGE_PATH = base;
  process.env.TEMP = process.env.TMP = root;
  const { Machines } = await import('../server/machines.ts');
  const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
  const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
  const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
  const { projectIdentityTask } = await import('../server/project-run-scope.ts');
  const { ProjectSsh, projectSshPaths } = await import('../server/project-ssh.ts');
  const { ProjectRunScopes } = await import('../server/project-run-scope.ts');
  const { quote } = await import('../server/files.ts');
  const { writeStore } = await import('../server/local-store.ts');
  const { vmDir } = await import('../server/model.ts');
  const sources = await projectIdentitySources();
  proof.identityBuild = sources.manifest;
  for (const entry of sources.manifest.files)
    assert.equal(entry.sha256, proof.sourceSha256['native/project-identity/' + entry.name]);
  const qemu = join(workspace, '.tools/qemu/qemu-system-x86_64.exe'),
    img = join(workspace, '.tools/qemu/qemu-img.exe');
  if (ownedDirectory) {
    const query =
      '$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;[Console]::Write(@(Get-CimInstance Win32_Process|Where-Object { $_.ExecutablePath -eq $r.image -and $_.CommandLine -and $_.CommandLine.Contains($r.disk) }).Count)';
    assert.equal(
      Number(
        execFileSync(
          join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(query, 'utf16le').toString('base64'),
          ],
          {
            input: JSON.stringify({ image: qemu, disk: join(root, 'machines', prior.vmId, 'disk.qcow2') }),
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15000,
          },
        ).trim(),
      ),
      0,
    );
  }
  proof.binarySha256 = { [qemu]: hash(await readFile(qemu)), [img]: hash(await readFile(img)) };
  const children = new Map<ChildProcess, Promise<void>>();
  let vmId = '',
    qemuStarted = false;
  /** 启动前核验已冻结二进制摘要，登记 argv/PID/exit/close 并限制累计输出；取消只终止自有 child，等待真实 close 后返回结果并清理监听。
   * Verify frozen binary hashes before spawning, record argv/PID/exit/close and bound accumulated output; cancellation targets only the owned child, then await actual close/clean listeners before returning. */
  async function execute(
    executable: string,
    args: string[],
    options: Parameters<Engine['run']>[2] = {},
    vm = false,
  ) {
    assert.equal(hash(await readFile(executable)), proof.binarySha256[executable]);
    const entry: any = {
      executable,
      argvSha256: hash(JSON.stringify(args)),
      vm,
      pid: null,
      exit: null,
      close: null,
    };
    proof.executions.push(entry);
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    entry.pid = child.pid;
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    let count = 0,
      failure: Error | undefined;
    for (const [stream, output] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ] as const)
      stream!.on('data', (value: Buffer) => {
        count += value.length;
        if (count > 1048576) child.kill();
        else output.push(value);
        options?.output?.(value);
      });
    child.once('error', (error) => {
      failure = error;
      entry.spawnError = error.message;
    });
    child.once('exit', (code, signal) => {
      entry.exit = { code, signal };
    });
    const closed = new Promise<void>((done) =>
      child.once('close', (code, signal) => {
        entry.close = { code, signal };
        entry.stdoutClosed = child.stdout!.closed;
        entry.stderrClosed = child.stderr!.closed;
        children.delete(child);
        done();
      }),
    );
    children.set(child, closed);
    /** 取消只绑定当前自有 child 句柄，终止该进程；存在 receipt/entry 时同时记录取消证据，实际 close 仍由外层等待。
     * Bind cancellation only to the current owned child and terminate it, recording receipt/entry evidence when present; outer code still awaits physical close. */
    const abort = () => {
      entry.abortRequested = true;
      child.kill();
    };
    options?.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => {
        entry.timeoutRequested = true;
        child.kill();
      },
      options?.timeoutMs || (vm ? 7_200_000 : 30000),
    );
    if (options?.signal?.aborted) abort();
    try {
      await closed;
      if (failure) throw failure;
      if (options?.signal?.aborted) return '';
      assert.equal(entry.close.code, 0, Buffer.concat(stderr).toString());
      assert.equal(entry.close.signal, null);
      return Buffer.concat(stdout).toString();
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', abort);
    }
  }
  const hardware = { memoryMiB: 1536, cpus: 2 };
  /** 显式拒绝夹具没有授权的运行时能力，使意外走入其他主机操作立即失败，不能静默用替身绕过生产路径。
   * Explicitly reject runtime capabilities not authorized by this fixture so accidental host operations fail immediately instead of silently bypassing production paths with a substitute. */
  const unsupported = () => {
    throw new Error('Unknown SSH identity test engine operation');
  };
  const engine = {
    version: 'test-only direct Engine',
    whpxAvailable: false,
    qemuIoAvailable: false,
    aarch64Available: false,
    runtime: {
      /** 终止此适配器登记的全部自有子进程并等待实际关闭 Promise；存在总期限时届满失败且清理计时器，不把 kill 调用等同于完成。
       * Terminate all owned children registered by this adapter and await actual closure promises; where bounded, expiry fails and clears the timer, since calling kill is not completion. */
      close: async () => {
        for (const child of children.keys()) child.kill();
        await Promise.all(children.values());
      },
    },
    runStatus: unsupported,
    /** 拒绝通用 service 访问，维持此夹具只允许明确 QEMU 启动的最小运行时边界。
     * Reject generic service access, preserving the fixture’s minimum runtime boundary of explicitly permitted QEMU launch only. */
    get service() {
      return unsupported();
    },
    /** 只允许指定自有磁盘的固定镜像创建和一次精确 QEMU 启动，逐项校验驱动器/启动参数并拒绝其他入口；调用 execute 保留实际进程关闭证据。
     * Allow only fixed owned-disk image creation/one exact QEMU boot, validating drives/launch arguments and rejecting other entry points; execute retains physical-process closure evidence. */
    run: async (tool: string, args: string[], options?: Parameters<Engine['run']>[2]) => {
      if (tool === 'sakura-img') {
        const disk = args.at(-2)!;
        assert.deepEqual(args.slice(0, 7), ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', base]);
        assert.equal(args.length, 9);
        assert.equal(args.at(-1), '8G');
        assert.equal(basename(disk), 'disk.qcow2');
        assert.equal(dirname(dirname(disk)), join(root, 'machines'));
        assert.equal(await realpath(dirname(disk)), dirname(disk));
        return execute(img, args, options);
      }
      assert.equal(tool, 'sakura-qemu');
      assert.ok(vmId && !qemuStarted);
      qemuStarted = true;
      /** 转义正则表达式的元字符，按字面匹配夹具路径或标记，避免名称被解释为匹配规则。
       * Escape regular-expression metacharacters so fixture paths/markers match literally rather than act as pattern syntax. */
      const escape = (value: string) => value.replaceAll(',', ',,');
      const drives = args.flatMap((arg, index) => (arg === '-drive' ? [args[index + 1]] : []));
      assert.deepEqual(drives, [
        `file=${escape(join(root, 'machines', vmId, 'disk.qcow2'))},if=virtio,id=sakura-disk,format=qcow2,${diskOptions(hardware)}`,
        `file=${escape(join(root, 'machines', vmId, 'seed.iso'))},media=cdrom,readonly=on`,
      ]);
      assert.ok(args.includes('-no-reboot'));
      for (const flag of [
        '-snapshot',
        '-blockdev',
        '-incoming',
        '-object',
        '-kernel',
        '-initrd',
        '-readconfig',
      ])
        assert.ok(!args.includes(flag));
      return execute(qemu, args, options, true);
    },
  } as unknown as Engine;
  const machines = new Machines(engine);
  const spaces = new Workspaces(machines);
  const migrations = new ProjectDirectoryMigrations(machines, spaces),
    identities = new ProjectIdentities(machines);
  let service = new ProjectSsh(machines, spaces);
  const scopes = new ProjectRunScopes(machines);
  const projectParent = '/srv/projects/ssh-' + invocation;
  const clients = new Set<import('ssh2').Client>();
  const channels = new Set<import('ssh2').ClientChannel>();
  /** 在本验收夹具的指定实例中执行传入脚本，使用函数中的超时约束并断言退出码为零，返回捕获的标准输出；失败附来宾诊断而不被当作空输出。
   * Execute the supplied script in the specified fixture VM under this function’s timeout, assert exit code zero and return captured stdout; failures include guest diagnostics rather than become empty output. */
  async function guest(command: string, timeout = 30000) {
    const result = await machines.exec(vmId, command, timeout);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  }
  /** 按名称执行异步断言，成功后记录返回证据；异常直接传播，不记录通过。
   * By case name, run asynchronous assertions and retain returned evidence on success; propagate errors without recording a pass. */
  async function check(name: string, action: () => Promise<unknown>) {
    phase(name);
    const observation = await action();
    proof.cases.push({ name, observation });
    console.log('PASS ' + name);
  }
  /** 创建自有私有网络项目并通过精确迁移计划授权，返回目录与非 root 身份，保持生产目录入口。
   * Create an owned private-network project/authorize via exact migration and return directory/nonroot identity while preserving production directory admission. */
  async function project(name: string, environment: Record<string, string> = {}) {
    const directory = projectParent + '/' + name;
    await guest('mkdir ' + quote(directory));
    const config = projectSchema.parse({
      directory,
      networkIsolation: 'private',
      template: 'none',
      environment,
    });
    const index = await spaces.projects.create(vmId, name + '-' + invocation.slice(0, 8), () =>
      writeStore(projectMetadataFile(vmId, spaces.projects.current(vmId)), config),
    );
    const identity = await spaces.projects.with(vmId, index.active, /** 按正式迁移 preview 的 planId+sha256 显式 apply，要求 applied 后才返回 activatedIdentity，SSH 身份不能从未审阅目录计划推测。
 * Explicitly apply the formal migration preview by planId/digest and return activatedIdentity only after applied state; never infer SSH identity from an unreviewed directory plan. */ async () => {
      const preview = await migrations.preview(vmId);
      assert.ok(preview.plan);
      const applied = await migrations.apply(vmId, {
        action: 'apply',
        version: 1,
        planId: preview.plan.proposal.planId,
        sha256: preview.plan.sha256,
        reviewed: true,
      });
      assert.equal(applied.plan?.state, 'applied');
      return applied.plan!.activatedIdentity!;
    });
    return { id: index.active, directory, identity };
  }
  type OwnedProject = Awaited<ReturnType<typeof project>>;
  /** 在目标项目上下文启动真实 SSH 服务，返回正式启动结果。
   * Start the real SSH service in target-project context and return production results. */
  async function start(project: OwnedProject) {
    return spaces.projects.with(vmId, project.id, () => service.start(vmId));
  }
  /** 按生产项目端点/私钥建立回环 SSH，pin 公钥摘要并登记 client，六十秒内 ready，外层统一释放。
   * Connect loopback SSH from production project endpoint/private key, pin its public-key hash/register client and require ready within sixty seconds for outer teardown. */
  async function connect(project: OwnedProject) {
    const configured = await spaces.projects.inScope(vmId, project.id, () => spaces.config(vmId));
    const endpoint = await service.endpoint(vmId, configured);
    assert.ok(endpoint);
    const key = ssh2.utils.parseKey(endpoint.hostPublicKey);
    assert.ok(!(key instanceof Error) && !Array.isArray(key));
    const expected = hash(key.getPublicSSH()),
      privateKey = await readFile(endpoint.identity),
      client = new ssh2.Client();
    clients.add(client);
    await new Promise<void>(/** 连接回环桥端口并以冻结 SHA-256 host fingerprint 校验真实 SSH 服务，ready 最多 60 秒；连接错误拒绝，不放宽主机身份。
 * Connect to the loopback bridge using the frozen SHA-256 host fingerprint to authenticate real SSH, with sixty-second readiness and error rejection without weakening host identity. */ (resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
      client.connect({
        host: '127.0.0.1',
        port: endpoint.port,
        username: 'root',
        privateKey,
        hostHash: 'sha256',
        /** 只接受与目标项目公钥 SHA-256 一致的主机指纹。
         * Accept only the host fingerprint matching the target project public-key SHA-256. */
        hostVerifier: (fingerprint: string) => fingerprint === expected,
        readyTimeout: 60000,
      });
    });
    return client;
  }
  /** 返回指定项目的真实已认证 SSH 连接，由 connect 执行 pin 和客户端登记。
   * Return the project’s real authenticated SSH connection through connect, which enforces pinning/client registration. */
  async function clientFor(project: OwnedProject) {
    return connect(project);
  }
  /** 在真实 SSH 连接执行命令、可选单独 stdin，保存原字节 stdout 和 stderr；六十秒/两 MiB stdout 超限关闭通道并拒绝，actual close 清理登记。
   * Run real SSH exec with optional separate stdin, retaining raw stdout/stderr; close/reject at sixty seconds/two-MiB stdout and clear registration on actual close. */
  async function sshExecute(client: import('ssh2').Client, command: string, input?: Buffer) {
    return await new Promise<{ code: number; output: Buffer; stderr: string }>(/** 真实 SSH exec 以 stdin 传输入，登记活动 channel 并最多等 60 秒；stdout 限 2 MiB，超额主动关闭，close 清理登记/计时并返回原退出码与字节。
 * Send input through real SSH exec, register the active channel and wait at most sixty seconds; bound stdout to 2 MiB and close on overflow, removing registration/timer on close and returning original status/bytes. */ (resolve, reject) => {
      client.exec(command, /** 仅成功 channel 进入活动集合，先监听输出/关闭再结束 stdin；stdout 超额或超时关闭通道，真实 close 才删除集合记录并兑现结果。
 * Register only successfully created channels and attach output/close listeners before ending stdin; close on stdout overflow/deadline and remove the active record/resolve only on actual close. */ (error, channel) => {
        if (error) return reject(error);
        channels.add(channel);
        const stdout: Buffer[] = [],
          stderr: Buffer[] = [];
        let total = 0;
        const timer = setTimeout(() => {
          channel.close();
          reject(new Error('SSH command did not close'));
        }, 60000);
        channel.on('data', (bytes: Buffer) => {
          total += bytes.length;
          if (total > 2 * 1048576) {
            channel.close();
            reject(new Error('SSH output exceeded bound'));
          } else stdout.push(Buffer.from(bytes));
        });
        channel.stderr.on('data', (bytes: Buffer) => stderr.push(Buffer.from(bytes)));
        channel.once('error', reject);
        channel.once('close', (code: number) => {
          clearTimeout(timer);
          channels.delete(channel);
          resolve({ code, output: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() });
        });
        channel.end(input || Buffer.alloc(0));
      });
    });
  }
  /** 通过 SSH 运行隔离 Python 源码，要求零退出后解析原始输出 JSON，保留 stderr 诊断。
   * Run isolated Python over SSH, require zero exit and parse raw JSON output with stderr diagnostics. */
  async function json(client: import('ssh2').Client, source: string) {
    const result = await sshExecute(client, '/usr/bin/python3 -I -S -c ' + quote(source));
    assert.equal(result.code, 0, result.stderr || result.output.toString());
    return JSON.parse(result.output.toString());
  }
  /** 有限轮询异步谓词，达到条件即返回，期限届满用标签断言失败。
   * Poll the async predicate with a deadline, returning on success and asserting expiry with its label. */
  async function waitFor(action: () => boolean | Promise<boolean>, label: string, milliseconds = 30000) {
    const deadline = Date.now() + milliseconds;
    while (!(await action())) {
      assert.ok(Date.now() < deadline, label);
      await delay(100);
    }
  }
  try {
    await machines.init();
    const records = await machines.list();
    if (ownedDirectory) {
      assert.equal(records.length, 1);
      assert.equal(records[0].id, prior.vmId);
      assert.equal(records[0].name, 'ssh-identity-alpine');
      assert.equal(records[0].distro, 'alpine');
      assert.equal(machines.state(prior.vmId), 'stopped');
      vmId = prior.vmId;
    } else {
      assert.equal(records.length, 0);
      vmId = (
        await machines.create({
          name: 'ssh-identity-alpine',
          distro: 'alpine',
          ...hardware,
          diskGiB: 8,
          accelerator: 'tcg',
          forwards: [],
        })
      ).id;
    }
    proof.vmId = vmId;
    phase(ownedDirectory ? 'new boot of closed owned SSH fixture' : 'fresh owned Alpine boot');
    await machines.start(vmId);
    await waitFor(() => machines.state(vmId) !== 'starting', 'owned VM did not boot', 300000);
    assert.equal(machines.state(vmId), 'running', (await machines.view(vmId)).lastError);
    phase('compile fixed native identity');
    await identities.install(vmId);
    await guest(
      'mkdir -p /srv/projects; mkdir ' +
        quote(projectParent) +
        '; chmod 755 /srv/projects ' +
        quote(projectParent),
    );
    const marker = 'ssh-session-' + invocation;
    const alpha = await project('alpha', {
        SAKURA_SESSION_TEST: marker,
        SSH_ORIGINAL_COMMAND: 'inert-project-value',
        VSCODE_AGENT_FOLDER: '/root/should-not-be-used',
      }),
      beta = await project('beta');
    await guest(
      'printf protected > ' +
        quote(beta.directory + '/private.txt') +
        '; chown ' +
        beta.identity.uid +
        ':' +
        beta.identity.gid +
        ' ' +
        quote(beta.directory + '/private.txt') +
        '; chmod 600 ' +
        quote(beta.directory + '/private.txt'),
    );
    await start(alpha);
    await start(beta);
    await check('real SSH commands use the private project UID, home and protected environment', /** 通过正式 SSH 会话读取真实 UID/Home/cwd/网络/cgroup 与环境，邻项目文件必须不可读；独立扫 root argv 确认保护环境未泄漏，输出证据掩去私值。
 * Observe real UID/Home/cwd/network/cgroup/environment through formal SSH and deny neighbor files; independently scan root argv for protected-environment leakage and mask private values in evidence. */ async () => {
      const client = await clientFor(alpha);
      const result = await json(
        client,
        'import json,os\ndenied=False\ntry:open(' +
          JSON.stringify(beta.directory + '/private.txt') +
          ").read()\nexcept PermissionError:denied=True\nassert denied\nprint(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'home':os.environ['HOME'],'cwd':os.getcwd(),'scope':open('/proc/self/cgroup').read().strip(),'namespace':str(os.stat('/proc/self/ns/net').st_ino),'marker':os.environ['SAKURA_SESSION_TEST'],'original':os.environ['SSH_ORIGINAL_COMMAND'],'vscode':os.environ['VSCODE_AGENT_FOLDER'],'otherProjectDenied':denied}))",
      );
      const ticket = await scopes.sshRun(vmId, alpha.id, (await scopes.sshRuns(vmId, alpha.id))[0].runId);
      assert.equal(result.uid, alpha.identity.uid);
      assert.equal(result.gid, alpha.identity.gid);
      assert.equal(result.home, alpha.identity.home);
      assert.equal(result.cwd, alpha.directory);
      assert.equal(result.scope, '0::/' + ticket.run.cgroupName);
      assert.equal(result.namespace, ticket.run.networkInode);
      assert.equal(result.marker, marker);
      assert.equal(result.original, 'inert-project-value');
      assert.equal(result.vscode, alpha.identity.home + '/.vscode-server');
      const privileged = await guest(
        '/usr/bin/python3 -I -S -c ' +
          quote(
            'import glob,json,os\nneedle=json.load(open(' +
              JSON.stringify(projectSshPaths(alpha.id).config + '/session.json') +
              "))['environment']['SAKURA_SESSION_TEST'].encode()\nassert not any(needle in open(p,'rb').read() for p in glob.glob('/proc/[0-9]*/cmdline') if os.stat(p.rsplit('/',1)[0]).st_uid==0)\nprint('ROOT_ARGV_CLEAN')",
          ),
      );
      assert.equal(privileged, 'ROOT_ARGV_CLEAN');
      client.end();
      clients.delete(client);
      return { ...result, marker: '[verified private value]', privilegedArgvClean: true };
    });
    await check('non-PTY binary stdin roundtrips independently of the sealed command payload', async () => {
      const client = await clientFor(alpha),
        bytes = Buffer.concat([Buffer.from([0, 255, 10, 13, 27]), randomBytes(512 * 1024)]);
      const result = await sshExecute(client, 'exec /bin/cat', bytes);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(result.output, bytes);
      assert.equal(result.stderr, '');
      client.end();
      clients.delete(client);
      return { bytes: bytes.length, sha256: hash(bytes), binaryAndEOF: true };
    });
    await check(
      'SFTP uploads and downloads binary data as the project UID and refuses foreign files',
      /** SFTP 往返 256 KiB 随机字节并核验文件 UID/GID/0600，拒绝邻项目路径；关闭 subsystem/client 后返回摘要和所有权证明。
       * Round-trip 256 KiB random bytes through SFTP, verify UID/GID/0600 and deny neighbor paths; close subsystem/client and return digest/ownership evidence. */
      async () => {
        const client = await clientFor(alpha),
          sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) =>
            client.sftp((error, subsystem) => (error ? reject(error) : resolve(subsystem))),
          );
        const bytes = randomBytes(256 * 1024),
          output: Buffer[] = [];
        await pipeline(Readable.from([bytes]), sftp.createWriteStream('sftp.bin', { mode: 0o600 }));
        await new Promise<void>((resolve, reject) => {
          const stream = sftp.createReadStream('sftp.bin');
          stream.on('data', (chunk: Buffer) => output.push(Buffer.from(chunk)));
          stream.once('error', reject);
          stream.once('end', resolve);
        });
        assert.deepEqual(Buffer.concat(output), bytes);
        await assert.rejects(
          new Promise((resolve, reject) =>
            sftp.open(beta.directory + '/private.txt', 'r', (error, handle) =>
              error ? reject(error) : resolve(handle),
            ),
          ),
        );
        const ownership = JSON.parse(
          await guest(
            '/usr/bin/python3 -I -S -c ' +
              quote(
                'import json,os\ns=os.stat(' +
                  JSON.stringify(alpha.directory + '/sftp.bin') +
                  ")\nprint(json.dumps({'uid':s.st_uid,'gid':s.st_gid,'mode':s.st_mode&511}))",
              ),
          ),
        );
        assert.equal(ownership.uid, alpha.identity.uid);
        assert.equal(ownership.gid, alpha.identity.gid);
        assert.equal(ownership.mode, 0o600);
        sftp.end();
        client.end();
        clients.delete(client);
        return { ...ownership, bytes: bytes.length, sha256: hash(bytes), foreignDenied: true };
      },
    );
    await check('PTY input and resize preserve interactive execution after Ctrl-C', /** 在真实项目 PTY 调整窗口并由来宾 ioctl 证明尺寸与 UID，Ctrl-C 应只中断前台 sleep 且 shell 仍可写标记；exit 后等待实际 close，失败保留尾部日志。
 * Resize a real project PTY and prove dimensions/UID via guest ioctl; Ctrl-C interrupts foreground sleep while shell can still write a marker, then await actual close after exit and retain tail logs on failure. */ async () => {
      const client = await clientFor(alpha),
        channel = await new Promise<import('ssh2').ClientChannel>((resolve, reject) =>
          client.shell({ term: 'xterm-256color', rows: 28, cols: 100 }, (error, stream) =>
            error ? reject(error) : resolve(stream),
          ),
        );
      channels.add(channel);
      let output = '',
        closed = false,
        exitCode: number | undefined;
      channel.once('close', (code: number) => {
        closed = true;
        exitCode = code;
      });
      channel.on('data', (bytes: Buffer) => {
        output += bytes.toString();
      });
      channel.stderr.on('data', (bytes: Buffer) => {
        output += bytes.toString();
      });
      await delay(500);
      channel.setWindow(35, 121, 0, 0);
      const observe =
        "import json,os,fcntl,termios,struct\nrows,cols,_,_=struct.unpack('HHHH',fcntl.ioctl(0,termios.TIOCGWINSZ,b'\\0'*8))\njson.dump({'uid':os.getuid(),'tty':os.isatty(0),'rows':rows,'cols':cols},open('ssh-pty.json','w'))";
      channel.write('/usr/bin/python3 -I -S -c ' + quote(observe) + '\r');
      await waitFor(
        async () =>
          (await machines.exec(vmId, 'test -f ' + quote(alpha.directory + '/ssh-pty.json'), 10000)).code ===
          0,
        output,
      );
      const actual = JSON.parse(await guest('cat ' + quote(alpha.directory + '/ssh-pty.json')));
      assert.equal(actual.uid, alpha.identity.uid);
      assert.equal(actual.tty, true);
      assert.equal(actual.rows, 35);
      assert.equal(actual.cols, 121);
      channel.write('sleep 600\r');
      await delay(500);
      channel.write('\x03');
      await delay(300);
      channel.write('printf after-interrupt > after-interrupt.txt\r');
      await waitFor(
        async () =>
          (await machines.exec(vmId, 'test -f ' + quote(alpha.directory + '/after-interrupt.txt'), 10000))
            .code === 0,
        output,
      );
      assert.equal(closed, false);
      channel.write('exit\r');
      try {
        await waitFor(() => closed, 'PTY did not close after exit');
      } catch (error) {
        proof.ptyOutput = output.slice(-8192);
        throw error;
      }
      assert.equal(exitCode, 0, output);
      channels.delete(channel);
      client.end();
      clients.delete(client);
      return { ...actual, survivesCtrlC: true, actualChannelClose: closed, exitCode };
    });
    await check(
      'manager reload checks the existing full ticket and refuses weakened command permissions',
      /** 重建 SSH 服务只读复用原票据，真实连接仍为项目 UID；暂放宽 command 权限后 status/endpoint 必须拒绝，finally 恢复权限。
       * Rebuild SSH service read-only with the original receipt and verify a real connection retains project UID; weaken command permissions temporarily and require status/endpoint refusal, restoring permissions in finally. */
      async () => {
        const runs = await scopes.sshRuns(vmId, alpha.id),
          ticket = await scopes.sshRun(vmId, alpha.id, runs[0].runId);
        await service.close();
        service = new ProjectSsh(machines, spaces);
        const configured = await spaces.projects.inScope(vmId, alpha.id, () => spaces.config(vmId));
        assert.equal((await service.status(vmId, configured)).valid, true);
        const client = await clientFor(alpha),
          observed = await json(client, "import json,os\nprint(json.dumps({'uid':os.getuid()}))");
        assert.equal(observed.uid, alpha.identity.uid);
        client.end();
        clients.delete(client);
        assert.deepEqual((await scopes.sshRun(vmId, alpha.id, ticket.run.runId)).run, ticket.run);
        const commandPath = projectSshPaths(alpha.id).config + '/command';
        await guest('chmod 722 ' + quote(commandPath));
        try {
          assert.equal((await service.status(vmId, configured)).valid, false);
          assert.equal(await service.endpoint(vmId, configured), null);
        } finally {
          await guest('chmod 700 ' + quote(commandPath));
        }
        return { runId: ticket.run.runId, readonlyTicketReused: true, weakenedCommandRefused: true };
      },
    );
    await check(
      'whole-service stop kills detached UID children before closing the exact original ticket',
      /** 会话关闭后脱离子进程仍在原 SSH 域，正式 stop 必须清完整域及票据且保留 beta；重新 start 发新 runId，旧票据不再授权。
       * A detached child remains in the original SSH domain after connection close; formal stop must clear the whole domain/receipt while preserving beta, and restart issues a new runId without authorizing the old receipt. */
      async () => {
        const alphaTicket = await scopes.sshRun(
          vmId,
          alpha.id,
          (await scopes.sshRuns(vmId, alpha.id))[0].runId,
        );
        const betaTicket = await scopes.sshRun(vmId, beta.id, (await scopes.sshRuns(vmId, beta.id))[0].runId);
        const client = await clientFor(alpha);
        const source =
          "import os,subprocess\np=subprocess.Popen(['/bin/sleep','600'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)\nopen('ssh-detached.pid','w').write(str(p.pid))";
        const result = await sshExecute(client, '/usr/bin/python3 -I -S -c ' + quote(source));
        assert.equal(result.code, 0, result.stderr);
        client.end();
        clients.delete(client);
        const childPid = Number(await guest('cat ' + quote(alpha.directory + '/ssh-detached.pid')));
        const before = JSON.parse(
          await guest(
            '/usr/bin/python3 -I -S -c ' +
              quote(
                'import json,os\np=' +
                  childPid +
                  "\nprint(json.dumps({'uid':os.stat('/proc/'+str(p)).st_uid,'scope':open('/proc/'+str(p)+'/cgroup').read().strip()}))",
              ),
          ),
        );
        assert.equal(before.uid, alpha.identity.uid);
        assert.equal(before.scope, '0::/' + alphaTicket.run.cgroupName);
        await spaces.projects.with(vmId, alpha.id, () => service.stop(vmId));
        await guest(
          'test ! -e /proc/' +
            childPid +
            '; test ! -e ' +
            quote('/sys/fs/cgroup/' + alphaTicket.run.cgroupName) +
            '; test ! -e ' +
            quote('/run/sakura-project-identities/ssh/' + alphaTicket.run.runId + '.json'),
        );
        assert.deepEqual(await scopes.sshRuns(vmId, alpha.id), []);
        await scopes.sshRun(vmId, beta.id, betaTicket.run.runId);
        const betaClient = await clientFor(beta);
        const betaResult = await json(betaClient, "import os,json\nprint(json.dumps({'uid':os.getuid()}))");
        assert.equal(betaResult.uid, beta.identity.uid);
        betaClient.end();
        clients.delete(betaClient);
        await start(alpha);
        const replacement = (await scopes.sshRuns(vmId, alpha.id))[0];
        assert.notEqual(replacement.runId, alphaTicket.run.runId);
        await assert.rejects(scopes.sshRun(vmId, alpha.id, alphaTicket.run.runId));
        return {
          original: alphaTicket.run.runId,
          replacement: replacement.runId,
          childPid,
          otherProjectPreserved: true,
          exactResourcesAbsent: true,
        };
      },
    );
    await check('SESSION frames refuse missing client descriptors and combined terminal flags', /** 保持正文摘要一致而分别注入缺会话描述符与组合 flags，要求原生帧拒绝且正文文件未创建；finally 精确停止原 run。
 * Keep body digests consistent while injecting missing session descriptors/combined flags, requiring native-frame refusal and no body file, then stop the original run exactly in finally. */ async () => {
      const run = await identities.prepare(vmId, alpha.identity);
      try {
        for (const flag of [2, 3]) {
          const plan = identities.input(alpha.identity, run, {
            command: 'printf forbidden > invalid-session.txt',
          });
          plan.input.writeUInt32LE(flag, 12);
          const sum = hash(plan.input);
          const result = await machines.execInput(
            vmId,
            plan.command.replace(plan.sha256, sum),
            plan.input,
            30000,
          );
          assert.notEqual(result.code, 0);
          assert.match(result.stderr, flag === 2 ? /PAYLOAD_SESSION_REQUIRED/ : /PAYLOAD_HEADER/);
        }
        await guest('test ! -e ' + quote(alpha.directory + '/invalid-session.txt'));
        return { missingDescriptorRefused: true, combinedFlagsRefused: true, projectCodeExecuted: false };
      } finally {
        await identities.stop(vmId, alpha.identity, run);
      }
    });
    for (const partial of [false, true]) {
      await check(
        partial
          ? 'an injected pre-ticket receipt remains recoverable without authorizing readonly sessions'
          : 'a lost native activation acknowledgement recovers the full original ticket before cleanup',
        /** 模拟 native SSH 入场成功但 host 尚为 intent 时确认丢失，可额外移走精确 RUN 文件；正式失败恢复须关原 cgroup/SSH receipt、撤 host intent，并保留邻项目与可重新启动性。
         * Model successful native SSH admission while host remains intent and lose its ACK, optionally removing the exact RUN file; failure recovery must close original cgroup/SSH receipt, remove host intent and preserve neighbor/restartability. */
        async () => {
          await spaces.projects.with(vmId, alpha.id, () => service.stop(vmId));
          await service.close();
          const core = new ProjectIdentities(machines),
            faultScopes = new ProjectRunScopes(machines, { identities: core });
          const prepare = core.prepareSsh.bind(core);
          let original: import('../server/project-identity.ts').ProjectIdentityRun | undefined;
          let nativeRecordSha256: string | undefined;
          core.prepareSsh = /** 先真实 prepareSsh 再证明未确认 host intent 不授权会话；可按 inode、权限、摘要和 SSH receipt 精确移走原 RUN，随后统一丢确认以测试恢复备用票据。
 * Call real prepareSsh and prove unacknowledged host intent cannot authorize sessions; optionally remove original RUN after inode/permission/digest/SSH-receipt checks, then lose ACK to test alternate-receipt recovery. */ async (...args) => {
            original = await prepare(...args);
            const intent = (await faultScopes.sshRuns(vmId, alpha.id))[0];
            assert.equal(intent.run, null);
            assert.equal(intent.phase, 'intent');
            await assert.rejects(faultScopes.sshRun(vmId, alpha.id, original.runId));
            if (partial) {
              const path = '/run/sakura-project-identities/runs/' + original.runId + '.bin';
              nativeRecordSha256 = (await guest('sha256sum ' + quote(path))).split(' ')[0];
              assert.match(nativeRecordSha256, /^[a-f0-9]{64}$/);
              await guest(
                '/usr/bin/python3 -I -S -c ' +
                  quote(
                    'import hashlib,json,os,stat\np=' +
                      JSON.stringify(path) +
                      '\nsum=' +
                      JSON.stringify(nativeRecordSha256) +
                      '\nrun=' +
                      JSON.stringify(original) +
                      "\nf=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)\ntry:\n i=os.fstat(f)\n assert stat.S_ISREG(i.st_mode) and i.st_uid==0 and stat.S_IMODE(i.st_mode)==0o600 and i.st_nlink==1\n assert hashlib.sha256(os.read(f,1025)).hexdigest()==sum\n assert json.load(open('/run/sakura-project-identities/ssh/'+run['runId']+'.json'))['run']==run\n assert os.path.isdir('/sys/fs/cgroup/'+run['cgroupName'])\n assert os.lstat(p).st_ino==i.st_ino\n os.unlink(p)\n d=os.open(os.path.dirname(p),os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(d);os.close(d)\nfinally:os.close(f)",
                  ),
              );
              await assert.rejects(
                core.runReadonly(vmId, alpha.identity, original.runId),
                (error: any) => error.code === 'PROJECT_IDENTITY_RECORD_ABSENT',
              );
            }
            throw new Error('Owned native SSH activation acknowledgement lost');
          };
          service = new ProjectSsh(machines, spaces, { identities: core, scopes: faultScopes });
          await assert.rejects(
            start(alpha),
            (error: any) =>
              error.code !== 'PROJECT_SSH_CLEANUP_FAILED' &&
              /Owned native SSH activation acknowledgement lost/.test(error.message),
          );
          assert.ok(original);
          const closed = await core.run(vmId, alpha.identity, original.runId);
          assert.deepEqual(closed, { ...original, phase: 'closed' });
          assert.deepEqual(await faultScopes.sshRuns(vmId, alpha.id), []);
          await guest(
            'test ! -e ' +
              quote('/sys/fs/cgroup/' + original.cgroupName) +
              '; test ! -e ' +
              quote('/run/sakura-project-identities/ssh/' + original.runId + '.json'),
          );
          const betaRun = (await scopes.sshRuns(vmId, beta.id))[0];
          await scopes.sshRun(vmId, beta.id, betaRun.runId);
          await service.close();
          service = new ProjectSsh(machines, spaces);
          await start(alpha);
          return {
            original,
            recoveredClosed: closed,
            originalGroupAbsent: true,
            receiptRetired: true,
            otherProjectPreserved: true,
            hostIntentDidNotAuthorizeSession: true,
            ...(partial
              ? {
                  faultInjection:
                    'Removed the exactly pinned native RUN file after real prepare, preserving its protected SSH receipt and live service cgroup.',
                  removedNativeRecordSha256: nativeRecordSha256,
                  readonlySessionRefused: true,
                }
              : { nativeActivationReplyLossInjected: true }),
          };
        },
      );
    }
    proof.bodyPassed = true;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(error);
  } finally {
    for (const channel of channels) channel.close();
    channels.clear();
    for (const client of clients) client.end();
    clients.clear();
    try {
      if (vmId && machines.state(vmId) === 'running') {
        const catalog = await spaces.projects.list(vmId);
        for (const project of catalog.projects)
          await spaces.projects.with(vmId, project.id, () => service.stop(vmId));
      }
    } catch (error) {
      proof.cleanupErrors.push(String(error));
    }
    try {
      await service.close();
    } catch (error) {
      proof.cleanupErrors.push(String(error));
    }

    await writeFile(join(root, 'boot-' + invocation + '.log'), machines.logs.get(vmId) || '', { flag: 'wx' });
    try {
      await spaces.close();
    } catch (error) {
      proof.cleanupErrors.push(String(error));
    }
    try {
      if (vmId) {
        const done = machines.live.get(vmId)?.done;
        await machines.stop(vmId, true);
        if (done) await done;
        proof.vmStopped = machines.state(vmId) === 'stopped';
      }
    } catch (error) {
      proof.cleanupErrors.push(String(error));
    }
    try {
      await machines.close();
    } catch (error) {
      proof.cleanupErrors.push(String(error));
    }
    proof.liveEntries = machines.live.size;
    proof.ownedChildren = children.size;
    if (vmId && process.platform === 'win32') {
      const query =
        "$ProgressPreference='SilentlyContinue';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$p=@(Get-CimInstance Win32_Process|Where-Object { $_.ExecutablePath -eq $r.image -and $_.CommandLine -and $_.CommandLine.Contains($r.disk) });[Console]::Out.WriteLine($p.Count)";
      proof.exactQemuMatches = Number(
        execFileSync(
          join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(query, 'utf16le').toString('base64'),
          ],
          {
            input: JSON.stringify({ image: qemu, disk: join(root, 'machines', vmId, 'disk.qcow2') }),
            encoding: 'utf8',
            windowsHide: true,
            timeout: 15000,
          },
        ).trim(),
      );
    }
    const changed = [];
    for (const [file, checksum] of Object.entries(proof.sourceSha256))
      if (hash(await readFile(join(workspace, file))) !== checksum) changed.push(file);
    for (const [file, checksum] of Object.entries(proof.binarySha256))
      if (hash(await readFile(file)) !== checksum) changed.push(file);
    const afterImage = await lstat(image);
    proof.originalImageUnchanged =
      hash(await readFile(image)) === imageSha256 &&
      afterImage.ino === imageInfo.ino &&
      afterImage.size === imageInfo.size &&
      afterImage.mtimeMs === imageInfo.mtimeMs;
    proof.changed = changed;
    proof.finishedAt = new Date().toISOString();
    proof.passed =
      proof.bodyPassed === true &&
      proof.cases.length === 9 &&
      !proof.cleanupErrors.length &&
      !changed.length &&
      proof.originalImageUnchanged &&
      proof.vmStopped &&
      proof.liveEntries === 0 &&
      proof.ownedChildren === 0 &&
      proof.exactQemuMatches === 0 &&
      proof.executions.every(
        (entry: any) => entry.exit && entry.close && entry.stdoutClosed && entry.stderrClosed,
      );
    const proofFile = join(root, 'project-ssh-identity-' + invocation + '.json');
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        proofFile,
        passed: proof.passed,
        cases: proof.cases.map((entry: any) => entry.name),
        cleanup: {
          vmStopped: proof.vmStopped,
          live: proof.liveEntries,
          children: proof.ownedChildren,
          exactQemu: proof.exactQemuMatches,
        },
        error: proof.error || null,
      }),
    );
  }
  if (!proof.passed) process.exitCode = 1;
}
