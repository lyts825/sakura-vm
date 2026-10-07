/**
 * 模块职责：回归验证模块，围绕 `sync-watch` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `sync-watch`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: recursive host events and guest events trigger scans, with periodic reconciliation and disposal; missing inotify falls back to scans and closing or replacing a watcher cancels SSH.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { SyncWatchers } from '../server/sync-watch.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
 * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
 * 输入 / Inputs: condition: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `condition`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < end, 'watch event deadline')`.
 */
async function until(condition: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  const end = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < end, 'watch event deadline');
    await delay(20);
  }
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: recursive host events and guest events trigger scans, with periodic reconciliation and disposal
 * 状态影响 / State effects: `guestEvent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(watches.view('project')?.host, 'watching')`; `assert.equal(watches.due('project', now + 1000), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('recursive host events and guest events trigger scans, with periodic reconciliation and disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-watch-'));
  let events = 0,
    guestEvent = false;
  const watches = new SyncWatchers(
    {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'running'`）。
       * Result: Return the branch-computed value (`'running'`).
       * 验证场景 / Scenario: recursive host events and guest events trigger scans, with periodic reconciliation and disposal
       */
      state: () => 'running',
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
       * 验证场景 / Scenario: recursive host events and guest events trigger scans, with periodic reconciliation and disposal
       * 状态影响 / State effects: `guestEvent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       */
      exec: async () => {
        const code = guestEvent ? 0 : 2;
        guestEvent = false;
        return { code, stdout: '', stderr: '' };
      },
    } as unknown as Machines,
    () => events++,
  );
  try {
    await mkdir(join(root, 'nested'));
    watches.ensure('project', 'vm', { host: root, guest: '/workspace', auto: true, watch: true });
    await until(() => watches.view('project')?.guest === 'watching');
    assert.equal(watches.view('project')?.host, 'watching');
    const now = Date.now();
    watches.started('project', now);
    assert.equal(watches.due('project', now + 1000), false);
    assert.equal(watches.due('project', now + 60000), true);
    await writeFile(join(root, 'nested', 'file.txt'), 'changed');
    await until(() => events > 0);
    assert.equal(watches.due('project', now + 1000), true);
    await delay(100);
    watches.started('project', Date.now());
    const before = events;
    guestEvent = true;
    await until(() => events > before);
    assert.equal(watches.due('project', Date.now()), true);
    watches.retain(() => false);
    assert.equal(watches.view('project'), null);
  } finally {
    await watches.close();
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: missing inotify falls back to scans and closing or replacing a watcher cancels SSH
 * 状态影响 / State effects: `mode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `watches.ensure`.
 * 检查边界 / Checked boundaries: `assert.equal(watches.due('project', Date.now()), true)`; `assert.equal(aborted, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('missing inotify falls back to scans and closing or replacing a watcher cancels SSH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-watch-fallback-'));
  let mode = 'missing',
    aborted = 0,
    started = 0;
  const watches = new SyncWatchers(
    {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'running'`）。
       * Result: Return the branch-computed value (`'running'`).
       * 验证场景 / Scenario: missing inotify falls back to scans and closing or replacing a watcher cancels SSH
       */
      state: () => 'running',
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _id: string; _command: string; _timeout: number; signal: AbortSignal。
       * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
       * 验证场景 / Scenario: missing inotify falls back to scans and closing or replacing a watcher cancels SSH
       */
      exec: async (_id: string, _command: string, _timeout: number, signal: AbortSignal) => {
        if (mode === 'missing') return { code: 127, stdout: '', stderr: '' };
        started++;
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted++;
              reject(signal.reason);
            },
            { once: true },
          ),
        );
      },
    } as unknown as Machines,
    () => {},
  );
  try {
    watches.ensure('project', 'vm', { host: root, guest: '/workspace', auto: true, watch: true });
    await until(() => !!watches.view('project')?.reason);
    watches.started('project', Date.now());
    assert.equal(watches.due('project', Date.now()), true);
    mode = 'wait';
    watches.ensure('project', 'vm', { host: root, guest: '/another', auto: true, watch: true });
    await until(() => started === 1);
    watches.ensure('project', 'vm', { host: root, guest: '/third', auto: true, watch: true });
    await until(() => started === 2);
    await watches.close();
    assert.equal(aborted, 2);
  } finally {
    await watches.close();
    await rm(root, { recursive: true, force: true });
  }
});
