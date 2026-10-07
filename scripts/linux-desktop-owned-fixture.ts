/** 建立可核实的 Linux 桌面写时复制夹具，固定原始源证据、QEMU 参数和 SSH 生命周期并保存本轮归属记录。
 * Create a verifiable Linux desktop copy-on-write fixture, pin original sources/QEMU arguments/SSH lifecycle and persist owned-run records. */
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
/** 对传入内容计算 SHA-256 十六进制摘要，供夹具完整性和前后状态比较；不修改输入。
 * Compute a hexadecimal SHA-256 digest of the input for fixture integrity/before-and-after comparison without mutating it. */
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export type OwnedDesktopSshState = { ready: boolean; closed: boolean; notCreated?: boolean; closeForced?: boolean };

/** 校验整数时钟并计算共同启动截止时间的剩余预算，单次最多十五秒；期限已过立即拒绝，避免每轮探测重置总等待时间。
 * Validate integer clocks and derive remaining time from one boot deadline, capped at fifteen seconds per attempt; reject expiry rather than reset the total wait on each probe. */
export function ownedDesktopBootstrapTimeout(deadline: number, now: number) {
  assert.ok(Number.isSafeInteger(deadline) && Number.isSafeInteger(now), 'Owned bootstrap deadline is invalid');
  const remaining = deadline - now;
  assert.ok(remaining > 0, 'Owned bootstrap readiness deadline expired');
  return Math.min(15000, remaining);
}

/** A pending cloud-init flag never relaxes the exact new guest identity. */
/** 在 1024 字节预算内严格验证启动回包字段、版本、DMI 与新实例 UUID；连续探测必须保持同一 bootId，返回规范化 DMI 和 cloud-init 状态。
 * Strictly validate bootstrap fields/version/DMI/new VM UUID within 1024 bytes; successive probes must retain one bootId, returning normalized DMI and cloud-init readiness. */
export function parseOwnedDesktopBootstrapReply(text: string, vmId: string, previousBootId?: string) {
  assert.ok(Buffer.byteLength(text) <= 1024, 'Owned bootstrap reply exceeded its fixed budget');
  const value: unknown = JSON.parse(text);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Owned bootstrap reply must be an object');
  assert.deepEqual(Object.keys(value).sort(), ['bootId', 'cloudInitReady', 'dmi', 'kind', 'version']);
  const reply = value as { version: number; kind: string; dmi: string; bootId: string; cloudInitReady: boolean };
  assert.equal(reply.version, 1); assert.equal(reply.kind, 'owned-desktop-bootstrap');
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
  assert.match(vmId, uuid); assert.equal(typeof reply.dmi, 'string'); assert.match(reply.dmi.toLowerCase(), uuid);
  assert.equal(reply.dmi.toLowerCase(), vmId, 'Owned bootstrap DMI does not match the new VM');
  assert.equal(typeof reply.bootId, 'string'); assert.match(reply.bootId, uuid);
  if (previousBootId !== undefined) assert.equal(reply.bootId, previousBootId, 'Owned bootstrap boot changed during readiness');
  assert.equal(typeof reply.cloudInitReady, 'boolean');
  return { ...reply, dmi: reply.dmi.toLowerCase() };
}

/** SSH2 never emits close for a client whose connect did not create a socket. */
/** 区分尚未创建的连接和已创建连接；先 end，期限内未物理关闭则 destroy 并再次等待，必须观察 close 才报告 closed。
 * Distinguish uncreated connections from created clients; end first, then destroy/reawait after timeout, reporting closed only after physical close is observed. */
