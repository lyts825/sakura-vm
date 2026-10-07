/**
 * 模块职责：回归验证模块，围绕 `process-interop` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `process-interop`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Windows process interop permits only registered, unchanged EXEs from an installed guest; queued guest host launches recheck their specific grant, program and VM generation.
 */
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Windows process interop permits only registered, unchanged EXEs from an installed guest
 * 状态影响 / State effects: `process.env.SAKURA_DATA_DIR`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `import`.
 * 检查边界 / Checked boundaries: `assert.equal(checked.executed, false)`; `assert.ok('programs' in empty)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Windows process interop permits only registered, unchanged EXEs from an installed guest',
  { skip: process.platform !== 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sakura-process-interop-'));
    const previous = process.env.SAKURA_DATA_DIR;
    process.env.SAKURA_DATA_DIR = directory;
    try {
      const { ProcessInterop } = await import('../server/process-interop.ts');
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const executable = join(directory, 'node.exe');
      await copyFile(process.execPath, executable);
      const files = new Map<string, string>();
      const machines = {
        live: new Map([[id, { abort: new AbortController() }]]),
        /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: value: string。
         * 结果：返回受控对象，公开字段包括 `id`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `id`; the actual branch determines its shape.
         * 验证场景 / Scenario: Windows process interop permits only registered, unchanged EXEs from an installed guest
         * 协作入口 / Collaborators: `assert.equal`.
         * 检查边界 / Checked boundaries: `assert.equal(value, id)`.
         */
        get: (value: string) => { assert.equal(value, id); return { id }; },
        /**
         * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
         * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
         * 输入 / Inputs: value: string。
         * 结果：返回分支计算值（`assert.equal(value, id)`）。
         * Result: Return the branch-computed value (`assert.equal(value, id)`).
         * 验证场景 / Scenario: Windows process interop permits only registered, unchanged EXEs from an installed guest
         * 协作入口 / Collaborators: `assert.equal`.
         * 检查边界 / Checked boundaries: `assert.equal(value, id)`.
         */
        requireUnlocked: (value: string) => assert.equal(value, id),
        /**
         * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
         * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
         * 输入 / Inputs: value: string。
         * 结果：返回分支计算值（`'running'`）。
         * Result: Return the branch-computed value (`'running'`).
         * 验证场景 / Scenario: Windows process interop permits only registered, unchanged EXEs from an installed guest
         * 协作入口 / Collaborators: `assert.equal`.
         * 检查边界 / Checked boundaries: `assert.equal(value, id)`.
         */
        state: (value: string) => { assert.equal(value, id); return 'running'; },
        /**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: _id: string; _command: string。
         * 结果：返回分支计算值（`({ code: 0, stdout: '', stderr: '' })`），以 Promise 交付。
         * Result: Return the branch-computed value (`({ code: 0, stdout: '', stderr: '' })`) through a Promise.
         * 验证场景 / Scenario: Windows process interop permits only registered, unchanged EXEs from an installed guest
         */
        exec: async (_id: string, _command: string) => ({ code: 0, stdout: '', stderr: '' }),
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: _id: string; path: string; content: string。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: Windows process interop permits only registered, unchanged EXEs from an installed guest
         * 协作入口 / Collaborators: `files.set`.
         */
        writeGuestFile: async (_id: string, path: string, content: string) => {
          files.set(path, content);
        },
      } as unknown as Machines;
      const interop = new ProcessInterop(machines, 7337);
      const allow = { mode: 'allow', programId: 'node', executable,
        fixedArgs: ['-e', 'process.stdout.write("interop-ok")'] };
      const checked = await interop.action(id, allow, 'check');
      assert.equal(checked.executed, false);
      const empty = await interop.action(id, { mode: 'status' }, 'check');
      assert.ok('programs' in empty);
      assert.deepEqual(empty.programs, []);
      await interop.action(id, allow, 'run');
      const status = await interop.action(id, { mode: 'status' }, 'check');
      assert.ok('programs' in status);
      assert.equal(status.programs.length, 1);
      await interop.action(id, { mode: 'install' }, 'run');
      const config = files.get('/etc/sakura/interop.curl') || '';
      const token = /X-Sakura-Guest-Token: ([a-f0-9]{64})/.exec(config)?.[1];
      assert.ok(token);
      assert.equal(config.includes('interop-ok'), false);
      assert.equal(files.get('/usr/local/bin/sakura-win')?.includes(token), false);
      await assert.rejects(interop.guest({ vmId: id, programId: 'node' }, 'wrong'), /未授权/);
      await assert.rejects(interop.guest({ vmId: id, programId: 'other' }, token), /未获准/);
      const result = await interop.guest({ vmId: id, programId: 'node' }, token);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, 'interop-ok');
      const reloaded = new ProcessInterop(machines, 7337);
      assert.equal((await reloaded.guest({ vmId: id, programId: 'node' }, token)).exitCode, 0);
      await appendFile(executable, 'changed');
      await assert.rejects(reloaded.guest({ vmId: id, programId: 'node' }, token), /已改变/);
      await interop.action(id, { mode: 'disable' }, 'run');
      await assert.rejects(interop.guest({ vmId: id, programId: 'node' }, token), /未授权/);
    } finally {
      if (previous === undefined) delete process.env.SAKURA_DATA_DIR;
      else process.env.SAKURA_DATA_DIR = previous;
      assert.equal(dirname(directory), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith('sakura-process-interop-'));
      await rm(directory, { recursive: true, force: true });
    }
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued guest host launches recheck their specific grant, program and VM generation
 * 状态影响 / State effects: `(interop as any).stateValue`, `entry.enabled`, `entry.programs.sample.sha256`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `import`, `'a'.repeat`, `runtime.acquire`, `createHash('sha256').update(token).digest`.
 * 检查边界 / Checked boundaries: `assert.rejects(result)`; `assert.equal(launched, false, change)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('queued guest host launches recheck their specific grant, program and VM generation', async () => {
  const { ProcessInterop } = await import('../server/process-interop.ts');
  const { HostRuntime } = await import('../server/host-runtime/index.ts');
  const { vmLifetime } = await import('../server/vm-lifetime.ts');
  const { createHash } = await import('node:crypto');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', token = 'a'.repeat(64);
  for (const change of ['disabled', 'program', 'live', 'generation']) {
    const live = { abort: new AbortController() } as any;
    const machines = { live: new Map([[id, live]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id })`）。
     * Result: Return the branch-computed value (`({ id })`).
     * 验证场景 / Scenario: queued guest host launches recheck their specific grant, program and VM generation
     */
    get: () => ({ id }), /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: queued guest host launches recheck their specific grant, program and VM generation
     */
    requireUnlocked() {},
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'running'`）。
       * Result: Return the branch-computed value (`'running'`).
       * 验证场景 / Scenario: queued guest host launches recheck their specific grant, program and VM generation
       */
      state: () => 'running' } as unknown as Machines;
    const runtime = new HostRuntime({ budgets: { process: { capacity: 1 } } });
    const resource = { owner: 'test:interop', kind: 'tool', label: 'interop', cost: { process: 1 } };
    const held = await runtime.acquire(resource);
    let entered!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void, launched = false;
    const queued = new Promise<void>(resolve => { entered = resolve; });
    const interop = new ProcessInterop(machines, 7337, () => {}, async (_program, signal) => {
      entered();
      const lease = await runtime.acquire({ ...resource, signal });
      try { launched = true; return { exitCode: 0, stdout: '', stderr: '' }; }
      finally { lease.release(); }
    });
    const entry = { enabled: true, tokenHash: createHash('sha256').update(token).digest('hex'),
      programs: { sample: { executable: 'C:\\approved.exe', fixedArgs: [], sha256: 'b'.repeat(64) } } };
    (interop as any).stateValue = { [id]: entry }; // Model the domain's already committed state publication.
    const result = interop.guest({ vmId: id, programId: 'sample' }, token);
    const rejected = assert.rejects(result);
    await queued;
    if (change === 'disabled') entry.enabled = false;
    if (change === 'program') entry.programs.sample.sha256 = 'c'.repeat(64);
    if (change === 'live') machines.live.set(id, { abort: new AbortController() } as any);
    if (change === 'generation') vmLifetime(id, live).advanceExecution();
    held.release(); await rejected;
    assert.equal(launched, false, change);
    assert.equal(runtime.snapshot().resources.length, 0);
    runtime.close();
  }
});
