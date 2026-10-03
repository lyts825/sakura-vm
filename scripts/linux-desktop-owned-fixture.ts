import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, win32 } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import type { Client } from 'ssh2';
import type { Engine } from '../server/runtime.ts';

export const desktopFixtureParent = 'E:\\Sakura-verification-6fb9a7f4-3e97-42fa-a3f8-2db21f22ca9c';
export const desktopFixtureSource = {
  relativeRoot: '.data/linux-clipboard-test-temp/sakura-x11-zXRIm0',
  vmId: '53cc186f-aaf4-4d77-85ef-b1b42031be50',
  catalogSha256: 'da5ee5ef35ee5737abb9897131f8d22d4206044fee05c45f30f83948d94ed971',
  proofSha256: 'ca303af77c4b1cb896ee6f67bb80b951ee66e6a552dab08bd926404f58d68ef2',
} as const;
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export type OwnedDesktopSshState = { ready: boolean; closed: boolean; notCreated?: boolean; closeForced?: boolean };

/** SSH2 never emits close for a client whose connect did not create a socket. */
export async function closeOwnedDesktopSshClient(client: Client, state: OwnedDesktopSshState,
  physicalClose: Promise<void>, timeoutMs = 10000) {
  if (!Reflect.get(client, '_sock') && !state.ready && !state.closed) {
    state.notCreated = true;
    return 'not-created' as const;
  }
  async function waitClosed() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([physicalClose, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned SSH client physical close timeout')), timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  if (!state.closed) {
    client.end();
    try { await waitClosed(); }
    catch { state.closeForced = true; client.destroy(); await waitClosed(); }
  }
  assert.equal(state.closed, true, 'Owned SSH client close was not observed');
  return 'closed' as const;
}

export function ownedDesktopQemuArguments(argv: string[], vmId: string) {
  assert.match(vmId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(!argv.includes('-uuid'));
  // Machines has no VM UUID argv. The direct test Engine adds only this
  // fixture hardware identifier so bootstrap can verify DMI before mutation.
  return [...argv, '-uuid', vmId];
}

/** Exact receipt roles. A prefix check would accept root\\..\\oldFixture\\log. */
export function desktopFixtureLogPath(root: string, id: string, stream: 'stdout' | 'stderr') {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(stream === 'stdout' || stream === 'stderr');
  assert.equal(win32.resolve(root), root);
  const file = win32.join(root, 'logs', id + '.' + stream + '.bin');
  assert.equal(win32.relative(root, file), 'logs\\' + id + '.' + stream + '.bin');
  return file;
}

export async function captureDesktopSources(workspace: string, initial: string[]) {
  const captured: Record<string, string> = {};
  async function capture(file: string) {
    const absolute = resolve(workspace, file), local = relative(workspace, absolute).replaceAll('\\', '/');
    assert.ok(!local.startsWith('../') && !local.startsWith('.data/'));
    if (Object.hasOwn(captured, local)) return;
    assert.equal(await realpath(absolute), absolute);
    const bytes = await readFile(absolute);
    captured[local] = sha256(bytes);
    if (!/\.[cm]?[jt]sx?$/.test(local)) return;
    const source = ts.createSourceFile(local, bytes.toString(), ts.ScriptTarget.Latest, true);
    const dependencies: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier))
        dependencies.push(node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        dependencies.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]))
        dependencies.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const dependency of dependencies)
      if (dependency.startsWith('.')) await capture(relative(workspace, resolve(dirname(absolute), dependency)));
  }
  for (const file of initial) await capture(file);
  return captured;
}

type ProcessResult = { stdout: Buffer; stderr: Buffer; entry: any; error?: Error };
type OwnedProcess = { child: ChildProcess; entry: any; done: Promise<ProcessResult> };

