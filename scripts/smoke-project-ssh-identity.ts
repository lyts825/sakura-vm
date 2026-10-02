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
  const unsupported = () => {
    throw new Error('Unknown SSH identity test engine operation');
  };
  const engine = {
    version: 'test-only direct Engine',
    whpxAvailable: false,
    qemuIoAvailable: false,
    aarch64Available: false,
    runtime: {
      close: async () => {
        for (const child of children.keys()) child.kill();
        await Promise.all(children.values());
      },
    },
    runStatus: unsupported,
    get service() {
      return unsupported();
    },
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
  async function guest(command: string, timeout = 30000) {
    const result = await machines.exec(vmId, command, timeout);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  }
  async function check(name: string, action: () => Promise<unknown>) {
    phase(name);
    const observation = await action();
    proof.cases.push({ name, observation });
    console.log('PASS ' + name);
  }
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
      writeStore(spaces.projects.file(vmId), config),
    );
    const identity = await spaces.projects.with(vmId, index.active, async () => {
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
  async function start(project: OwnedProject) {
    return spaces.projects.with(vmId, project.id, () => service.start(vmId));
  }
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
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve);
      client.once('error', reject);
      client.connect({
        host: '127.0.0.1',
        port: endpoint.port,
        username: 'root',
        privateKey,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string) => fingerprint === expected,
        readyTimeout: 60000,
      });
    });
    return client;
  }
  async function clientFor(project: OwnedProject) {
    return connect(project);
  }
  async function sshExecute(client: import('ssh2').Client, command: string, input?: Buffer) {
    return await new Promise<{ code: number; output: Buffer; stderr: string }>((resolve, reject) => {
      client.exec(command, (error, channel) => {
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
  async function json(client: import('ssh2').Client, source: string) {
    const result = await sshExecute(client, '/usr/bin/python3 -I -S -c ' + quote(source));
    assert.equal(result.code, 0, result.stderr || result.output.toString());
    return JSON.parse(result.output.toString());
  }
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
    await check('real SSH commands use the private project UID, home and protected environment', async () => {
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
    await check('PTY input and resize preserve interactive execution after Ctrl-C', async () => {
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
    await check('SESSION frames refuse missing client descriptors and combined terminal flags', async () => {
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
        async () => {
          await spaces.projects.with(vmId, alpha.id, () => service.stop(vmId));
          await service.close();
          const core = new ProjectIdentities(machines),
            faultScopes = new ProjectRunScopes(machines, { identities: core });
          const prepare = core.prepareSsh.bind(core);
          let original: import('../server/project-identity.ts').ProjectIdentityRun | undefined;
          let nativeRecordSha256: string | undefined;
          core.prepareSsh = async (...args) => {
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
