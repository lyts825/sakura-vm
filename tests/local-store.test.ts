/**
 * 模块职责：回归验证模块，围绕 `local-store` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `local-store`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Windows replacement retries a real short file lock without exposing a missing or partial destination; Windows own sustained Node read handle preserves the old document and cleans only its own temporary file, then a closed handle per….
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeStore } from '../server/local-store.ts';

const originalRename = fs.rename, originalWriteFile = fs.writeFile;
const base = resolve('.data/local-store-test-temp');
const windows = process.platform === 'win32';

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `directory, file, old, value, next, cleanup`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `directory, file, old, value, next, cleanup`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `fs.mkdir`, `assert.equal`, `fs.realpath`, `(await fs.lstat(base)).isSymbolicLink`.
 * 检查边界 / Checked boundaries: `assert.equal(await fs.realpath(base), base)`; `assert.equal((await fs.lstat(base)).isSymbolicLink(), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  assert.equal(await fs.realpath(base), base);
  assert.equal((await fs.lstat(base)).isSymbolicLink(), false);
  const directory = await fs.mkdtemp(join(base, 'local-store-'));
  const file = join(directory, 'state.json');
  const old = JSON.stringify({ generation: 'old', body: 'old-owned-body'.repeat(2048) }, null, 2);
  const value = { generation: 'new', body: 'new-owned-body'.repeat(2048) };
  const next = JSON.stringify(value, null, 2);
  await originalWriteFile(file, old);
  return { directory, file, old, value, next, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `assert.equal`, `dirname`, `resolve`, `fs.realpath`.
   * 检查边界 / Checked boundaries: `assert.equal(dirname(resolve(directory)), base)`; `assert.equal(await fs.realpath(directory), directory)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  cleanup: async () => {
    assert.equal(dirname(resolve(directory)), base);
    assert.equal(await fs.realpath(directory), directory);
    assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    await fs.rm(directory, { recursive: true, force: true });
  } };
}

// Only this helper's own FileStream holds its own fixture file. The .NET call
// avoids PowerShell module autoload and excludes FileShare.Delete explicitly.
/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: file: string。
 * 结果：返回受控对象，公开字段包括 `release`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `release`; the actual branch determines its shape.
 * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `spawn`, `file.replaceAll`, `child.stdout.on`, `child.stderr.on`.
 */