/** Test-only direct Engine. All task, admission, UID and Desktop code remains production code. */
export class LinuxDesktopOwnedFixture {
  readonly invocation = randomUUID();
  readonly vmId = randomUUID();
  readonly root = join(desktopFixtureParent, 'linux-desktop-identity-cow-' + this.invocation);
  readonly processes: any[] = [];
  readonly sourceRoot: string;
  readonly sourceDisk: string;
  readonly sourceBase: string;
  readonly qemu: string;
  readonly img: string;
  readonly powershell = join(process.env.WINDIR!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  readonly children = new Map<ChildProcess, Promise<ProcessResult>>();
  readonly completed = new Map<string, ProcessResult>();
  guard?: OwnedProcess;
  rootExists = false;
  guardReleased = false;
  before: any;
  after: any;
  qemuOwner: any;
  qemuRunning = false;
  private guardReplies: any[] = [];
  private waiting?: (reply: any) => void;

  constructor(readonly workspace: string) {
    this.sourceRoot = join(workspace, desktopFixtureSource.relativeRoot);
    this.sourceDisk = join(this.sourceRoot, 'machines', desktopFixtureSource.vmId, 'disk.qcow2');
    this.sourceBase = join(workspace, '.data/images/debian-12.qcow2');
    this.qemu = join(workspace, '.tools/qemu/qemu-system-x86_64.exe');
    this.img = join(workspace, '.tools/qemu/qemu-img.exe');
  }

  private async log(result: ProcessResult) {
    if (!this.rootExists || result.entry.logged) return;
    for (const stream of ['stdout', 'stderr'] as const) {
      const path = desktopFixtureLogPath(this.root, result.entry.id, stream);
      assert.equal(await realpath(dirname(path)), dirname(path));
      await writeFile(path, result[stream], { flag: 'wx' });
      assert.equal(sha256(await readFile(path)), sha256(result[stream]));
      result.entry[stream + 'Path'] = path;
    }
    result.entry.logged = true;
  }

  raw(image: string, argv: string[], role: string, input?: Buffer | string, timeout = 30000,
    output?: (bytes: Buffer) => void): OwnedProcess {
    const entry: any = { id: randomUUID(), role, image, argv, startedAt: new Date().toISOString(), exit: null, close: null };
    this.processes.push(entry);
    const child = spawn(image, argv, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin!.on('error', (error) => { entry.stdinError = error.message; });
    entry.pid = child.pid;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, failure: Error | undefined;
    for (const [stream, target] of [[child.stdout!, stdout], [child.stderr!, stderr]] as const)
      stream.on('data', (buffer: Buffer) => {
        bytes += buffer.length;
        if (bytes > 8 * 1048576) { entry.outputExceeded = true; child.kill(); }
        else { target.push(Buffer.from(buffer)); output?.(buffer); }
      });
    child.once('error', (error) => { failure = error; entry.spawnError = error.message; });
    child.once('exit', (code, signal) => { entry.exit = { code, signal }; });
    const closed = new Promise<void>((done) => child.once('close', (code, signal) => {
      entry.close = { code, signal }; entry.closedAt = new Date().toISOString();
      entry.stdinClosed = child.stdin!.closed; entry.stdoutClosed = child.stdout!.closed; entry.stderrClosed = child.stderr!.closed;
      this.children.delete(child); done();
    }));
    const timer = timeout ? setTimeout(() => { entry.timeout = true; child.kill(); }, timeout) : undefined;
    const done = closed.then(async () => {
      if (timer) clearTimeout(timer);
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), entry, error: failure };
      for (const stream of ['stdout', 'stderr'] as const) {
        entry[stream + 'Sha256'] = sha256(result[stream]); entry[stream + 'Bytes'] = result[stream].length;
      }
      this.completed.set(entry.id, result); await this.log(result); return result;
    });
    this.children.set(child, done);
    if (input !== undefined) child.stdin!.end(input);
    return { child, entry, done };
  }

  async once(image: string, argv: string[], role: string, input: Buffer | string = '', timeout = 30000) {
    const result = await this.raw(image, argv, role, input, timeout).done;
    if (result.error) throw result.error;
    assert.equal(result.entry.outputExceeded, undefined);
    assert.equal(result.entry.timeout, undefined);
    assert.deepEqual(result.entry.exit, { code: 0, signal: null }, result.stderr.toString());
    assert.deepEqual(result.entry.close, result.entry.exit);
    assert.ok(result.entry.stdinClosed && result.entry.stdoutClosed && result.entry.stderrClosed);
    return result;
  }