export async function closeOwnedDesktopSshClient(client: Client, state: OwnedDesktopSshState,
  physicalClose: Promise<void>, timeoutMs = 10000) {
  if (!Reflect.get(client, '_sock') && !state.ready && !state.closed) {
    state.notCreated = true;
    return 'not-created' as const;
  }
  /** 对实际 close Promise 加入本次超时竞争，finally 清理计时器；不把主动调用 end 等同于关闭证据。
   * Race the physical close promise against this timeout and clear the timer in finally; invoking end is not itself closure evidence. */
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

/** 只对合法新实例 UUID 且尚无 -uuid 的参数增加硬件标识，保留生产 argv 顺序；重复或非法标识拒绝。
 * Append a hardware identity only for a valid new VM UUID and argv without -uuid, preserving production ordering; reject duplicate/invalid identifiers. */
export function ownedDesktopQemuArguments(argv: string[], vmId: string) {
  assert.match(vmId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(!argv.includes('-uuid'));
  // Machines has no VM UUID argv. The direct test Engine adds only this
  // fixture hardware identifier so bootstrap can verify DMI before mutation.
  return [...argv, '-uuid', vmId];
}

/** Exact receipt roles. A prefix check would accept root\\..\\oldFixture\\log. */
/** 用合法 UUID 与 stdout/stderr 构造自有 Windows 日志路径，并核实解析根目录与精确相对路径，阻断日志名逃逸。
 * Build an owned Windows log path from a valid UUID/stdout-or-stderr and verify normalized root/exact relative path to prevent log-name escape. */
export function desktopFixtureLogPath(root: string, id: string, stream: 'stdout' | 'stderr') {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(stream === 'stdout' || stream === 'stderr');
  assert.equal(win32.resolve(root), root);
  const file = win32.join(root, 'logs', id + '.' + stream + '.bin');
  assert.equal(win32.relative(root, file), 'logs\\' + id + '.' + stream + '.bin');
  return file;
}

/** 对指定入口及其本地运行时依赖建立哈希闭包；拒绝源码越界、.data 和物理链接，去重后返回冻结依据。
 * Build a hash closure for entry points/local runtime dependencies; reject escaping/.data/physical-link sources, deduplicate and return freeze evidence. */
export async function captureDesktopSources(workspace: string, initial: string[]) {
  const captured: Record<string, string> = {};
  /** 验证工作区内物理源码并保存 SHA-256；对 TS/JS 继续递归相对运行时依赖，已捕获文件不重复读取。
   * Validate physical workspace sources and retain SHA-256; recurse through relative runtime dependencies for TS/JS and skip previously captured files. */
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
    /** 从 AST 收集非纯类型 import/export 与字面 dynamic import，再遍历子节点；不把类型依赖或任意计算路径加入执行闭包。
     * Collect non-type import/export and literal dynamic imports from AST, then visit children; exclude type-only dependencies and computed paths from the execution closure. */
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
  /** 接收源目录保护进程的一次 JSON 回包，唤醒当前等待者；计时器和等待槽由 guardReply 管理。
   * Receive one JSON reply from the source guard and wake the current waiter; guardReply owns timer/wait-slot lifecycle. */
  private waiting?: (reply: any) => void;

  /** 从工作区固定相对布局派生冻结源磁盘、基础镜像及 QEMU 工具路径，不在构造阶段启动进程或改写资源。
   * Derive frozen source disk/base-image/QEMU paths from the fixed workspace layout without spawning processes or rewriting resources during construction. */
  constructor(readonly workspace: string) {
    this.sourceRoot = join(workspace, desktopFixtureSource.relativeRoot);
    this.sourceDisk = join(this.sourceRoot, 'machines', desktopFixtureSource.vmId, 'disk.qcow2');
    this.sourceBase = join(workspace, '.data/images/debian-12.qcow2');
    this.qemu = join(workspace, '.tools/qemu/qemu-system-x86_64.exe');
    this.img = join(workspace, '.tools/qemu/qemu-img.exe');
  }

  /** 仅在自有日志目录建立后，以 wx 写入一次原始流并回读核对哈希；目录物理路径异常或重复覆盖会失败。
   * Write raw streams once with wx after owned log setup and reread hashes; physical-directory mismatch or overwrite attempts fail. */
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

  /** 登记本次子进程及完整生命周期，收集最多 8 MiB 输出并保留原始 close/exit；超时或预算超限终止自有子进程，返回等待句柄供上层核验实际关闭。
   * Register owned child/lifecycle, collect at most eight MiB output and retain actual close/exit; terminate that child on timeout/budget overflow and return wait handles for physical-close verification. */
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

  /** 等待 raw 进程实际关闭，拒绝启动错误、超时、输出超限或非零退出，并验证三个管道都已关闭后返回结果。
   * Await raw physical closure, reject spawn/timeout/output-budget/nonzero failures and verify all three pipes closed before returning results. */
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

  /** 将固定 PowerShell 源码 UTF-16LE 编码，数据单独走 JSON stdin；交给一次进程核验，避免把输入拼成命令源码。
   * Encode fixed PowerShell as UTF-16LE while sending data separately as JSON stdin; use one-shot lifecycle checks instead of interpolating input into command source. */
  async ps(source: string, data: unknown, role: string) {
    return this.once(this.powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], role, JSON.stringify(data));
  }

  /** 只枚举匹配已知工具物理路径且引用源/自有目录的 QEMU 进程，返回出生信息与参数供残留核查。
   * Enumerate only QEMU processes matching known physical tool paths and source/owned directories, returning birth/argv evidence for residue checks. */
  async census(role: string) {
    const result = await this.ps(`$ErrorActionPreference='Stop';$r=[Console]::In.ReadToEnd()|ConvertFrom-Json;$rows=@(Get-CimInstance Win32_Process -Filter "Name='qemu-system-x86_64.exe' OR Name='qemu-img.exe'"|Where-Object{($_.ExecutablePath -ceq $r.qemu -or $_.ExecutablePath -ceq $r.img) -and $_.CommandLine -and ($_.CommandLine.Contains($r.owned) -or $_.CommandLine.Contains($r.source))}|Select-Object ProcessId,CreationDate,ExecutablePath,CommandLine);[Console]::Write((ConvertTo-Json -InputObject $rows -Compress -Depth 3))`,
      { qemu: this.qemu, img: this.img, owned: this.root, source: this.sourceRoot }, role);
    return JSON.parse(result.stdout.toString());
  }

  /** 优先消费已排队回包，否则建立一个有限期等待槽；响应或超时清空槽，避免源保护协议无限挂起。
   * Consume queued guard replies first or install one bounded waiter; response/timeout clears the slot so source-protection protocol cannot hang indefinitely. */
  private async guardReply(timeout = 120000): Promise<any> {
    if (this.guardReplies.length) return this.guardReplies.shift();
    return new Promise((done, reject) => {
      const timer = setTimeout(() => { this.waiting = undefined; reject(new Error('Desktop source guard reply timeout')); }, timeout);
      this.waiting = /** 保护进程的匹配 JSON 回包到达后取消截止计时器、清空唯一等待槽并兑现结果，防止下一条命令误收旧回包。
 * On the guard’s matching JSON reply, cancel the deadline, clear the single waiting slot and resolve the result so the next command cannot consume an old reply. */ (reply) => { clearTimeout(timer); this.waiting = undefined; done(reply); };
    });
  }

  /** 校验冻结源摘要和零进程基线，按父进程出生元组启动源保护器；保护器持锁后才复制自有实例，并记录源码闭包与资源证据。
   * Verify frozen source hashes/zero-process baseline and start its guard using the parent birth tuple; copy an owned VM only after the guard locks, retaining source/resource evidence. */
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

  /** 提供只准一次精确 TCG 桌面启动的 Engine 适配器，验证驱动器、禁止额外启动入口；未知能力拒绝，所有子进程绑定本夹具清理。
   * Provide an Engine adapter permitting one exact TCG desktop boot, validating drives/forbidden launch inputs; reject unknown capabilities and bind children to fixture cleanup. */
  engine(): Engine {
    /** 显式拒绝夹具没有授权的运行时能力，使意外走入其他主机操作立即失败，不能静默用替身绕过生产路径。
     * Explicitly reject runtime capabilities not authorized by this fixture so accidental host operations fail immediately instead of silently bypassing production paths with a substitute. */
    const unsupported = () => { throw new Error('Unknown Desktop fixture Engine operation'); };
    return {
      version: 'test-only direct TCG Engine; no startup accelerator probe', whpxAvailable: false, qemuIoAvailable: false, aarch64Available: false,
      runtime: { /** 终止并等待夹具登记的非保护器子进程；外层关闭还验证零残留、请求保护器释放并核对源快照不变，最后等待保护器管道与实际进程关闭。
 * Terminate/await registered nonguard children; outer fixture teardown additionally verifies zero residue, requests guard release/checks unchanged source snapshots and awaits guard process/pipes. */ close: async () => { for (const [child, done] of this.children) if (child !== this.guard?.child) { child.kill(); await done; } } },
      runStatus: unsupported, /** 拒绝夹具未授权的通用 service 访问，防止验收适配器成为任意运行时入口。
 * Reject generic service access not authorized by this fixture so the adapter cannot become an arbitrary runtime entry. */ get service() { return unsupported(); },
      /** 验证指定 QEMU 工具、自有磁盘、TCG 与禁用参数后启动；登记 PID/出生时间/命令元组，将取消绑定自有子进程并在完成后移除监听。
       * Validate QEMU tool/owned disk/TCG/forbidden flags before launch; record PID/birth/argv, bind cancellation to the owned child and remove listeners after completion. */
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
        /** 记录对本次自有 QEMU 的取消请求并终止该 child 句柄，不扫描或杀死其他主机进程。
         * Record cancellation for this owned QEMU and terminate its child handle without scanning/killing other host processes. */
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

  /** 终止并等待夹具登记的非保护器子进程；外层关闭还验证零残留、请求保护器释放并核对源快照不变，最后等待保护器管道与实际进程关闭。
   * Terminate/await registered nonguard children; outer fixture teardown additionally verifies zero residue, requests guard release/checks unchanged source snapshots and awaits guard process/pipes. */
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
