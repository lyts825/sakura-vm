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

async function run(ownedDirectory?: string) {
  const workspace = await realpath('.'), parent = join(workspace, '.data/project-terminal-test-temp');
  await mkdir(parent, { recursive: true }); assert.equal(await realpath(parent), parent);
  const root = ownedDirectory ? await realpath(ownedDirectory) : await mkdtemp(join(parent, 'sakura-terminal-'));
  assert.equal(dirname(await realpath(root)), parent); assert.match(basename(root), /^sakura-terminal-/);
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
  const phase = (name: string) => { proof.phases.push({ name, at: new Date().toISOString() }); console.log('PHASE ' + name); };
  const files = ['server/project-repository.ts', 'server/project-repository-broker.py', 'server/repository-url.ts',
    'server/workspaces.ts', 'server/project-run-scope.ts', 'server/project-identity.ts', 'server/project-directory-migration.ts',
    'server/guest-task.ts', 'server/machines.ts', 'server/project-main.ts', 'server/project-service-scope.ts', 'server/project-services.ts',
    'server/project-network-isolation.ts', 'server/project-dependency-cache.ts', 'server/dependency-downloads.ts', 'server/network-profiles.ts',
    'native/project-identity/protocol.h', 'native/project-identity/launcher.c', 'native/project-identity/controller.py',
    'scripts/smoke-project-terminal-identity.ts', 'plugins/terminal-workspace/server.ts', 'plugins/terminal-workspace/manifest.ts', 'package.json', 'package-lock.json'];
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
  const unsupported = () => { throw new Error('Unknown terminal test engine operation'); };
  const engine = { version: 'test-only direct Engine', whpxAvailable: false, qemuIoAvailable: false, aarch64Available: false,
    runtime: { close: async () => { for (const child of children.keys()) child.kill(); await Promise.all(children.values()); } },
    runStatus: unsupported, get service() { return unsupported(); },
    run: async (tool: string, args: string[], options?: Parameters<Engine['run']>[2]) => {
      if (tool === 'sakura-img') {
        const disk = args.at(-2)!;
        assert.deepEqual(args.slice(0, 7), ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', base]);
        assert.equal(args.length, 9); assert.equal(args.at(-1), '8G'); assert.equal(basename(disk), 'disk.qcow2');
        assert.equal(dirname(dirname(disk)), join(root, 'machines')); assert.equal(await realpath(dirname(disk)), dirname(disk));
        return execute(img, args, options);
      }
      assert.equal(tool, 'sakura-qemu'); assert.ok(vmId && !qemuStarted); qemuStarted = true;
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
  async function guest(command: string, timeout = 30000) {
    const result = await machines.exec(vmId, command, timeout);
    assert.equal(result.code, 0, result.stderr || result.stdout); return result.stdout.trim();
  }
  async function check(name: string, action: () => Promise<unknown>) {
    phase(name); const observation = await action(); proof.cases.push({ name, observation }); console.log('PASS ' + name);
  }
  async function project(name: string) {
    const directory = projectParent + '/' + name; await guest('mkdir ' + quote(directory));
    const config = projectSchema.parse({ directory, networkIsolation: 'private', template: 'none' });
    const index = await spaces.projects.create(vmId, name + '-' + invocation.slice(0, 8), () => writeStore(spaces.projects.file(vmId), config));
    const identity = await spaces.projects.with(vmId, index.active, async () => {
      const preview = await migrations.preview(vmId); assert.ok(preview.plan);
      const applied = await migrations.apply(vmId, { action: 'apply', version: 1, planId: preview.plan.proposal.planId,
        sha256: preview.plan.sha256, reviewed: true }); assert.equal(applied.plan?.state, 'applied');
      return applied.plan!.activatedIdentity!;
    });
    return { id: index.active, directory, identity };
  }
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
    const connection = { lease, ssh, stream, output: () => output,
      close: async () => { stream.close(); ssh.end(); await lease.release(); channels.delete(connection); } };
    channels.add(connection);
    const deadline = Date.now() + 180000;
    while (!output.includes('\x1b[')) {
      assert.ok(Date.now() < deadline && !stream.closed, output || 'PTY attach did not initialize'); await delay(100);
    }
    return connection;
  }
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
    await check('actual interactive PTY runs as the private project UID and cannot read another project', async () => {
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
    await check('named terminals and additional windows retain UID and full ownership across disconnect', async () => {
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
    await check('exact terminal stop kills detached windows and invalidates the old shared UUID', async () => {
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
