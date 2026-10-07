/**
 * 模块职责：回归验证模块，围绕 `syscall-profile` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `syscall-profile`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: seccomp requires confirmation, keeps the selected project result and redacts secrets; a pre-cancelled seccomp request does not prepare or issue any command.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSyscallProfile, syscallProfileInput } from '../server/syscall-profile.ts';
import { syscallIdentityFixture, syscallVmId } from './helpers/syscall-identity.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: seccomp requires confirmation, keeps the selected project result and redacts secrets
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `f.run`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run({ mode: 'run', command: 'echo' }), /confirmed=true/)`; `assert.equal(f.rootCommands.length, 0)`.
 */
test('seccomp requires confirmation, keeps the selected project result and redacts secrets', async () => {
  const f = syscallIdentityFixture();
  await assert.rejects(f.run({ mode: 'run', command: 'echo' }), /confirmed=true/);
  assert.equal(f.rootCommands.length, 0); assert.equal(f.launches.length, 0);
  const result = await f.run();
  assert.equal(result.code, 7); assert.equal(result.ready, false);
  assert.equal('projectId' in result && result.projectId, '0123456789abcdef');
  assert.equal('directory' in result && result.directory, '/workspace/limited');
  assert.equal('networkIsolation' in result && result.networkIsolation, 'private');
  assert.equal('stdout' in result && result.stdout, '[私密配置已隐藏] output');
  assert.equal('stderr' in result && result.stderr, '[私密配置已隐藏]');
  assert.throws(() => syscallProfileInput.parse({ mode: 'run', profile: 'unknown' }));
  assert.throws(() => syscallProfileInput.parse({ mode: 'run', command: 'echo', unexpected: true }));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a pre-cancelled seccomp request does not prepare or issue any command
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `f.abort.abort`, `assert.rejects`, `f.run`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.run(), error => error === f.abort.signal.reason)`; `assert.equal(f.rootCommands.length, 0)`.
 */
test('a pre-cancelled seccomp request does not prepare or issue any command', async () => {
  const f = syscallIdentityFixture(); f.abort.abort();
  await assert.rejects(f.run(), error => error === f.abort.signal.reason);
  assert.equal(f.rootCommands.length, 0); assert.equal(f.launches.length, 0);
  assert.equal(f.releases(), 0); assert.equal(f.closes(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: seccomp install publishes only the fixed system helper and verifies both policies without project config
 * 状态影响 / State effects: `f.workspaces.config`, `f.machines.writeGuestFile`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `runSyscallProfile`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(result.ready, true)`; `assert.equal(result.executed, true)`.
 */
test('seccomp install publishes only the fixed system helper and verifies both policies without project config', async () => {
  const f = syscallIdentityFixture(), files: Array<{ path: string; content: string }> = [];
  f.workspaces.config = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: seccomp install publishes only the fixed system helper and verifies both policies without project config
   * 失败 / Failure: `new Error('Administrator install must not read project config')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => { throw new Error('Administrator install must not read project config'); };
  f.machines.writeGuestFile = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: _id; path; content。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: seccomp install publishes only the fixed system helper and verifies both policies without project config
   * 协作入口 / Collaborators: `files.push`.
   */
  async (_id, path, content) => { files.push({ path, content }); };
  const result = await runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }, undefined, f.workspaces);
  assert.equal(result.ready, true); assert.equal(result.executed, true);
  assert.equal(files.length, 1); assert.equal(files[0].path, '/usr/local/lib/sakura/seccomp-run.py');
  assert.ok(files[0].content.includes('PR_SET_NO_NEW_PRIVS')); assert.ok(files[0].content.includes('CLONE_NAMESPACE_FLAGS'));
  assert.ok(f.rootCommands.some(command => command.includes('--self-test restricted') && command.includes('--self-test networkless')));
  assert.ok(f.rootCommands.every(command => command.startsWith('/usr/bin/env -i ') && command.includes('cd /\nset -eu')));
  assert.ok(f.rootCommands.every(command => !command.includes('ip netns exec') && !command.includes('seccomp-private-value')));
  assert.ok(f.rootCommands.some(command => command.includes('chown 0:0') && command.includes('chmod 755')));
  assert.equal(f.resolves(), 0); assert.equal(f.launches.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: seccomp install refuses foreign system directories before publishing the helper
 * 状态影响 / State effects: `f.machines.exec`, `f.machines.writeGuestFile`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `runSyscallProfile`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }), (error: any) => error.code === 'SYSCALL_SYSTEM_DIR…`; `assert.equal(writes, 0)`.
 */
test('seccomp install refuses foreign system directories before publishing the helper', async () => {
  const f = syscallIdentityFixture(), exec = f.machines.exec; let writes = 0;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: seccomp install refuses foreign system directories before publishing the helper
   * 协作入口 / Collaborators: `exec`, `args[1].includes`.
   */
  async (...args) => {
    await exec(...args); return { code: args[1].includes('SAKURA_SECCOMP_PARENT_CHECK') ? 1 : 0, stdout: '', stderr: '' };
  };
  f.machines.writeGuestFile = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: seccomp install refuses foreign system directories before publishing the helper
   */
  async () => { ++writes; };
  await assert.rejects(runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }),
    (error: any) => error.code === 'SYSCALL_SYSTEM_DIRECTORY_INVALID');
  assert.equal(writes, 0); assert.equal(f.rootCommands.length, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: seccomp install does not continue helper publication in a replacement Live
 * 状态影响 / State effects: `f.machines.exec`, `f.machines.writeGuestFile`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `syscallIdentityFixture`, `assert.rejects`, `runSyscallProfile`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }), (error: any) => error.code === 'PROJECT_IDENTITY_H…`; `assert.equal(writes, 0)`.
 */
test('seccomp install does not continue helper publication in a replacement Live', async () => {
  const f = syscallIdentityFixture(), exec = f.machines.exec; let writes = 0;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: args。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: seccomp install does not continue helper publication in a replacement Live
   * 协作入口 / Collaborators: `exec`, `f.machines.live.set`.
   */
  async (...args) => { const result = await exec(...args); f.machines.live.set(syscallVmId, {} as any); return result; };
  f.machines.writeGuestFile = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: seccomp install does not continue helper publication in a replacement Live
   */
  async () => { ++writes; };
  await assert.rejects(runSyscallProfile(f.machines, syscallVmId, { mode: 'install' }),
    (error: any) => error.code === 'PROJECT_IDENTITY_HOST_CHANGED');
  assert.equal(writes, 0); assert.equal(f.rootCommands.length, 1);
});
