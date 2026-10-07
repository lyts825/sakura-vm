/**
 * 模块职责：回归验证模块，围绕 `host-process` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `host-process`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: DPAPI transports input through the owned stdin pipe and confirms both finite invocations; finite Windows tools normalize restricted environments and resolve fixed PATH executables.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostExecFile, hostProcess } from '../server/host-process.ts';
import { hostRuntime } from '../server/host-runtime/index.ts';
import { dpapi } from '../server/secrets.ts';

const windows = { skip: process.platform !== 'win32' };
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`hostRuntime.snapshot().resources.filter((value) => value.kind.startsWith('proces…`）。
 * Result: Return the branch-computed value (`hostRuntime.snapshot().resources.filter((value) => value.kind.startsWith('proces…`).
 * 协作入口 / Collaborators: `hostRuntime.snapshot().resources.filter`, `hostRuntime.snapshot`.
 */
const processResources = () =>
  hostRuntime.snapshot().resources.filter((value) => value.kind.startsWith('process.'));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DPAPI transports input through the owned stdin pipe and confirms both finite invocations
 * 协作入口 / Collaborators: `Buffer.from('managed-process-fixture-' + randomUUID()).toString`, `Buffer.from`, `randomUUID`, `dpapi`.
 * 检查边界 / Checked boundaries: `assert.notEqual(ciphertext, input)`; `assert.equal(await dpapi('unprotect', ciphertext), input)`.
 */
test(
  'DPAPI transports input through the owned stdin pipe and confirms both finite invocations',
  windows,
  async () => {
    const input = Buffer.from('managed-process-fixture-' + randomUUID()).toString('base64');
    const ciphertext = await dpapi('protect', input);
    assert.notEqual(ciphertext, input);
    assert.equal(await dpapi('unprotect', ciphertext), input);
    assert.deepEqual(processResources(), []);
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: finite Windows tools normalize restricted environments and resolve fixed PATH executables
 * 协作入口 / Collaborators: `hostExecFile`, `assert.equal`, `assert.deepEqual`, `processResources`.
 * 检查边界 / Checked boundaries: `assert.equal(result.stdout, 'ok')`; `assert.deepEqual(processResources(), [])`.
 */
test(
  'finite Windows tools normalize restricted environments and resolve fixed PATH executables',
  windows,
  async () => {
    const env = { ...process.env, Path: process.env.PATH, PATH: process.env.PATH };
    const result = await hostExecFile(
      'windows-probe',
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '[Console]::Out.Write("ok")'],
      { env },
    );
    assert.equal(result.stdout, 'ok');
    assert.deepEqual(processResources(), []);
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a missing executable or invalid arguments fail before Native Host gets an execution request
 * 协作入口 / Collaborators: `assert.rejects`, `hostProcess`, `join`, `tmpdir`.
 * 检查边界 / Checked boundaries: `assert.rejects( hostProcess('trusted-boot-probe', join(tmpdir(), randomUUID() + '.exe'), ['--version']), { code: 'HOST_PROCESS_FAI…`; `assert.rejects(hostProcess('windows-probe', process.execPath, ['\0']), { code: 'HOST_PROCESS_FAILED', })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'a missing executable or invalid arguments fail before Native Host gets an execution request',
  windows,
  async () => {
    await assert.rejects(
      hostProcess('trusted-boot-probe', join(tmpdir(), randomUUID() + '.exe'), ['--version']),
      { code: 'HOST_PROCESS_FAILED' },
    );
    await assert.rejects(hostProcess('windows-probe', process.execPath, ['\0']), {
      code: 'HOST_PROCESS_FAILED',
    });
    await assert.rejects(
      hostProcess('windows-probe', process.execPath, ['--version'], { env: { BAD: '\0' } }),
      { code: 'HOST_PROCESS_FAILED' },
    );
    assert.deepEqual(processResources(), []);
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: normal Native Host exit confirms detached descendants ended before returning process quota
 * 协作入口 / Collaborators: `hostExecFile`, `Number`, `assert.ok`, `Number.isSafeInteger`.
 * 检查边界 / Checked boundaries: `assert.ok(Number.isSafeInteger(pid) && pid > 0)`; `assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })`.
 */
test(
  'normal Native Host exit confirms detached descendants ended before returning process quota',
  windows,
  async () => {
    const script = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); child.unref(); process.stdout.write(String(child.pid));`;
    const result = await hostExecFile('windows-probe', process.execPath, ['-e', script]);
    const pid = Number(result.stdout);
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.deepEqual(processResources(), []);
  },
);
