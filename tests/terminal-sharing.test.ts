/**
 * 模块职责：回归验证模块，围绕 `terminal-sharing` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `terminal-sharing`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: terminal directory migration refusal exposes only its explicit safe code and instruction; all six socket protocols declare actual directions, JSON message shapes and binary RFB framing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TerminalSharing } from '../server/terminal-sharing.ts';
import type { Machines } from '../server/machines.ts';
import type { ProjectTerminals } from '../server/project-terminals.ts';
import { encodeSocketOutput, parseSocketInput, socketContracts, socketChannels, socketContractSchema } from '../shared/contracts/websocket.ts';
import { terminalConnectionFailure } from '../server/application-websocket.ts';
import { AppError } from '../shared/errors.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal directory migration refusal exposes only its explicit safe code and instruction
 * 协作入口 / Collaborators: `terminalConnectionFailure`, `assert.match`, `encodeSocketOutput`, `assert.doesNotMatch`.
 * 检查边界 / Checked boundaries: `assert.match(data, /请显式迁移权限/)`; `assert.match(data, /PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED/)`.
 */
test('terminal directory migration refusal exposes only its explicit safe code and instruction', () => {
  const refusal = new AppError('private C:\\secrets\\account.key TOKEN_SECRET', 409,
    'PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED');
  const data = terminalConnectionFailure(refusal);
  assert.match(data, /请显式迁移权限/);
  assert.match(data, /PROJECT_IDENTITY_DIRECTORY_MIGRATION_REQUIRED/);
  const frame = encodeSocketOutput('terminal', { type: 'error', data });
  assert.doesNotMatch(frame, /private|secrets|account.key|TOKEN_SECRET/);
  for (const error of [new Error(refusal.message), new AppError(refusal.message, 503, 'PROJECT_IDENTITY_CONTROL_FAILED'),
    { code: refusal.code, message: refusal.message }, null, undefined])
    assert.equal(terminalConnectionFailure(error), '终端连接暂不可用，请重试。');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all six socket protocols declare actual directions, JSON message shapes and binary RFB framing
 * 协作入口 / Collaborators: `assert.equal`, `socketContractSchema.parse`, `assert.deepEqual`, `parseSocketInput`.
 * 检查边界 / Checked boundaries: `assert.equal(socketChannels.length, 6)`; `assert.deepEqual(parseSocketInput('terminal', '{"type":"input","data":"echo hello\\n"}'), { type: 'input', data: 'echo hello\n' })`.
 */
test('all six socket protocols declare actual directions, JSON message shapes and binary RFB framing', () => {
  assert.equal(socketChannels.length, 6);
  for (const channel of socketChannels) socketContractSchema.parse(socketContracts[channel]);
  assert.deepEqual(parseSocketInput('terminal', '{"type":"input","data":"echo hello\\n"}'), { type: 'input', data: 'echo hello\n' });
  assert.deepEqual(parseSocketInput('terminal', '{"type":"resize","cols":80,"rows":24}'), { type: 'resize', cols: 80, rows: 24 });
  for (const input of [{ type: 'input', data: 'x'.repeat(32769) }, { type: 'input', data: 'x', extra: true },
    { type: 'resize', cols: 80.1, rows: 24 }, { type: 'execute', data: 'id' }])
    assert.throws(() => parseSocketInput('terminal', JSON.stringify(input)));
  for (const channel of ['events', 'logs', 'terminal-view'] as const)
    assert.throws(() => parseSocketInput(channel, '{"type":"input","data":"x"}'));
  assert.equal(encodeSocketOutput('events', { type: 'change', data: null }), '{"type":"change","data":null}');
  assert.throws(() => encodeSocketOutput('events', { type: 'data', data: 'leak' }));
  assert.throws(() => encodeSocketOutput('logs', { type: 'data', data: 'x', secret: 'never-public' }));
  assert.throws(() => encodeSocketOutput('desktop', { type: 'data', data: 'not RFB' }));
  assert.equal(socketContracts['desktop-view'].framing, 'byte-stream');
  assert.equal(socketContracts['desktop-view'].readOnly, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shared terminal grants require an exact running tmux session, persist and expire
 * 状态影响 / State effects: `found`, `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `Date.UTC`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.create(input), /tmux/)`; `assert.deepEqual(service.list(), [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('shared terminal grants require an exact running tmux session, persist and expire', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-terminal-share-'));
  let now = Date.UTC(2026, 0, 1),
    found = false;
  const commands: string[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: shared terminal grants require an exact running tmux session, persist and expire
     */
    state: () => 'running',
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 验证场景 / Scenario: shared terminal grants require an exact running tmux session, persist and expire
     * 协作入口 / Collaborators: `commands.push`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { stdout: '', stderr: '', code: found ? 0 : 1 };
    },
  } as unknown as Machines;
  const file = join(directory, 'grants.json');
  const service = new TerminalSharing(machines, file, () => now);
  const vmId = '00000000-0000-4000-8000-000000000001';
  const viewerId = '00000000-0000-4000-8000-000000000002';
  await service.init();
  try {
    const input = { vmId, viewerId, session: 'abc-123', minutes: 2 };
    await assert.rejects(service.create(input), /tmux/);
    assert.deepEqual(service.list(), []);
    found = true;
    const grant = await service.create(input);
    assert.equal(
      commands.at(-1),
      'command -v tmux >/dev/null && tmux has-session -t =sakura-terminal-abc-123',
    );
    assert.equal(service.find(viewerId, vmId, input.session)?.id, grant.id);
    assert.equal(service.list('00000000-0000-4000-8000-000000000003').length, 0);
    await assert.rejects(service.create({ ...input, session: '../../other' }));
    const repeated = await service.create(input);
    assert.equal(repeated.id, grant.id);
    const restored = new TerminalSharing(machines, file, () => now);
    await restored.init();
    assert.equal(restored.find(viewerId, vmId, input.session)?.id, grant.id);
    await restored.revokeViewer(viewerId);
    assert.equal(restored.list().length, 0);
    await restored.close();
    now += 120_000;
    assert.equal(service.find(viewerId, vmId, input.session), null);
    await service.revoke(grant.id);
    assert.deepEqual(service.list(), []);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: terminal grants persist exact projects and never retarget old or other-project sessions
 * 状态影响 / State effects: `active`, `valid`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `service.init`.
 * 检查边界 / Checked boundaries: `assert.equal(first.projectId, 'default')`; `assert.equal(second.projectId, active)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('terminal grants persist exact projects and never retarget old or other-project sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-scoped-terminal-share-'));
  const vmId = '00000000-0000-4000-8000-000000000001';
  const viewerId = '00000000-0000-4000-8000-000000000002';
  const service = new TerminalSharing(
    { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: terminal grants persist exact projects and never retarget old or other-project sessions
     */
    state: () => 'running' } as unknown as Machines,
    join(directory, 'grants.json'),
    undefined,
    () =>
      ({
        /**
         * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
         * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
         * 输入 / Inputs: _vm: string; scope: string | undefined。
         * 结果：返回受控对象，公开字段包括 `projectId, terminalId`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `projectId, terminalId`; the actual branch determines its shape.
         * 验证场景 / Scenario: terminal grants persist exact projects and never retarget old or other-project sessions
         * 失败 / Failure: `new Error('终端窗格未处于项目网络空间')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        validate: async (_vm: string, scope: string | undefined) => {
          if (!valid) throw new Error('终端窗格未处于项目网络空间');
          return { projectId: scope || active, terminalId: '00000000-0000-4000-8000-000000000003' };
        },
      }) as unknown as ProjectTerminals,
  );
  let active = 'default',
    valid = true;

  await service.init();
  try {
    const input = { vmId, viewerId, session: 'main' };
    const first = await service.create(input);
    assert.equal(first.projectId, 'default');
    active = '0123456789abcdef';
    const second = await service.create(input);
    assert.equal(second.projectId, active);
    assert.notEqual(second.id, first.id);
    assert.equal(service.find(viewerId, vmId, 'main'), null);
    assert.equal(service.find(viewerId, vmId, 'main', 'default')?.id, first.id);
    assert.equal(service.list(viewerId, vmId, active).length, 1);
    const refreshed = await service.create({ ...input, projectId: 'default' });
    assert.equal(refreshed.id, first.id);
    valid = false;
    await assert.rejects(service.create(input), /网络空间/);
    assert.equal(service.list().length, 2, 'failed validation cannot grant another session');
    const restored = new TerminalSharing({} as Machines, join(directory, 'grants.json'));
    await restored.init();
    assert.equal(restored.find(viewerId, vmId, 'main', active)?.id, second.id);
    assert.equal(restored.find(viewerId, vmId, 'main'), null);
    await restored.close();
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
