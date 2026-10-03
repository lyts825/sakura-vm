import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import ssh2 from 'ssh2';
import ts from 'typescript';
import type { Engine } from '../server/runtime.ts';
import { diskOptions } from '../shared/hardware.ts';

if (process.argv.length === 2 || process.argv[2] === '--describe') {
  console.log(
    'Fresh Alpine only: --run-new alpine. Real UID IPv4/IPv6 egress, system SSH/cron, managed SSH and cold-boot policy restoration. Retains the owned VM, logs and closed-process evidence.',
  );
} else {
  const diagnostic = process.argv[2] === '--inspect-owned';
  if (diagnostic) {
    assert.equal(process.argv.length, 5);
    assert.equal(process.argv[3], 'alpine');
  } else assert.deepEqual(process.argv.slice(2), ['--run-new', 'alpine']);
  assert.deepEqual(process.execArgv, ['--import', 'tsx']);
  assert.equal(process.env.NODE_OPTIONS || '', '');
  await run(diagnostic ? process.argv[4] : undefined);
}

async function run(diagnosticDirectory?: string) {
  const workspace = await realpath('.');
  const configuredParent = process.env.SAKURA_EGRESS_FIXTURE_ROOT;
  if (configuredParent) assert.ok(isAbsolute(configuredParent));
  const parent = resolve(configuredParent || join(workspace, '.data/project-egress-vm-test-temp'));
  await mkdir(parent, { recursive: true });
  assert.equal(await realpath(parent), parent);
  const root = diagnosticDirectory
      ? await realpath(diagnosticDirectory)
      : await mkdtemp(join(parent, 'sakura-egress-')),
    invocation = randomUUID();
  assert.equal(dirname(await realpath(root)), parent);
  assert.match(basename(root), /^sakura-egress-/);
  let prior: any;
  if (diagnosticDirectory) {
    const names = (await readdir(root)).filter((name) =>
      /^project-egress-vm-[a-f0-9-]{36}\.json$/.test(name),
    );
    const completed = await Promise.all(
      names.map(async (name) => JSON.parse(await readFile(join(root, name), 'utf8'))),
    );
    prior = completed.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt))[0];
    assert.ok(prior);
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
  }
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  const proof: any = {
    version: 1,
    invocation,
    root,
    fixtureParent: parent,
    kind: 'fresh-owned-alpine-egress-cold-boot',
    startedAt: new Date().toISOString(),
    passed: false,
    cases: [],
    phases: [],
    executions: [],
    sshClients: [],
    sshChannels: [],
    relayDiagnostics: [],
    sshStatusDiagnostics: [],
    bridgeValidationDiagnostics: [],
    controlDiagnostics: [],
    machineConnectionDiagnostics: [],
    sourceSha256: {},
    cleanupErrors: [],
    client: { node: process.version, execArgv: process.execArgv },
  };
  // Capture runtime import dependencies, rather than unrelated concurrently edited HA/Windows code.
  const captured = new Set<string>();
  async function capture(file: string) {
    const absolute = resolve(workspace, file),
      local = relative(workspace, absolute).replaceAll('\\', '/');
    assert.ok(!local.startsWith('../') && !local.startsWith('.data/'));
    if (captured.has(local)) return;
    captured.add(local);
    assert.equal(await realpath(absolute), absolute);
    const bytes = await readFile(absolute);
    proof.sourceSha256[local] = hash(bytes);
    if (!/\.[cm]?[jt]sx?$/.test(local)) return;
    const source = ts.createSourceFile(local, bytes.toString(), ts.ScriptTarget.Latest, true);
    const dependencies: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isImportDeclaration(node) &&
        !node.importClause?.isTypeOnly &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        dependencies.push(node.moduleSpecifier.text);
      if (
        ts.isExportDeclaration(node) &&
        !node.isTypeOnly &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        dependencies.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        dependencies.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const dependency of dependencies)
      if (dependency.startsWith('.'))
        await capture(relative(workspace, resolve(dirname(absolute), dependency)));
  }
  for (const file of [
    'scripts/smoke-project-egress-vm.ts',
    'native/project-identity/protocol.h',
    'native/project-identity/launcher.c',
    'native/project-identity/controller.py',
    '.sakura-server/assets/project-identity/manifest.json',
    '.sakura-server/assets/project-identity/protocol.h',
    '.sakura-server/assets/project-identity/launcher.c',
    '.sakura-server/assets/project-identity/controller.py',
    'scripts/smoke-project-identity-fds-linux.py',
    'server/project-repository-broker.py',
    'package-lock.json',
    'node_modules/ssh2/package.json',
    'node_modules/tsx/package.json',
  ])
    await capture(file);
  proof.sourceContract =
    'This harness and its local runtime import closure, native identity sources, repository broker, dependency lock and SSH/tsx package identities. No claim about unrelated HA or Windows sources.';
  const image = await realpath(join(workspace, '.data/images/alpine-3.23.qcow2'));
  assert.equal(image, join(workspace, '.data/images/alpine-3.23.qcow2'));
  const imageInfo = await lstat(image),
    imageSha256 = hash(await readFile(image));
  assert.ok(imageInfo.isFile() && !imageInfo.isSymbolicLink());
  const ownImages = join(root, 'images'),
    base = join(ownImages, 'alpine-3.23.qcow2');
  if (!diagnosticDirectory) {
    await mkdir(ownImages);
    await copyFile(image, base, constants.COPYFILE_EXCL);
  } else {
    assert.equal(prior.base.privateCopy, base);
    assert.equal(prior.base.originalSha256, imageSha256);
  }
  assert.equal(hash(await readFile(base)), imageSha256);
  proof.base = { original: image, originalSha256: imageSha256, privateCopy: base };
  await writeFile(join(root, 'intent-' + invocation + '.json'), JSON.stringify(proof, null, 2), {
    flag: 'wx',
  });
  process.env.SAKURA_DATA_DIR = root;
  process.env.SAKURA_IMAGE_DIR = ownImages;
  process.env.SAKURA_IMAGE_PATH = base;
  process.env.TEMP = process.env.TMP = root;
  const { Machines } = await import('../server/machines.ts');
  const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
  const { ProjectDirectoryMigrations } = await import('../server/project-directory-migration.ts');
  const { ProjectIdentities, projectIdentitySources } = await import('../server/project-identity.ts');
  const { ProjectSsh } = await import('../server/project-ssh.ts');
  const { createSshKey } = await import('../server/seed.ts');
  const { quote } = await import('../server/files.ts');
  const { writeStore } = await import('../server/local-store.ts');
  const source = await projectIdentitySources();
  proof.identityBuild = source.manifest;
  for (const entry of source.manifest.files)
    assert.equal(entry.sha256, proof.sourceSha256['native/project-identity/' + entry.name]);
  const qemu = join(workspace, '.tools/qemu/qemu-system-x86_64.exe'),
    img = join(workspace, '.tools/qemu/qemu-img.exe');
  proof.binarySha256 = { [qemu]: hash(await readFile(qemu)), [img]: hash(await readFile(img)) };
  const children = new Map<ChildProcess, Promise<void>>();
  let vmId = '',
    qemuActive = false,
    boot = 0;
  const phase = (name: string) => {
    proof.phases.push({ name, at: new Date().toISOString() });
    console.log('PHASE ' + name);
  };
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
      boot,
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
      stream!.on('data', (bytes: Buffer) => {
        count += bytes.length;
        if (count > 2 * 1048576) {
          entry.outputLimitExceeded = true;
          child.kill();
        } else output.push(Buffer.from(bytes));
        options?.output?.(bytes);
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
        if (vm) qemuActive = false;
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
      Math.min(options?.timeoutMs || (vm ? 900000 : 30000), vm ? 900000 : 180000),
    );
    if (options?.signal?.aborted) abort();
    try {
      await closed;
      if (failure) throw failure;
      assert.equal(entry.outputLimitExceeded, undefined);
      assert.equal(entry.timeoutRequested, undefined);
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
    throw new Error('Unknown egress fixture Engine operation');
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
      assert.ok(vmId && !qemuActive && boot <= 2);
      qemuActive = true;
      const escaped = (value: string) => value.replaceAll(',', ',,');
      assert.deepEqual(
        args.flatMap((arg, index) => (arg === '-drive' ? [args[index + 1]] : [])),
        [
          `file=${escaped(join(root, 'machines', vmId, 'disk.qcow2'))},if=virtio,id=sakura-disk,format=qcow2,${diskOptions(hardware)}`,
          `file=${escaped(join(root, 'machines', vmId, 'seed.iso'))},media=cdrom,readonly=on`,
        ],
      );
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
  const machines = new Machines(engine),
    spaces = new Workspaces(machines),
    identities = new ProjectIdentities(machines),
    migrations = new ProjectDirectoryMigrations(machines, spaces),
    managedSsh = new ProjectSsh(machines, spaces);
  const diagnosticError = (error: unknown) => ({
    message: error instanceof Error ? error.message : String(error),
    code: error instanceof Error ? Reflect.get(error, 'code') || null : null,
  });
  const machineExec = machines.exec.bind(machines);
  machines.exec = async (...arguments_: Parameters<typeof machineExec>) => {
    try {
      const result = await machineExec(...arguments_);
      if (result.code !== 0) proof.controlDiagnostics.push({
        commandSha256: hash(arguments_[1]), at: new Date().toISOString(),
        code: result.code, stdout: result.stdout.slice(0, 8192), stderr: result.stderr.slice(0, 8192),
      });
      return result;
    } catch (error) {
      proof.controlDiagnostics.push({ commandSha256: hash(arguments_[1]),
        at: new Date().toISOString(), error: diagnosticError(error) });
      throw error;
    }
  };
  const sshStatus = managedSsh.status.bind(managedSsh);
  managedSsh.status = async (...arguments_: Parameters<typeof sshStatus>) => {
    const entry: any = { startedAt: new Date().toISOString(), projectId: arguments_[1]._workspace };
    proof.sshStatusDiagnostics.push(entry);
    try {
      const result = await sshStatus(...arguments_);
      entry.result = result;
      return result;
    } catch (error) {
      entry.error = diagnosticError(error);
      throw error;
    } finally { entry.finishedAt = new Date().toISOString(); }
  };
  const bridge = Reflect.get(managedSsh, 'bridges'), validateBridge = Reflect.get(bridge, 'validate');
  Reflect.set(bridge, 'validate', async (...arguments_: unknown[]) => {
    const entry: any = { startedAt: new Date().toISOString() };
    proof.bridgeValidationDiagnostics.push(entry);
    try {
      await Reflect.apply(validateBridge, bridge, arguments_);
      entry.passed = true;
    } catch (error) {
      entry.error = diagnosticError(error);
      throw error;
    } finally { entry.finishedAt = new Date().toISOString(); }
  });
  const machineConnect = machines.connect.bind(machines);
  machines.connect = async (...arguments_: Parameters<typeof machineConnect>) => {
    const connection: any = { startedAt: new Date().toISOString() };
    proof.machineConnectionDiagnostics.push(connection);
    let client: Awaited<ReturnType<typeof machineConnect>>;
    try {
      client = await machineConnect(...arguments_);
      connection.readyAt = new Date().toISOString();
      client.once('close', () => { connection.closedAt = new Date().toISOString(); });
      client.on('error', (error: Error) => { connection.error = diagnosticError(error); });
    } catch (error) {
      connection.error = diagnosticError(error);
      connection.finishedAt = new Date().toISOString();
      throw error;
    }
    const original = client.exec;
    Reflect.set(client, 'exec', (...args: unknown[]) => {
      const command = args[0], callback = args.at(-1);
      if (typeof command === 'string' && command.includes('sock=socket.create_connection') &&
          typeof callback === 'function') {
        const entry: any = { commandSha256: hash(command), startedAt: new Date().toISOString(),
          stderr: '', exit: null, closed: false };
        proof.relayDiagnostics.push(entry);
        args[args.length - 1] = (error: Error | undefined, channel: import('ssh2').ClientChannel) => {
          if (error) entry.setupError = error.message;
          if (channel) {
            channel.stderr.on('data', (bytes: Buffer) => {
              entry.stderr = (entry.stderr + bytes.toString()).slice(0, 8192);
            });
            channel.once('exit', (code: number | null, signal?: string) => {
              entry.exit = { code, signal: signal || null };
            });
            channel.once('close', () => { entry.closed = true; entry.closedAt = new Date().toISOString(); });
          }
          callback(error, channel);
        };
      }
      return Reflect.apply(original, client, args);
    });
    return client;
  };
  const clients = new Set<import('ssh2').Client>(),
    channels = new Set<import('ssh2').ClientChannel>();
  const clientClosures = new Map<import('ssh2').Client, Promise<void>>();
  async function closeClient(client: import('ssh2').Client) {
    client.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        clientClosures.get(client),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('owned SSH client did not close')), 15000);
        }),
      ]);
    } catch (error) {
      proof.cleanupErrors.push(String(error));
      client.destroy();
      await clientClosures.get(client);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const projectParent = '/srv/projects/egress-' + invocation,
    fixture = '/var/lib/sakura-egress-fixture-' + invocation,
    helperDirectory = '/usr/local/lib/sakura-egress-test-' + invocation;
  let alpha: Awaited<ReturnType<typeof project>> | undefined,
    beta: Awaited<ReturnType<typeof project>> | undefined,
    serverRecord: any,
    cronInstalled = false;
  async function guest(command: string, timeout = 30000) {
    const result = await machines.exec(vmId, command, timeout);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  }
  async function python(source: string, timeout = 30000) {
    return JSON.parse(await guest('/usr/bin/python3 -I -S -c ' + quote(source), timeout));
  }
  async function admissionDiagnosis() {
    const controller = '/usr/local/lib/sakura-project-identity/' + source.manifest.build + '/controller.py';
    const digest = source.manifest.files.find((entry) => entry.name === 'controller.py')!.sha256;
    return python(
      `import os,json,hashlib,traceback
path=${JSON.stringify(controller)};raw=open(path,'rb').read();assert hashlib.sha256(raw).hexdigest()==${JSON.stringify(digest)}
ns={'__name__':'owned_readonly_diagnostic','__file__':path};exec(compile(raw,path,'exec'),ns)
report={'controllerSha256':hashlib.sha256(raw).hexdigest(),'calls':[],'bindings':[],'processFailures':[]}
def attempt(name,call):
 try:
  value=call();report['calls'].append({'name':name,'ok':True,'value':value});return value
 except BaseException as error:
  report['calls'].append({'name':name,'ok':False,'type':type(error).__name__,'errno':getattr(error,'errno',None),'repr':repr(error)[:1024],
   'code':getattr(error,'code',None),'detail':getattr(error,'detail',None),'traceback':traceback.format_exc()[-8192:]});return None
store=attempt('registry(readonly=True)',lambda:ns['registry'](readonly=True))
private=[]
if store:
 for item in store['reserved'].values():
  binding=ns['binding_read'](item['projectId'],True)
  if binding:
   report['bindings'].append({key:binding[key] for key in ('projectId','identityId','uid','gid','phase','networkIsolation')})
   if binding['networkIsolation']=='private':private.append(binding)
def realm():
 fd,value=ns['egress_realm']()
 try:return value
 finally:os.close(fd)
attempt('egress_realm',realm);attempt('egress_context',ns['egress_context'])
for binding in private:attempt('egress_table '+str(binding['uid']),lambda binding=binding:ns['egress_table'](binding))
manager=attempt('egress_nnp_configuration',ns['egress_nnp_configuration'])
for binding in private:attempt('egress_nnp_live '+str(binding['uid']),lambda binding=binding:ns['egress_nnp_live'](binding,'openrc'))
parent=ns['egress_nnp_directory']('/proc')
try:
 for name in os.listdir(parent):
  if not name.isdigit():continue
  try:ns['egress_nnp_process'](parent,int(name))
  except BaseException as error:
   report['processFailures'].append({'pid':int(name),'type':type(error).__name__,'errno':getattr(error,'errno',None),'repr':repr(error)[:1024],'traceback':traceback.format_exc()[-8192:]})
   if len(report['processFailures'])>=4:break
finally:os.close(parent)
assert hashlib.sha256(open(path,'rb').read()).hexdigest()==report['controllerSha256']
print(json.dumps(report))`,
      60000,
    );
  }
  async function waitFor(action: () => Promise<boolean> | boolean, label: string, timeout = 30000) {
    const deadline = Date.now() + timeout;
    while (!(await action())) {
      assert.ok(Date.now() < deadline, label);
      await delay(250);
    }
  }
  async function check(name: string, action: () => Promise<unknown>) {
    phase(name);
    const observation = await action();
    proof.cases.push({ name, observation });
    console.log('PASS ' + name);
  }
  async function project(name: string, networkIsolation: 'host' | 'private' = 'private') {
    const directory = projectParent + '/' + name;
    await guest('mkdir ' + quote(directory));
    const config = projectSchema.parse({ directory, networkIsolation, template: 'none', environment: {} });
    const index = await spaces.projects.create(vmId, name + '-' + invocation.slice(0, 8), () =>
      writeStore(spaces.projects.file(vmId), config),
    );
    const identity = await spaces.projects.with(vmId, index.active, async () => {
      let preview: Awaited<ReturnType<typeof migrations.preview>>;
      try {
        preview = await migrations.preview(vmId);
      } catch (error) {
        if (
          networkIsolation !== 'private' ||
          proof.nnpServiceRestart ||
          (error as { code?: string }).code !== 'PROJECT_IDENTITY_EGRESS_NNP_RESTART_REQUIRED'
        )
          throw error;
        phase('new owned VM explicitly restarts SSH and cron after NNP admission refusal');
        proof.nnpServiceRestart = {
          refusal: {
            code: (error as { code: string }).code,
            message: error instanceof Error ? error.message : String(error),
          },
          boundary:
            'Only sshd/crond in this fresh owned test VM. No historical VM or existing user session is restarted.',
        };
        await guest('rc-service sshd restart');
        await guest('rc-service crond restart');
        preview = await migrations.preview(vmId);
        proof.nnpServiceRestart.retryAccepted = true;
      }
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
  async function connect(port: number, username: string, privateKey: string | Buffer, publicKey: string) {
    const key = ssh2.utils.parseKey(publicKey);
    assert.ok(!(key instanceof Error) && !Array.isArray(key));
    const expected = hash(key.getPublicSSH()),
      client = new ssh2.Client();
    clients.add(client);
    const receipt: any = { username, port, closed: false };
    proof.sshClients.push(receipt);
    clientClosures.set(client, new Promise<void>((done) => client.once('close', () => {
      receipt.closed = true;
      clients.delete(client);
      done();
    })));
    await new Promise<void>((done, reject) => {
      client.once('ready', done);
      client.once('error', reject);
      client.connect({
        host: '127.0.0.1',
        port,
        username,
        privateKey,
        hostHash: 'sha256',
        hostVerifier: (fingerprint: string) => fingerprint === expected,
        readyTimeout: 60000,
      });
    });
    return client;
  }
  async function sshExec(client: import('ssh2').Client, command: string, pty = false) {
    return new Promise<{ code: number; output: string; stderr: string }>((done, reject) => {
      client.exec(command, { pty }, (error, channel) => {
        if (error) return reject(error);
        channels.add(channel);
        const receipt: any = { closed: false, exit: null };
        proof.sshChannels.push(receipt);
        channel.once('exit', (code: number, signal: string | undefined) => {
          receipt.exit = { code, signal: signal || null };
        });
        const output: Buffer[] = [],
          errors: Buffer[] = [];
        let size = 0;
        const timer = setTimeout(() => {
          channel.close();
          reject(new Error('SSH channel close timed out'));
        }, 60000);
        channel.on('data', (bytes: Buffer) => {
          size += bytes.length;
          if (size > 1048576) {
            channel.close();
            reject(new Error('SSH output exceeded limit'));
          } else output.push(Buffer.from(bytes));
        });
        channel.stderr.on('data', (bytes: Buffer) => errors.push(Buffer.from(bytes)));
        channel.once('error', reject);
        channel.once('close', (code: number) => {
          clearTimeout(timer);
          receipt.closed = true;
          receipt.closeCode = code;
          channels.delete(channel);
          done({ code, output: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() });
        });
        channel.end();
      });
    });
  }
  const key = createSshKey();
  if (!diagnosticDirectory) {
    await writeFile(join(root, 'system-ssh-key.pem'), key.privateText, { flag: 'wx', mode: 0o600 });
  }
  const privilegeSource = `#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>
int main(int argc,char **argv) {
 if(argc!=3)return 64;
 uid_t before=getuid();int changed=setresuid(0,0,0),reason=errno;
 printf("{\\"uidBefore\\":%u,\\"uid\\":%u,\\"euid\\":%u,\\"setuidResult\\":%d,\\"setuidErrno\\":%d,\\"connections\\":[",before,getuid(),geteuid(),changed,changed<0?reason:0);
 for(int i=0;i<2;i++) {
  int family=i?AF_INET6:AF_INET,s=socket(family,SOCK_STREAM,0);if(s<0)return 70;
  struct timeval limit={1,0};if(setsockopt(s,SOL_SOCKET,SO_SNDTIMEO,&limit,sizeof(limit)))return 70;
  int result;
  if(i){struct sockaddr_in6 a={.sin6_family=AF_INET6,.sin6_port=htons((unsigned short)atoi(argv[i+1]))};inet_pton(AF_INET6,"::1",&a.sin6_addr);result=connect(s,(struct sockaddr*)&a,sizeof(a));}
  else {struct sockaddr_in a={.sin_family=AF_INET,.sin_port=htons((unsigned short)atoi(argv[i+1]))};inet_pton(AF_INET,"127.0.0.1",&a.sin_addr);result=connect(s,(struct sockaddr*)&a,sizeof(a));}
  printf("%s{\\"family\\":%d,\\"connected\\":%s}",i?",":"",family,result==0?"true":"false");close(s);
 }
 puts("]}");return 0;
}
`;
  async function installPrivilegeHelpers() {
    return python(
      `import os,subprocess,json,struct,hashlib
root=${JSON.stringify(helperDirectory)};os.mkdir(root,0o755)
source=root+'/helper.c';data=${JSON.stringify(privilegeSource)}.encode()
fd=os.open(source,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
records=[]
for name in ('setuid','filecap'):
 path=root+'/'+name;subprocess.run(['/usr/bin/cc','-std=c11','-O2','-Wall','-Wextra','-Werror',source,'-o',path],check=True,timeout=120)
 os.chmod(path,0o4755 if name=='setuid' else 0o755)
 if name=='filecap':
  capability=struct.pack('<IIIII',0x02000001,1<<7,0,0,0)
  os.setxattr(path,'security.capability',capability);assert os.getxattr(path,'security.capability')==capability
 info=os.lstat(path);assert info.st_uid==0 and info.st_nlink==1
 records.append({'kind':name,'path':path,'uid':info.st_uid,'mode':info.st_mode&0o7777,'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest()})
print(json.dumps({'sourceSha256':hashlib.sha256(data).hexdigest(),'binaries':records}))`,
      150000,
    );
  }
  const serverSource = `import json,os,socket,threading,time,sys
servers=[]
for family,host in ((socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')):
 s=socket.socket(family,socket.SOCK_STREAM);s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 if family==socket.AF_INET6:s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
 s.bind((host,0));s.listen(8);servers.append(s)
 def serve(listener):
  while True:
   conn,_=listener.accept()
   with conn:conn.sendall(b'sakura-owned-egress')
 threading.Thread(target=serve,args=(s,),daemon=True).start()
record={'pid':os.getpid(),'startTicks':open('/proc/self/stat').read().rsplit(')',1)[1].split()[19],
 'exe':os.readlink('/proc/self/exe'),'cwd':os.getcwd(),'networkInode':str(os.stat('/proc/self/ns/net').st_ino),
 'ports':[s.getsockname()[1] for s in servers]}
fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as stream:json.dump(record,stream);stream.flush();os.fsync(stream.fileno())
while True:time.sleep(1)
`;
  async function startServer() {
    const path = fixture + '/server.py',
      receipt = fixture + '/server-' + boot + '.json';
    const launched = await python(`import os,subprocess,json
root=${JSON.stringify(fixture)};path=${JSON.stringify(path)};receipt=${JSON.stringify(receipt)}
if not os.path.exists(root):os.mkdir(root,0o700)
assert os.lstat(root).st_uid==0 and os.lstat(root).st_mode&0o777==0o700
data=${JSON.stringify(serverSource)}.encode()
if os.path.exists(path):assert open(path,'rb').read()==data
else:
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
child=subprocess.Popen(['/usr/bin/python3','-I','-S',path,receipt],cwd=root,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)
print(json.dumps({'pid':child.pid,'receipt':receipt}))`);
    await waitFor(
      async () => (await machines.exec(vmId, 'test -f ' + quote(receipt), 10000)).code === 0,
      'owned dual-stack server not ready',
    );
    serverRecord = await python(`import json;print(open(${JSON.stringify(receipt)}).read())`);
    assert.equal(serverRecord.pid, launched.pid);
    assert.equal(serverRecord.cwd, fixture);
    assert.equal(serverRecord.ports.length, 2);
    proof.phases.push({ name: 'owned dual-stack server', boot, record: serverRecord });
    return serverRecord;
  }
  async function stopServer() {
    if (!serverRecord) return;
    const record = serverRecord;
    const stopped = await python(`import os,json,signal,time,hashlib
r=${JSON.stringify(record)};pid=r['pid'];path='/proc/'+str(pid)
assert open(path+'/stat').read().rsplit(')',1)[1].split()[19]==r['startTicks']
assert os.readlink(path+'/exe')==r['exe'] and os.readlink(path+'/cwd')==r['cwd']
assert open(path+'/cmdline','rb').read().split(b'\\0')[:4]==[b'/usr/bin/python3',b'-I',b'-S',${JSON.stringify(fixture + '/server.py')}.encode()]
assert hashlib.sha256(open(${JSON.stringify(fixture + '/server.py')},'rb').read()).hexdigest()==${JSON.stringify(hash(serverSource))}
os.kill(pid,signal.SIGTERM)
for _ in range(100):
 if not os.path.exists(path) or open(path+'/stat').read().rsplit(')',1)[1].split()[0]=='Z':break
 time.sleep(.05)
else:raise RuntimeError('owned server still alive')
print(json.dumps({'pid':pid,'exactOwnerChecked':True,'stopped':True}))`);
    proof.phases.push({ name: 'owned dual-stack server stopped', boot, observation: stopped });
    serverRecord = undefined;
  }
  function socketClient() {
    assert.ok(serverRecord);
    return `import json,os,socket,subprocess
result={'uid':os.getuid(),'gid':os.getgid(),'networkInode':str(os.stat('/proc/self/ns/net').st_ino),
 'noNewPrivileges':int(next(line.split(':',1)[1] for line in open('/proc/self/status') if line.startswith('NoNewPrivs:'))),'connections':[]}
for family,host,port in ((socket.AF_INET,'127.0.0.1',${serverRecord.ports[0]}),(socket.AF_INET6,'::1',${serverRecord.ports[1]})):
 s=socket.socket(family,socket.SOCK_STREAM);s.settimeout(1)
 try:s.connect((host,port));data=s.recv(128);result['connections'].append({'family':int(family),'connected':True,'body':data.decode()})
 except OSError as error:result['connections'].append({'family':int(family),'connected':False,'error':type(error).__name__,'errno':error.errno})
 finally:s.close()
result['privilegeHelpers']={}
for name in ('setuid','filecap'):
 result['privilegeHelpers'][name]=json.loads(subprocess.check_output([${JSON.stringify(helperDirectory)}+'/'+name,${JSON.stringify(String(serverRecord.ports[0]))},${JSON.stringify(String(serverRecord.ports[1]))}],timeout=10))
print(json.dumps(result))
`;
  }
  function blocked(value: any) {
    assert.ok(alpha);
    assert.equal(value.uid, alpha.identity.uid);
    assert.equal(value.gid, alpha.identity.gid);
    assert.equal(value.networkInode, serverRecord.networkInode);
    assert.equal(value.connections.length, 2);
    assert.ok(value.connections.every((entry: any) => entry.connected === false));
    return value;
  }
  function privilegesBlocked(value: any) {
    assert.equal(value.noNewPrivileges, 1);
    for (const kind of ['setuid', 'filecap']) {
      const helper = value.privilegeHelpers[kind];
      assert.equal(helper.uidBefore, alpha!.identity.uid);
      assert.equal(helper.uid, alpha!.identity.uid);
      assert.equal(helper.euid, alpha!.identity.uid);
      assert.equal(helper.setuidResult, -1);
      assert.ok(helper.connections.every((entry: any) => entry.connected === false));
    }
    return value;
  }
  async function policy() {
    assert.ok(alpha);
    return python(`import json,os,subprocess,shutil
uid=${alpha.identity.uid};root='/var/lib/sakura/project-identities'
owner=json.load(open(root+'/egress/'+str(uid)+'.json'))
table=json.loads(subprocess.check_output([shutil.which('nft',path='/usr/sbin:/usr/bin:/sbin:/bin'),'-j','list','table','inet','skp_uid_'+str(uid)]))
print(json.dumps({'bootId':open('/proc/sys/kernel/random/boot_id').read().strip(),'networkInode':str(os.stat('/proc/1/ns/net').st_ino),'owner':owner,'table':table,
 'sshdDependency':open('/etc/conf.d/sshd').read(),'cronDependency':open('/etc/conf.d/crond').read()}))`);
  }
  async function systemSsh() {
    assert.ok(alpha);
    const publicKey = await guest('cat /etc/ssh/ssh_host_ed25519_key.pub');
    const client = await connect(
      machines.live.get(vmId)!.sshPort,
      alpha.identity.account,
      key.privateText,
      publicKey,
    );
    try {
      const result = await sshExec(client, '/usr/bin/python3 -I -S -c ' + quote(socketClient()));
      assert.equal(result.code, 0, result.stderr || result.output);
      return privilegesBlocked(blocked(JSON.parse(result.output)));
    } finally {
      await closeClient(client);
    }
  }
  async function cron() {
    assert.ok(alpha);
    const program = alpha.directory + '/cron-' + boot + '.py',
      output = alpha.directory + '/cron-' + boot + '.json',
      log = alpha.directory + '/cron-' + boot + '.log';
    const clientSource = socketClient().replace(
      'print(json.dumps(result))',
      `fd=os.open(${JSON.stringify(output)},os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\nwith os.fdopen(fd,'w') as stream:json.dump(result,stream);stream.flush();os.fsync(stream.fileno())`,
    );
    const installed = await python(`import os,json,subprocess
path=${JSON.stringify(program)};fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400)
with os.fdopen(fd,'w') as stream:stream.write(${JSON.stringify(clientSource)});stream.flush();os.fsync(stream.fileno())
os.chown(path,${alpha.identity.uid},${alpha.identity.gid})
job=${JSON.stringify('* * * * * /usr/bin/python3 -I -S ' + program + ' >' + log + ' 2>&1\n')}
subprocess.run(['/usr/bin/crontab','-u',${JSON.stringify(alpha.identity.account)},'-'],input=job.encode(),check=True,timeout=15)
print(json.dumps({'program':path,'sha256':__import__('hashlib').sha256(open(path,'rb').read()).hexdigest(),'output':${JSON.stringify(output)}}))`);
    cronInstalled = true;
    await guest('rc-service crond start');
    await waitFor(
      async () => (await machines.exec(vmId, 'test -f ' + quote(output), 10000)).code === 0,
      'real cron job produced no result',
      85000,
    );
    const result = await python(`import json,os,stat
path=${JSON.stringify(output)};info=os.lstat(path)
assert stat.S_ISREG(info.st_mode) and info.st_uid==${alpha.identity.uid} and info.st_nlink==1 and info.st_mode&0o777==0o600
print(open(path).read())`);
    await guest('crontab -u ' + quote(alpha.identity.account) + ' -r');
    cronInstalled = false;
    return { ...privilegesBlocked(blocked(result)), installed };
  }
  async function ordinary() {
    assert.ok(alpha && beta);
    const source = socketClient(),
      target = blocked(
        JSON.parse(
          await guest(
            'su ' +
              quote(alpha.identity.account) +
              ' -s /bin/sh -c ' +
              quote('/usr/bin/python3 -I -S -c ' + quote(source)),
          ),
        ),
      );
    const neighbor = JSON.parse(
      await guest(
        'su ' +
          quote(beta.identity.account) +
          ' -s /bin/sh -c ' +
          quote('/usr/bin/python3 -I -S -c ' + quote(source)),
      ),
    );
    const rootClient = await python(source);
    for (const value of [neighbor, rootClient]) {
      assert.equal(value.networkInode, serverRecord.networkInode);
      assert.ok(
        value.connections.every((entry: any) => entry.connected && entry.body === 'sakura-owned-egress'),
      );
    }
    assert.equal(neighbor.uid, beta.identity.uid);
    assert.equal(rootClient.uid, 0);
    return { target, neighbor, root: rootClient };
  }
  async function managed() {
    assert.ok(alpha);
    await spaces.projects.with(vmId, alpha.id, () => managedSsh.start(vmId));
    const configured = await spaces.projects.inScope(vmId, alpha.id, () => spaces.config(vmId));
    const endpoint = await managedSsh.endpoint(vmId, configured);
    assert.ok(endpoint);
    const client = await connect(
      endpoint.port,
      'root',
      await readFile(endpoint.identity),
      endpoint.hostPublicKey,
    );
    try {
      const source = `import json,os,socket
result={'uid':os.getuid(),'gid':os.getgid(),'networkInode':str(os.stat('/proc/self/ns/net').st_ino),'noNewPrivileges':int(next(line.split(':',1)[1] for line in open('/proc/self/status') if line.startswith('NoNewPrivs:'))),'loopback':[]}
for family,host in ((socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')):
 listener=socket.socket(family,socket.SOCK_STREAM);listener.bind((host,0));listener.listen(1)
 conn=socket.socket(family,socket.SOCK_STREAM);conn.settimeout(2);conn.connect(listener.getsockname());accepted,_=listener.accept()
 accepted.sendall(b'private-loopback');result['loopback'].append(conn.recv(128).decode())
 accepted.close();conn.close();listener.close()
print(json.dumps(result))`;
      const result = await sshExec(client, '/usr/bin/python3 -I -S -c ' + quote(source));
      assert.equal(result.code, 0, result.stderr || result.output);
      const value = JSON.parse(result.output);
      assert.equal(value.uid, alpha.identity.uid);
      assert.equal(value.gid, alpha.identity.gid);
      assert.notEqual(value.networkInode, serverRecord.networkInode);
      assert.equal(value.noNewPrivileges, 1);
      assert.deepEqual(value.loopback, ['private-loopback', 'private-loopback']);
      const pty = await sshExec(client, 'test -t 0 && printf owned-pty-ok', true);
      assert.equal(pty.code, 0, pty.stderr);
      assert.match(pty.output, /owned-pty-ok/);
      return { ...value, pty: true };
    } finally {
      await closeClient(client);
      await spaces.projects.with(vmId, alpha.id, () => managedSsh.stop(vmId));
    }
  }
  async function bootVm() {
    boot++;
    phase('owned Alpine boot ' + boot);
    await machines.start(vmId);
    await waitFor(() => machines.state(vmId) !== 'starting', 'owned Alpine VM did not boot', 300000);
    assert.equal(machines.state(vmId), 'running', (await machines.view(vmId)).lastError);
  }
  try {
    await machines.init();
    if (diagnosticDirectory) {
      const records = await machines.list();
      assert.equal(records.length, 1);
      assert.equal(records[0].id, prior.vmId);
      assert.equal(records[0].name, 'egress-alpine');
      assert.equal(records[0].distro, 'alpine');
      vmId = prior.vmId;
      proof.vmId = vmId;
      proof.kind = 'closed-owned-alpine-readonly-tool-diagnostic';
      proof.previousInvocation = prior.invocation;
      const query =
        "$ProgressPreference='SilentlyContinue';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;[Console]::Write(@(Get-CimInstance Win32_Process|Where-Object { $_.ExecutablePath -eq $r.image -and $_.CommandLine -and $_.CommandLine.Contains($r.disk) }).Count)";
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
              input: JSON.stringify({ image: qemu, disk: join(root, 'machines', vmId, 'disk.qcow2') }),
              encoding: 'utf8',
              windowsHide: true,
              timeout: 15000,
            },
          ).trim(),
        ),
        0,
      );
      await bootVm();
      await check('actual OpenRC launcher help contracts on exact closed owned VM', async () => {
        const observation = await python(`import os,subprocess,json,shutil
env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/','LANG':'C','LC_ALL':'C'};records=[]
for name in ('start-stop-daemon','supervise-daemon'):
 path=shutil.which(name,path=env['PATH']);fd=os.open(os.path.realpath(path),os.O_RDONLY|os.O_CLOEXEC)
 try:
  for pinned in (False,True):
   for contract in (False,True):
    args=[('/proc/self/fd/'+str(fd)) if pinned else path]+(['sakura-nnp-check'] if name=='supervise-daemon' and contract else [])+['--help']
    actual=dict(env)
    if contract:actual['RC_SVCNAME']='sakura-nnp-check'
    result=subprocess.run(args,env=actual,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(fd,),timeout=10)
    records.append({'tool':name,'pinned':pinned,'serviceContract':contract,'code':result.returncode,'stdout':result.stdout.decode(errors='replace')[:16384],'stderr':result.stderr.decode(errors='replace')[:4096]})
 finally:os.close(fd)
scripts={name:open('/etc/init.d/'+name).read() for name in ('sshd','crond')}
print(json.dumps({'tools':records,'scripts':scripts}))`);
        proof.diagnostic = observation;
        proof.admissionDiagnosis = await admissionDiagnosis();
        return observation;
      });
      proof.bodyPassed = true;
    } else {
      assert.equal((await machines.list()).length, 0);
      vmId = (
        await machines.create({
          name: 'egress-alpine',
          distro: 'alpine',
          ...hardware,
          diskGiB: 8,
          accelerator: 'tcg',
          forwards: [],
        })
      ).id;
      proof.vmId = vmId;
      await bootVm();
      phase('install native UID policy');
      await guest('test -x /etc/init.d/crond');
      await identities.install(vmId);
      await guest(
        'mkdir -p /srv/projects; mkdir ' +
          quote(projectParent) +
          '; chmod 755 /srv/projects ' +
          quote(projectParent),
      );
      proof.privilegeHelpers = await installPrivilegeHelpers();
      await startServer();
      beta = await project('neighbor', 'host');
      const baseline = JSON.parse(
        await guest(
          'su ' +
            quote(beta.identity.account) +
            ' -s /bin/sh -c ' +
            quote('/usr/bin/python3 -I -S -c ' + quote(socketClient())),
        ),
      );
      assert.equal(baseline.noNewPrivileges, 0);
      for (const helper of Object.values(baseline.privilegeHelpers) as any[]) {
        assert.equal(helper.uidBefore, beta.identity.uid);
        assert.equal(helper.uid, 0);
        assert.equal(helper.euid, 0);
        assert.equal(helper.setuidResult, 0);
        assert.ok(helper.connections.every((entry: any) => entry.connected === true));
      }
      proof.privilegeBaseline = {
        observation: baseline,
        scope:
          'Fresh neighbor account before restarting system SSH. Both real setuid and filecap helpers can elevate and connect, so later refusal is not a disabled fixture.',
      };
      alpha = await project('private');
      proof.projects = { alpha, beta };
      await guest(
        'mkdir ' +
          quote(alpha.identity.home + '/.ssh') +
          '; chmod 700 ' +
          quote(alpha.identity.home + '/.ssh') +
          "; printf '%s\\n' " +
          quote(key.publicText) +
          ' >' +
          quote(alpha.identity.home + '/.ssh/authorized_keys') +
          '; chmod 600 ' +
          quote(alpha.identity.home + '/.ssh/authorized_keys') +
          '; chown -R ' +
          alpha.identity.uid +
          ':' +
          alpha.identity.gid +
          ' ' +
          quote(alpha.identity.home + '/.ssh'),
      );
      const fdSource = await readFile(join(workspace, 'scripts/smoke-project-identity-fds-linux.py'));
      const fdScript = fixture + '/fds.py',
        fdProof = fixture + '/fds.json',
        installedBuild = '/usr/local/lib/sakura-project-identity/' + source.manifest.build;
      const uploaded = await machines.execInput(
        vmId,
        '/usr/bin/python3 -I -S -c ' +
          quote(
            `import os,sys,hashlib\ndata=sys.stdin.buffer.read(${fdSource.length + 1})\nassert hashlib.sha256(data).hexdigest()==${JSON.stringify(hash(fdSource))}\nfd=os.open(${JSON.stringify(fdScript)},os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)\nwith os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())`,
          ),
        fdSource,
        30000,
      );
      assert.equal(uploaded.code, 0, uploaded.stderr);
      await guest(
        '/usr/bin/python3 -I -S ' +
          quote(fdScript) +
          ' ' +
          quote(installedBuild) +
          ' ' +
          quote(fdProof) +
          ' --launcher ' +
          quote(installedBuild + '/launch'),
        180000,
      );
      proof.descriptorHarness = await python(`import json;print(open(${JSON.stringify(fdProof)}).read())`);
      assert.equal(proof.descriptorHarness.passed, true);
      for (const entry of source.manifest.files)
        assert.equal(proof.descriptorHarness.sources[entry.name], entry.sha256);
      let initial: any;
      await check(
        'private account has real owned dual-stack kernel policy and boot dependencies',
        async () => {
          initial = await policy();
          assert.equal(initial.owner.phase, 'applied');
          assert.equal(initial.owner.mode, 'private');
          assert.equal(initial.owner.bootId, initial.bootId);
          assert.equal(initial.owner.networkInode, initial.networkInode);
          assert.match(initial.sshdDependency, /rc_need=.*sakura-project-egress/);
          assert.match(initial.cronDependency, /rc_need=.*sakura-project-egress/);
          const objects = initial.table.nftables.filter((entry: any) => !entry.metainfo);
          assert.equal(objects.length, 3);
          return initial;
        },
      );
      await check(
        'ordinary shared-network UID sockets are blocked while Root and neighbor remain functional',
        ordinary,
      );
      await check(
        'ordinary system SSH command uses the project UID and cannot reach shared IPv4 or IPv6',
        systemSsh,
      );
      await check('managed SSH still supports command, PTY and private IPv4/IPv6 loopback', managed);
      await check('real crond job uses the project UID and cannot reach shared IPv4 or IPv6', cron);
      await stopServer();
      await guest('/bin/sync');
      await writeFile(join(root, 'boot-1-' + invocation + '.log'), machines.logs.get(vmId) || '', {
        flag: 'wx',
      });
      phase('close exact first QEMU before cold boot');
      const first = machines.live.get(vmId)?.done;
      await machines.stop(vmId, true);
      if (first) await first;
      assert.equal(machines.live.size, 0);
      assert.equal(children.size, 0);
      await bootVm();
      await check(
        'cold boot restores kernel rules before system SSH and cron without controller repair',
        async () => {
          const restored = await policy();
          assert.notEqual(restored.bootId, initial.bootId);
          assert.equal(restored.owner.bootId, restored.bootId);
          assert.equal(restored.owner.networkInode, restored.networkInode);
          assert.equal(restored.owner.phase, 'applied');
          assert.equal(restored.owner.mode, 'private');
          assert.equal(restored.owner.identityId, initial.owner.identityId);
          assert.equal(restored.owner.registryId, initial.owner.registryId);
          await guest('rc-service sakura-project-egress status');
          return restored;
        },
      );
      await startServer();
      await check('shared-network policy survives a real cold boot', ordinary);
      await check('system SSH remains isolated after a real cold boot', systemSsh);
      await check('real crond remains isolated after a real cold boot', cron);
      proof.bodyPassed = true;
    }
  } catch (error) {
    proof.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(error);
    if (!diagnosticDirectory && vmId && machines.state(vmId) === 'running') {
      if (alpha) {
        try {
          const projectId = alpha.id;
          proof.managedSshDiagnosis = await python(`import os,json,hashlib,stat
project=${JSON.stringify(projectId)};path='/run/sakura-project-ssh/'+project+'/log'
result={'projectId':project,'log':None}
try:
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  info=os.fstat(fd);assert stat.S_ISREG(info.st_mode) and info.st_uid==0
  result['log']=os.read(fd,8192).decode('utf-8','replace')
 finally:os.close(fd)
except FileNotFoundError:pass
print(json.dumps(result))`);
        } catch (diagnosticError) {
          proof.managedSshDiagnosticError = String(diagnosticError);
        }
      }
      try {
        proof.admissionDiagnosis = await admissionDiagnosis();
      } catch (diagnosticError) {
        proof.admissionDiagnosticError = String(diagnosticError);
      }
    }
  } finally {
    for (const channel of channels) channel.close();
    await Promise.all([...clients].map(closeClient));
    if (vmId && machines.state(vmId) === 'running') {
      try {
        if (cronInstalled && alpha) {
          await guest('crontab -u ' + quote(alpha.identity.account) + ' -r');
          cronInstalled = false;
        }
      } catch (error) {
        proof.cleanupErrors.push(String(error));
      }
      try {
        if (alpha) await spaces.projects.with(vmId, alpha.id, () => managedSsh.stop(vmId));
      } catch (error) {
        proof.cleanupErrors.push(String(error));
      }
      try {
        await stopServer();
      } catch (error) {
        proof.cleanupErrors.push(String(error));
      }
    }
    try {
      await managedSsh.close();
      await spaces.close();
    } catch (error) {
      proof.cleanupErrors.push(String(error));
    }
    await writeFile(join(root, 'boot-final-' + invocation + '.log'), machines.logs.get(vmId) || '', {
      flag: 'wx',
    });
    try {
      if (vmId) {
        const done = machines.live.get(vmId)?.done;
        await machines.stop(vmId, true);
        if (done) await done;
        proof.vmStopped = machines.state(vmId) === 'stopped';
      }
      await machines.close();
    } catch (error) {
      proof.cleanupErrors.push(String(error));
    }
    proof.liveEntries = machines.live.size;
    proof.ownedChildren = children.size;
    if (vmId && process.platform === 'win32') {
      const query =
        "$ProgressPreference='SilentlyContinue';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;[Console]::Write(@(Get-CimInstance Win32_Process|Where-Object { $_.ExecutablePath -eq $r.image -and $_.CommandLine -and $_.CommandLine.Contains($r.disk) }).Count)";
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
    const changed: string[] = [];
    for (const [file, checksum] of Object.entries(proof.sourceSha256))
      if (hash(await readFile(join(workspace, file))) !== checksum) changed.push(file);
    for (const [file, checksum] of Object.entries(proof.binarySha256))
      if (hash(await readFile(file)) !== checksum) changed.push(file);
    const after = await lstat(image);
    proof.originalImageUnchanged =
      hash(await readFile(image)) === imageSha256 &&
      after.ino === imageInfo.ino &&
      after.size === imageInfo.size &&
      after.mtimeMs === imageInfo.mtimeMs;
    proof.changed = changed;
    proof.finishedAt = new Date().toISOString();
    proof.passed =
      proof.bodyPassed === true &&
      proof.cases.length === (diagnosticDirectory ? 1 : 9) &&
      !proof.cleanupErrors.length &&
      !changed.length &&
      proof.originalImageUnchanged &&
      proof.vmStopped &&
      proof.liveEntries === 0 &&
      proof.ownedChildren === 0 &&
      proof.exactQemuMatches === 0 &&
      clients.size === 0 && channels.size === 0 &&
      proof.machineConnectionDiagnostics.every((entry: any) => !entry.readyAt || !!entry.closedAt) &&
      proof.relayDiagnostics.length === (diagnosticDirectory ? 0 : 1) &&
      proof.relayDiagnostics.every((entry: any) => entry.closed === true && !entry.setupError) &&
      proof.sshClients.every((entry: any) => entry.closed === true) &&
      proof.sshChannels.every((entry: any) => entry.closed === true && entry.exit?.code === 0 && entry.exit.signal === null) &&
      proof.executions.every(
        (entry: any) => entry.exit && entry.close && entry.stdoutClosed && entry.stderrClosed,
      );
    const proofFile = join(root, 'project-egress-vm-' + invocation + '.json');
    await writeFile(proofFile, JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
    console.log(
      JSON.stringify({
        proofFile,
        passed: proof.passed,
        cases: proof.cases.map((entry: any) => entry.name),
        error: proof.error || null,
        cleanup: {
          vmStopped: proof.vmStopped,
          live: proof.liveEntries,
          children: proof.ownedChildren,
          exactQemu: proof.exactQemuMatches,
        },
      }),
    );
  }
  if (!proof.passed) process.exitCode = 1;
}