async function holdWindowsFile(file: string) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference='Stop'
$stream=[System.IO.File]::Open('${file.replaceAll("'", "''")}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite)
try {
  [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush()
  [void][Console]::In.ReadLine()
} finally { $stream.Dispose() }
[Console]::Out.WriteLine('CLOSED')
`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '', locked = false;
  let readyResolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, readyReject!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error: Error) => void;
  const ready = new Promise<void>((yes, no) => { readyResolve = yes; readyReject = no; });
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString('utf8');
    if (output.length > 4096) readyReject(new Error('owned lock helper output limit'));
    if (!locked && /(?:^|\r?\n)LOCKED\r?\n/.test(output)) { locked = true; readyResolve(); }
  });
  child.stderr.on('data', (data: Buffer) => { errors = (errors + data.toString('utf8')).slice(0, 4096); });
  child.on('error', error => readyReject(error));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(yes => {
    child.on('close', (code, signal) => {
      if (!locked) readyReject(new Error(`owned lock helper exited before locking: ${code}: ${errors}`));
      yes({ code, signal });
    });
  });
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: promise: Promise<T>。
   * 结果：返回分支计算值（`await Promise.race([promise, new Promise<never>((_, no) => { timer = setTimeout(…`），以 Promise 交付。
   * Result: Return the branch-computed value (`await Promise.race([promise, new Promise<never>((_, no) => { timer = setTimeout(…`) through a Promise.
   * 协作入口 / Collaborators: `Promise.race`, `clearTimeout`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  async function bounded<T>(promise: Promise<T>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, no) => {
      timer = setTimeout(() => no(new Error('owned lock helper timeout')), 10_000);
    })]); } finally { if (timer) clearTimeout(timer); }
  }
  /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `child.stdin.end`, `bounded`, `assert.equal`, `assert.ok`.
   * 检查边界 / Checked boundaries: `assert.equal(result.code, 0, errors)`; `assert.equal(result.signal, null)`.
   */
  async function release() {
    if (child.exitCode === null && child.signalCode === null && !child.stdin.destroyed) child.stdin.end('RELEASE\n');
    try {
      const result = await bounded(exited);
      assert.equal(result.code, 0, errors);
      assert.equal(result.signal, null);
      assert.ok(output.includes('CLOSED'));
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await bounded(exited);
      throw error;
    }
  }
  try { await bounded(ready); }
  catch (error) { child.stdin.end(); child.kill(); await bounded(exited); throw error; }
  return { release };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows replacement retries a real short file lock without exposing a missing or partial destination
 * 状态影响 / State effects: `lock`, `reader`, `stopReader`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `holdWindowsFile`, `(async () => { while (!stopReader) { await readDestination(); await delay(2…`, `reader.catch`.
 * 检查边界 / Checked boundaries: `assert.equal(await readDestination(), f.next)`; `assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Windows replacement retries a real short file lock without exposing a missing or partial destination', { skip: !windows }, async t => {
  const f = await fixture();
  let lock: Awaited<ReturnType<typeof holdWindowsFile>> | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let stopReader = false;
  let reader: Promise<void> | undefined;
  try {
    lock = await holdWindowsFile(f.file);
    const counts = { old: 0, new: 0 };
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`bytes`），以 Promise 交付。
     * Result: Return the branch-computed value (`bytes`) through a Promise.
     * 验证场景 / Scenario: Windows replacement retries a real short file lock without exposing a missing or partial destination
     * 协作入口 / Collaborators: `fs.readFile`, `assert.ok`.
     * 检查边界 / Checked boundaries: `assert.ok(bytes === f.old || bytes === f.next, 'readers see a complete old or new document')`.
     */
    const readDestination = async () => {
      const bytes = await fs.readFile(f.file, 'utf8');
      assert.ok(bytes === f.old || bytes === f.next, 'readers see a complete old or new document');
      ++counts[bytes === f.old ? 'old' : 'new'];
      return bytes;
    };
    reader = (async () => {
      while (!stopReader) {
        await readDestination();
        await delay(2);
      }
    })();
    // Attach immediately so an unexpected read failure cannot be an unhandled rejection.
    void reader.catch(() => {});
    const released = new Promise<void>((yes, no) => {
      releaseTimer = setTimeout(() => { void (async () => {
        await lock!.release();
        // Windows replacement can also be denied by this test's own open
        // read handles. Confirm all of them closed before the commit window.
        stopReader = true;
        await reader;
      })().then(yes, no); }, 150);
    });
    void released.catch(() => {});
    const started = performance.now();
    await writeStore(f.file, f.value);
    await released;
    stopReader = true;
    await reader;
    assert.equal(await readDestination(), f.next);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
    assert.ok(counts.old > 1 && counts.new > 0);
    t.diagnostic(JSON.stringify({ nativeLock: true, shareDelete: false, elapsedMs: Math.round(performance.now() - started), reads: counts,
      oldSha256: createHash('sha256').update(f.old).digest('hex'), newSha256: createHash('sha256').update(f.next).digest('hex') }));
  } finally {
    stopReader = true;
    if (releaseTimer) clearTimeout(releaseTimer);
    await reader?.catch(() => {});
    await lock?.release();
    await f.cleanup();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows own sustained Node read handle preserves the old document and cleans only its own temporary file, then a closed handle permits saving
 * 状态影响 / State effects: `handle`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `originalWriteFile`, `fs.open`, `handle.stat`.
 * 检查边界 / Checked boundaries: `assert.rejects(writeStore(f.file, f.value), error => { failure = error as NodeJS.ErrnoException; assert.ok(['EPERM', 'EACCES', 'EB…`; `assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded retry elapsed ${elapsedMs}ms`)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Windows own sustained Node read handle preserves the old document and cleans only its own temporary file, then a closed handle permits saving', { skip: !windows }, async t => {
  const f = await fixture();
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  const unrelated = f.file + '.owned-other.tmp', sentinel = 'another owned temporary file';
  await originalWriteFile(unrelated, sentinel);
  try {
    handle = await fs.open(f.file, 'r');
    const identity = await handle.stat(), started = performance.now();
    let failure: NodeJS.ErrnoException | undefined;
    await assert.rejects(writeStore(f.file, f.value), error => {
      failure = error as NodeJS.ErrnoException;
      assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(failure.code || ''));
      assert.equal(failure.syscall, 'rename');
      assert.equal((failure as NodeJS.ErrnoException & { dest: string }).dest, f.file);
      assert.notEqual(failure.path, unrelated);
      return true;
    });
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded retry elapsed ${elapsedMs}ms`);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.equal(await fs.readFile(unrelated, 'utf8'), sentinel);
    assert.deepEqual((await fs.readdir(f.directory)).sort(), [basename(f.file), basename(unrelated)].sort());
    const after = await fs.stat(f.file);
    assert.equal(after.dev, identity.dev); assert.equal(after.ino, identity.ino);
    await handle.close(); handle = undefined;
    await writeStore(f.file, f.value);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.next);
    assert.equal(await fs.readFile(unrelated, 'utf8'), sentinel);
    assert.deepEqual((await fs.readdir(f.directory)).sort(), [basename(f.file), basename(unrelated)].sort());
    t.diagnostic(JSON.stringify({ ownNodeReadHandle: true, nativeLock: true, elapsedMs: Math.round(elapsedMs), code: failure!.code,
      retainedDevice: identity.dev, retainedInode: identity.ino, recoveryAfterClose: true }));
  } finally { await handle?.close(); await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows sustained native lock preserves the old document, returns the rename error, and cleans its only temporary file
 * 状态影响 / State effects: `lock`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `holdWindowsFile`, `performance.now`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(writeStore(f.file, f.value), error => { failure = error as NodeJS.ErrnoException; assert.ok(['EPERM', 'EACCES', 'EB…`; `assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded retry elapsed ${elapsedMs}ms`)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Windows sustained native lock preserves the old document, returns the rename error, and cleans its only temporary file', { skip: !windows }, async t => {
  const f = await fixture();
  let lock: Awaited<ReturnType<typeof holdWindowsFile>> | undefined;
  try {
    lock = await holdWindowsFile(f.file);
    const started = performance.now();
    let failure: NodeJS.ErrnoException | undefined;
    await assert.rejects(writeStore(f.file, f.value), error => {
      failure = error as NodeJS.ErrnoException;
      assert.ok(['EPERM', 'EACCES', 'EBUSY'].includes(failure.code || ''));
      assert.equal(failure.syscall, 'rename');
      assert.equal((failure as NodeJS.ErrnoException & { dest: string }).dest, f.file);
      assert.ok(failure.path?.startsWith(f.file + '.') && failure.path.endsWith('.tmp'));
      return true;
    });
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs >= 900 && elapsedMs < 5000, `bounded retry elapsed ${elapsedMs}ms`);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
    t.diagnostic(JSON.stringify({ nativeLock: true, shareDelete: false, elapsedMs: Math.round(elapsedMs), code: failure!.code,
      errno: failure!.errno, syscall: failure!.syscall, oldSha256: createHash('sha256').update(f.old).digest('hex') }));
  } finally { await lock?.release(); await f.cleanup(); }
});

for (const code of ['EPERM', 'EACCES', 'EBUSY']) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `t.mock.method`, `syncBuiltinESMExports`, `writeStore`.
 * 检查边界 / Checked boundaries: `assert.equal(writes, 1)`; `assert.equal(attempts, 3)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(`Windows ${code} retry uses one exclusive flushed write and the identical temporary inode and bytes`, { skip: !windows }, async t => {
  const f = await fixture();
  let writes = 0, attempts = 0;
  const identities: Array<{ path: string; device: number; inode: number; sha256: string }> = [];
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      ++writes;
      assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
      return originalWriteFile(...args);
    });
    t.mock.method(fs, 'rename', async (temp: string, destination: string) => {
      ++attempts;
      const info = await fs.lstat(temp), bytes = await fs.readFile(temp, 'utf8');
      assert.equal(bytes, f.next);
      assert.equal(await fs.readFile(destination, 'utf8'), f.old);
      identities.push({ path: temp, device: info.dev, inode: info.ino, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (attempts < 3) throw Object.assign(new Error('owned transient rename error'), { code });
      return originalRename(temp, destination);
    });
    syncBuiltinESMExports();
    await writeStore(f.file, f.value);
    assert.equal(writes, 1); assert.equal(attempts, 3);
    for (const identity of identities) assert.deepEqual(identity, identities[0]);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.next);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: non-retry rename errors are returned unchanged after one attempt and preserve the destination
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `t.mock.method`, `syncBuiltinESMExports`.
 * 检查边界 / Checked boundaries: `assert.rejects(writeStore(f.file, f.value), error => error === failure)`; `assert.equal(attempts, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('non-retry rename errors are returned unchanged after one attempt and preserve the destination', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned non-retry error'), { code: 'EIO' });
  let attempts = 0;
  try {
    t.mock.method(fs, 'rename', async () => { ++attempts; throw failure; }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, f.value), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the non-Windows platform gate returns EPERM unchanged without retry
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `Object.getOwnPropertyDescriptor`, `Object.defineProperty`.
 * 检查边界 / Checked boundaries: `assert.rejects(writeStore(f.file, f.value), error => error === failure)`; `assert.equal(attempts, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the non-Windows platform gate returns EPERM unchanged without retry', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned platform gate error'), { code: 'EPERM' });
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let attempts = 0;
  try {
    Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
    t.mock.method(fs, 'rename', async () => { ++attempts; throw failure; }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, f.value), error => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally {
    Object.defineProperty(process, 'platform', platform);
    t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: serialization failure never writes or renames and leaves the original store intact
 * 协作入口 / Collaborators: `fixture`, `t.mock.method`, `syncBuiltinESMExports`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(writeStore(f.file, { invalid: 1n }), TypeError)`; `assert.equal(writes, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('serialization failure never writes or renames and leaves the original store intact', async t => {
  const f = await fixture();
  let writes = 0, attempts = 0;
  try {
    t.mock.method(fs, 'writeFile', async () => { ++writes; throw new Error('must not write'); });
    t.mock.method(fs, 'rename', async () => { ++attempts; throw new Error('must not rename'); }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, { invalid: 1n }), TypeError);
    assert.equal(writes, 0); assert.equal(attempts, 0);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: flush failure never publishes its written temporary bytes and preserves the original error
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `t.mock.method`, `syncBuiltinESMExports`.
 * 检查边界 / Checked boundaries: `assert.rejects(writeStore(f.file, f.value), error => error === failure)`; `assert.equal(attempts, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('flush failure never publishes its written temporary bytes and preserves the original error', async t => {
  const f = await fixture(), failure = Object.assign(new Error('owned flush failure'), { code: 'EIO' });
  let attempts = 0;
  try {
    t.mock.method(fs, 'writeFile', async (...args: Parameters<typeof fs.writeFile>) => {
      assert.deepEqual(args[2], { mode: 0o600, flag: 'wx', flush: true });
      await originalWriteFile(...args);
      throw failure;
    });
    t.mock.method(fs, 'rename', async () => { ++attempts; throw new Error('must not rename after flush failure'); }); syncBuiltinESMExports();
    await assert.rejects(writeStore(f.file, f.value), error => error === failure);
    assert.equal(attempts, 0);
    assert.equal(await fs.readFile(f.file, 'utf8'), f.old);
    assert.deepEqual(await fs.readdir(f.directory), [basename(f.file)]);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); await f.cleanup(); }
});
