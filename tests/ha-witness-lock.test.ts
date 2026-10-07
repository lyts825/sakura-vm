/**
 * 模块职责：回归验证模块，围绕 `ha-witness-lock` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `ha-witness-lock`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: the kernel excludes another process even when the live owner record is removed; an abrupt process death releases the kernel lock and permits serialized stale-owner recovery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockHaWitnessState } from '../server/ha-witness-lock.ts';

const lockModule = new URL('../server/ha-witness-lock.ts', import.meta.url).href;

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `root, file, cleanup`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, file, cleanup`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `writeFile`.
 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-ha-witness-lock-'));
  const file = join(root, 'state.json');
  await writeFile(file, '{}');
  return { root, file, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `new Error('unsafe lock cleanup')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `realpath`, `basename(path).startsWith`, `basename`, `resolve`.
   */
  cleanup: async () => {
    const path = await realpath(root);
    if (!basename(path).startsWith('sakura-ha-witness-lock-') ||
        resolve(path) === resolve(tmpdir())) throw new Error('unsafe lock cleanup');
    await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } };
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: file: string。
 * 结果：返回受控对象，公开字段包括 `child, ready, exited, output`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `child, ready, exited, output`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `JSON.stringify`, `process.execArgv.includes`, `spawn`, `fileURLToPath`.
 */
function ownerProcess(file: string) {
  const script = `import { lockHaWitnessState } from ${JSON.stringify(lockModule)};
    try {
      const release = await lockHaWitnessState(${JSON.stringify(file)});
      console.log('LOCKED');
      process.stdin.resume();
      process.stdin.once('data', async () => { await release(); process.exit(0); });
    } catch (error) { console.error(error.code || error.message); process.exit(2); }`;
  const loader = process.execArgv.includes('--experimental-transform-types')
    ? ['--experimental-transform-types'] : ['--import', 'tsx'];
  const child = spawn(process.execPath, [...loader, '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
  const exited = new Promise<number | null>((done, fail) => {
    child.once('error', fail); child.once('exit', done);
  });
  const ready = new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`lock owner failed to start: ${output}`)), 10_000);
    child.stdout.on('data', () => { if (output.split(/\r?\n/).includes('LOCKED')) { clearTimeout(timer); done(); } });
    void exited.then(() => {
      clearTimeout(timer);
      if (!output.split(/\r?\n/).includes('LOCKED')) fail(new Error(output));
    }, fail);
  });
  return { child, ready, exited, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`output`）。
   * Result: Return the branch-computed value (`output`).
   */
  output: () => output };
}

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: child: ChildProcess | undefined。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `child.kill`.
 */
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGKILL');
  await exited;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the kernel excludes another process even when the live owner record is removed
 * 协作入口 / Collaborators: `fixture`, `ownerProcess`, `assert.rejects`, `lockHaWitnessState`.
 * 检查边界 / Checked boundaries: `assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' })`; `assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the kernel excludes another process even when the live owner record is removed', async () => {
  const f = await fixture();
  const owner = ownerProcess(f.file);
  try {
    await owner.ready;
    await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
    await unlink(`${f.file}.lock`);
    await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
  } finally { await stop(owner.child); await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an abrupt process death releases the kernel lock and permits serialized stale-owner recovery
 * 状态影响 / State effects: `release`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `ownerProcess`, `JSON.parse`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.equal(previous.pid, owner.child.pid)`; `assert.equal(current.pid, process.pid)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an abrupt process death releases the kernel lock and permits serialized stale-owner recovery', async () => {
  const f = await fixture();
  const owner = ownerProcess(f.file);
  let release: Awaited<ReturnType<typeof lockHaWitnessState>> | undefined;
  try {
    await owner.ready;
    const previous = JSON.parse(await readFile(`${f.file}.lock`, 'utf8'));
    assert.equal(previous.pid, owner.child.pid);
    await stop(owner.child);
    release = await lockHaWitnessState(f.file);
    const current = JSON.parse(await readFile(`${f.file}.lock`, 'utf8'));
    assert.equal(current.pid, process.pid);
    assert.notEqual(current.token, previous.token);
    await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
    await release(); release = undefined;
    release = await lockHaWitnessState(f.file);
  } finally { await release?.(); await stop(owner.child); await f.cleanup(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a remote or malformed owner record never becomes an automatic empty-state authorization
 * 协作入口 / Collaborators: `fixture`, `JSON.stringify`, `writeFile`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' })`; `assert.equal(await readFile(`${f.file}.lock`, 'utf8'), owner)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a remote or malformed owner record never becomes an automatic empty-state authorization', async () => {
  const f = await fixture();
  try {
    for (const owner of [JSON.stringify({ version: 1, host: 'unrecognized-remote-node',
      pid: 999999, token: 'old' }), '{broken']) {
      await writeFile(`${f.file}.lock`, owner);
      await assert.rejects(lockHaWitnessState(f.file), { code: 'HA_WITNESS_STATE_LOCKED' });
      assert.equal(await readFile(`${f.file}.lock`, 'utf8'), owner);
    }
  } finally { await f.cleanup(); }
});
