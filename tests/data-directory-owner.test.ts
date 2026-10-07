/**
 * 模块职责：回归验证模块，围绕 `data-directory-owner` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `data-directory-owner`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: directory aliases share one host reservation and graceful close permits a new owner; a second process cannot acquire the directory and an abrupt owner exit releases it.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, realpath, rename, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { DataDirectoryOwner } from '../server/data-directory-owner.ts';
import { hostRuntime } from '../server/host-runtime/index.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: directory aliases share one host reservation and graceful close permits a new owner
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(owner.directory, await realpath(directory))`; `assert.rejects(DataDirectoryOwner.acquire(join(directory, '..', 'data')), { code: 'DATA_DIRECTORY_IN_USE' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('directory aliases share one host reservation and graceful close permits a new owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-directory-owner-'));
  const directory = join(root, 'data');
  await mkdir(directory);
  const owner = await DataDirectoryOwner.acquire(directory);
  try {
    assert.equal(owner.directory, await realpath(directory));
    await assert.rejects(DataDirectoryOwner.acquire(join(directory, '..', 'data')), { code: 'DATA_DIRECTORY_IN_USE' });
    if (process.platform === 'win32')
      await assert.rejects(DataDirectoryOwner.acquire(directory.toUpperCase()), { code: 'DATA_DIRECTORY_IN_USE' });
    const alias = join(root, 'alias');
    await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(DataDirectoryOwner.acquire(alias), { code: 'DATA_DIRECTORY_IN_USE' });
    assert.equal(hostRuntime.snapshot().resources.filter(item => item.kind === 'metadata.owner').length, 1);
    await owner.close(); await owner.close();
    const replacement = await DataDirectoryOwner.acquire(alias);
    await replacement.close();
    assert.equal(hostRuntime.snapshot().resources.filter(item => item.kind === 'metadata.owner').length, 0);
  } finally { await owner.close(); await rm(root, { recursive: true, force: true }); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a second process cannot acquire the directory and an abrupt owner exit releases it
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `start`.
 * 检查边界 / Checked boundaries: `assert.deepEqual((await first.ready)[0], { ready: true })`; `assert.deepEqual((await second.ready)[0], { error: 'DATA_DIRECTORY_IN_USE' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a second process cannot acquire the directory and an abrupt owner exit releases it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-directory-process-'));
  const children: ReturnType<typeof fork>[] = [];
  const stopped = new Map<ReturnType<typeof fork>, Promise<unknown>>();
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回受控对象，公开字段包括 `child, ready`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `child, ready`; the actual branch determines its shape.
   * 验证场景 / Scenario: a second process cannot acquire the directory and an abrupt owner exit releases it
   * 协作入口 / Collaborators: `fork`, `resolve`, `children.push`, `stopped.set`.
   */
  const start = () => {
    const child = fork(resolve('tests/fixtures/data-directory-owner-child.ts'), [root], {
      execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.push(child); stopped.set(child, once(child, 'close'));
    return { child, ready: once(child, 'message', { signal: AbortSignal.timeout(10000) }) };
  };
  try {
    const first = start();
    assert.deepEqual((await first.ready)[0], { ready: true });
    const second = start();
    assert.deepEqual((await second.ready)[0], { error: 'DATA_DIRECTORY_IN_USE' });
    await stopped.get(second.child);
    // This bypasses JS finally/close, proving that the guard belongs to the OS.
    first.child.kill('SIGKILL'); await stopped.get(first.child);
    const next = await DataDirectoryOwner.acquire(root);
    await next.close();
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all([...stopped.values()]);
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a future migration destination stays exclusively reserved across atomic directory publication
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `DataDirectoryOwner.acquire`.
 * 检查边界 / Checked boundaries: `assert.rejects(stat(target), { code: 'ENOENT' })`; `assert.rejects(DataDirectoryOwner.acquire(target, { create: false }), { code: 'DATA_DIRECTORY_IN_USE' })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a future migration destination stays exclusively reserved across atomic directory publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-directory-target-'));
  const target = join(root, 'target'), stage = join(root, 'stage');
  const owner = await DataDirectoryOwner.acquire(target, { create: false });
  try {
    await assert.rejects(stat(target), { code: 'ENOENT' });
    await assert.rejects(DataDirectoryOwner.acquire(target, { create: false }), { code: 'DATA_DIRECTORY_IN_USE' });
    await mkdir(stage); await rename(stage, target);
    await assert.rejects(DataDirectoryOwner.acquire(target), { code: 'DATA_DIRECTORY_IN_USE' });
    await owner.close();
    const next = await DataDirectoryOwner.acquire(target); await next.close();
  } finally { await owner.close(); await rm(root, { recursive: true, force: true }); }
});