  async ps(source: string, data: unknown, role: string) {
    return this.once(this.powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], role, JSON.stringify(data));
  }

  async census(role: string) {
    const result = await this.ps(`$ErrorActionPreference='Stop';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$rows=@(Get-CimInstance Win32_Process -Filter "Name='qemu-system-x86_64.exe' OR Name='qemu-img.exe'"|Where-Object{($_.ExecutablePath -ceq $r.qemu -or $_.ExecutablePath -ceq $r.img) -and $_.CommandLine -and ($_.CommandLine.Contains($r.owned) -or $_.CommandLine.Contains($r.source))}|Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine);[Console]::Write((ConvertTo-Json -InputObject $rows -Compress -Depth 3))`,
      { qemu: this.qemu, img: this.img, owned: this.root, source: this.sourceRoot }, role);
    return JSON.parse(result.stdout.toString());
  }

  private async guardReply(timeout = 120000): Promise<any> {
    if (this.guardReplies.length) return this.guardReplies.shift();
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { this.waiting = undefined; reject(new Error('Desktop source guard reply timeout')); }, timeout);
      this.waiting = (reply) => { clearTimeout(timer); this.waiting = undefined; done(reply); };
    });
  }

  async prepare() {
    assert.equal(process.platform, 'win32');
    assert.equal(await realpath(desktopFixtureParent), desktopFixtureParent);
    assert.equal(sha256(await readFile(join(this.sourceRoot, 'machines.json'))), desktopFixtureSource.catalogSha256);
    assert.equal(sha256(await readFile(join(this.sourceRoot, 'native-wayland-evidence.json'))), desktopFixtureSource.proofSha256);
    assert.deepEqual(await this.census('before-source-census'), []);
    const birth = JSON.parse((await this.ps(`$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$p=[Diagnostics.Process]::GetProcessById([int]$r.pid);[Console]::Write((@{image=$p.MainModule.FileName;creationTicks=$p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString()}|ConvertTo-Json -Compress))`, { pid: process.pid }, 'worker-birth')).stdout.toString());
    this.guard = this.raw(this.powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(this.workspace, 'scripts/linux-desktop-owned-fixture.ps1')], 'source-guard', undefined, 0);
    const reader = createInterface({ input: this.guard.child.stdout! });
    reader.on('line', (line) => {
      try { const reply = JSON.parse(line); if (this.waiting) this.waiting(reply); else this.guardReplies.push(reply); }
      catch { this.guardReplies.push({ event: 'INVALID_GUARD_REPLY' }); }
    });
    this.guard.child.stdin!.write(JSON.stringify({ invocation: this.invocation, newVmId: this.vmId, parentPid: process.pid, parentImage: birth.image, parentCreationTicks: birth.creationTicks }) + '\n');
    this.before = await this.guardReply();
    assert.equal(this.before.event, 'LOCKED'); assert.equal(this.before.root, this.root);
    this.rootExists = true;
    await mkdir(join(this.root, 'logs'));
    for (const result of this.completed.values()) await this.log(result);
    await mkdir(join(this.root, 'machines')); await mkdir(join(this.root, 'machines', this.vmId));
    await writeFile(join(this.root, 'fixture-marker.json'), JSON.stringify({ version: 1, kind: 'owned-linux-desktop-identity-cow', invocation: this.invocation, newVmId: this.vmId, root: this.root, rootPin: this.before.rootPin, sourceRoot: this.sourceRoot, sourceVmId: desktopFixtureSource.vmId, sourceProofSha256: desktopFixtureSource.proofSha256, imageProvisioning: 'COW of already installed historical Debian KDE; not a fresh image or reused authority' }, null, 2), { flag: 'wx' });
    const original = JSON.parse((await this.once(this.img, ['info', '--output=json', '--backing-chain', this.sourceDisk], 'source-chain')).stdout.toString());
    assert.equal(original.length, 2); assert.equal(original[0].filename, this.sourceDisk);
    assert.equal(original[0]['full-backing-filename'], this.sourceBase); assert.equal(original[1].filename, this.sourceBase);
    assert.ok(!original[1]['backing-filename']);
    for (const image of original) { assert.equal(image.format, 'qcow2'); assert.ok(!image.encrypted); }
    const disk = join(this.root, 'machines', this.vmId, 'disk.qcow2');
    const reservation = await open(disk, 'wx'); await reservation.close();
    await this.once(this.img, ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', this.sourceDisk, disk], 'overlay-create');
    const chain = JSON.parse((await this.once(this.img, ['info', '--output=json', '--backing-chain', disk], 'overlay-chain')).stdout.toString());
    assert.equal(chain.length, 3); assert.equal(chain[0].filename, disk); assert.equal(chain[0]['full-backing-filename'], this.sourceDisk);
    assert.deepEqual(chain.slice(1), original);
    return { original, chain };
  }

  engine(): Engine {
    const unsupported = () => { throw new Error('Unknown Desktop fixture Engine operation'); };
    return {
      version: 'test-only direct TCG Engine; no startup accelerator probe', whpxAvailable: false, qemuIoAvailable: false, aarch64Available: false,
      runtime: { close: async () => { for (const [child, done] of this.children) if (child !== this.guard?.child) { child.kill(); await done; } } },
      runStatus: unsupported, get service() { return unsupported(); },
      run: async (tool: string, argv: string[], options: Parameters<Engine['run']>[2] = {}) => {
        assert.equal(tool, 'sakura-qemu'); assert.equal(this.qemuRunning, false);
        const disk = join(this.root, 'machines', this.vmId, 'disk.qcow2');
        assert.ok(argv.includes('-no-reboot') && argv.includes('-display') && argv[argv.indexOf('-display') + 1] === 'none');
        assert.ok(argv[argv.indexOf('-accel') + 1].startsWith('tcg'));
        assert.equal(argv.filter((arg) => arg === '-drive').length, 2);
        assert.ok(argv[argv.indexOf('-drive') + 1].startsWith('file=' + disk.replaceAll(',', ',,') + ','));
        for (const flag of ['-snapshot', '-incoming', '-blockdev', '-object', '-readconfig', '-kernel', '-initrd']) assert.ok(!argv.includes(flag));
        this.qemuRunning = true;
        const owned = this.raw(this.qemu, ownedDesktopQemuArguments(argv, this.vmId), 'qemu', '', 1800000, options.output);
        owned.entry.productionArgv = argv;
        owned.entry.fixtureOnlyHardwareArguments = ['-uuid', this.vmId];
        this.qemuOwner = JSON.parse((await this.ps(`$ErrorActionPreference='Stop';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$r.pid);if($p.ExecutablePath -cne $r.image -or -not $p.CommandLine.Contains($r.disk)){throw 'DESKTOP_QEMU_TUPLE'};[Console]::Write(($p|Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine|ConvertTo-Json -Compress))`, { pid: owned.child.pid, image: this.qemu, disk }, 'qemu-birth')).stdout.toString());
        const abort = () => { owned.entry.abortRequested = true; owned.child.kill(); };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort();
        try {
          const result = await owned.done;
          if (result.error) throw result.error;
          if (options.signal?.aborted) return '';
          assert.equal(result.entry.timeout, undefined); assert.equal(result.entry.outputExceeded, undefined);
          assert.deepEqual(result.entry.close, { code: 0, signal: null }, result.stderr.toString());
          return result.stdout.toString();
        } finally { options.signal?.removeEventListener('abort', abort); this.qemuRunning = false; }
      },
    } as unknown as Engine;
  }

  async close() {
    for (const [child, done] of this.children) if (child !== this.guard?.child) { child.kill(); await done; }
    assert.deepEqual(await this.census('after-source-census'), []);
    if (!this.guard) return;
    if (!this.rootExists) { this.guard.child.stdin!.end(); await this.guard.done; return; }
    this.guard.child.stdin!.write('{"action":"release"}\n');
    try {
      this.after = await this.guardReply(); assert.equal(this.after.event, 'RELEASED');
      assert.deepEqual(this.after.snapshot, this.before.snapshot); this.guardReleased = true;
    } finally {
      this.guard.child.stdin!.end();
      const result = await this.guard.done;
      assert.deepEqual(result.entry.exit, { code: 0, signal: null }, result.stderr.toString());
      assert.deepEqual(result.entry.close, result.entry.exit);
      assert.ok(result.entry.stdinClosed && result.entry.stdoutClosed && result.entry.stderrClosed);
    }
    assert.equal(this.children.size, 0);
    await delay(20);
  }
}
