/**
 * 模块职责：回归验证模块，围绕 `single-app-run-lifecycle` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `single-app-run-lifecycle`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: native prepare lost ACK recovers only the same existing UUID and closes it without relaunch or double release; missing native ticket and extant unknown cgroup retain intent and never reissue native prepare.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from '../server/model.ts';
import { SingleAppWindows } from '../server/single-app-windows.ts';
import { singleAppFixture } from './single-app-fixture.ts';
import { hostRuntime } from '../server/host-runtime/index.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native prepare lost ACK recovers only the same existing UUID and closes it without relaunch or double release
 * 状态影响 / State effects: `f.faults.prepareAckLost`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /native ACK lost/)`; `assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'recover', 'stop'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('native prepare lost ACK recovers only the same existing UUID and closes it without relaunch or double release', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.prepareAckLost = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /native ACK lost/);
    assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'recover', 'stop']);
    assert.equal(new Set(f.actions.map(action => action.id)).size, 1); assert.equal(f.releaseCount(), 1);
    assert.equal((await f.journal()).sessions[0].phase, 'stopped');
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: missing native ticket and extant unknown cgroup retain intent and never reissue native prepare
 * 状态影响 / State effects: `f.faults.missingNativeTicket`, `f.faults.unknownGroup`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `f.journal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as { status: number }).status === 503)`; `assert.equal(session.phase, 'cleanup-failed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('missing native ticket and extant unknown cgroup retain intent and never reissue native prepare', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.missingNativeTicket = f.faults.unknownGroup = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as { status: number }).status === 503);
    const session = (await f.journal()).sessions[0]; assert.equal(session.phase, 'cleanup-failed'); assert.equal(session.run, null);
    assert.equal(f.releaseCount(), 0); assert.equal(f.actions.filter(action => action.action === 'native-prepare').length, 1);
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用/);
    await assert.rejects(f.apps.stop(f.id, session.id));
    assert.equal(f.actions.filter(action => action.action === 'native-prepare').length, 1);
    f.faults.unknownGroup = false;
    await f.apps.stop(f.id, session.id);
    assert.equal((await f.journal()).sessions[0].absence.ticketAbsent, true); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: start ACK loss closes the exact original guest run and retains the durable stopped receipt
 * 状态影响 / State effects: `f.faults.startAckLost`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `f.journal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /start ACK lost/)`; `assert.equal(session.phase, 'stopped')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('start ACK loss closes the exact original guest run and retains the durable stopped receipt', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.startAckLost = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /start ACK lost/);
    const session = (await f.journal()).sessions[0]; assert.equal(session.phase, 'stopped');
    assert.equal(session.receipt.directoryView.desktopRunId, session.id); assert.equal(f.releaseCount(), 1);
    assert.equal(f.actions.filter(action => action.action === 'native-prepare').length, 1);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cleanup failure and stop ACK loss preserve full original proof and permit precise retry
 * 状态影响 / State effects: `f.faults.stopFail`, `f.faults.stopAckLost`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.journal`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.stop(f.id, session.id))`; `assert.equal(pending.phase, 'cleanup-failed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('cleanup failure and stop ACK loss preserve full original proof and permit precise retry', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' }); const original = (await f.journal()).sessions[0].run;
    f.faults.stopFail = true; await assert.rejects(f.apps.stop(f.id, session.id));
    const pending = (await f.journal()).sessions[0]; assert.equal(pending.phase, 'cleanup-failed'); assert.deepEqual(pending.run, original);
    assert.equal(f.releaseCount(), 0); assert.equal((await f.apps.list(f.id))[0].cleanupPending, true);
    f.faults.stopFail = false; f.faults.stopAckLost = true; await assert.rejects(f.apps.stop(f.id, session.id));
    assert.equal((await f.journal()).sessions[0].phase, 'cleanup-failed'); assert.equal(f.releaseCount(), 0);
    await f.apps.stop(f.id, session.id); assert.equal(f.releaseCount(), 1);
    assert.equal((await f.journal()).sessions[0].phase, 'stopped');
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readonly reload uses saved original build/run and current policy despite stale revoked journal
 * 状态影响 / State effects: `reopened`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.journal()).sessions[0].revoked, false)`; `assert.equal((await reopened.list(f.id))[0].status, 'relaunch-required')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('readonly reload uses saved original build/run and current policy despite stale revoked journal', async () => {
  const f = await singleAppFixture(); let reopened: SingleAppWindows | undefined;
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' });
    await writeFile(join(f.root, f.id, 'single-app-clipboard.json'), JSON.stringify({ version: 1,
      rules: { xterm: { copy: false, paste: true } } }));
    assert.equal((await f.journal()).sessions[0].revoked, false);
    const before = await readFile(f.file, 'utf8'), actionCount = f.actions.length;
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    assert.equal((await reopened.list(f.id))[0].status, 'relaunch-required');
    await assert.rejects(reopened.port(f.id, session.id), /规则已收紧/);
    assert.equal(await readFile(f.file, 'utf8'), before);
    assert.ok(f.actions.slice(actionCount).every(action => action.action === 'status'));
    await reopened.stop(f.id, session.id); await reopened.close(); reopened = undefined;
  } finally { if (reopened) await reopened.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: forged endpoint or stop cgroup receipt never releases the original lease or opens a bridge
 * 状态影响 / State effects: `f.faults.endpointChanged`, `f.faults.stopForeignRun`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `assert.equal`, `budget`.
 * 检查边界 / Checked boundaries: `assert.equal(budget()?.kind, 'execution.session')`; `assert.rejects(f.apps.port(f.id, session.id), /监听已变化/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('forged endpoint or stop cgroup receipt never releases the original lease or opens a bridge', async () => {
  const f = await singleAppFixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' }); f.faults.endpointChanged = true;
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`hostRuntime.snapshot().resources.find(value => value.owner === `session:${sessio…`）。
     * Result: Return the branch-computed value (`hostRuntime.snapshot().resources.find(value => value.owner === `session:${sessio…`).
     * 验证场景 / Scenario: forged endpoint or stop cgroup receipt never releases the original lease or opens a bridge
     * 协作入口 / Collaborators: `hostRuntime.snapshot().resources.find`, `hostRuntime.snapshot`.
     */
    const budget = () => hostRuntime.snapshot().resources.find(value => value.owner === `session:${session.id}`);
    assert.equal(budget()?.kind, 'execution.session');
    await assert.rejects(f.apps.port(f.id, session.id), /监听已变化/);
    f.faults.endpointChanged = false; f.faults.stopForeignRun = true;
    await assert.rejects(f.apps.stop(f.id, session.id), /关闭回执不符/); assert.equal(f.releaseCount(), 0);
    assert.equal((await f.journal()).sessions[0].phase, 'cleanup-failed');
    assert.equal(budget()?.state, 'cleanup-pending');
    f.faults.stopForeignRun = false; await f.apps.stop(f.id, session.id); assert.equal(f.releaseCount(), 1);
    assert.equal(budget(), undefined);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: reloaded stop retires the original RAM lease without repeating guest stop or rewriting a sibling or revocation
 * 状态影响 / State effects: `reopened`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `reopened.list`, `reopened.stop`.
 * 检查边界 / Checked boundaries: `assert.equal(f.releaseCount(), 1)`; `assert.equal(f.releaseCount(), 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('reloaded stop retires the original RAM lease without repeating guest stop or rewriting a sibling or revocation', async () => {
  const f = await singleAppFixture(); let reopened: SingleAppWindows | undefined;
  try {
    const first = await f.apps.start(f.id, { program: 'xterm' });
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    await reopened.list(f.id); await reopened.stop(f.id, first.id);
    const second = await reopened.start(f.id, { program: 'xterm' });
    await reopened.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true });
    const disk = await readFile(f.file, 'utf8'), actionCount = f.actions.length;
    assert.equal(f.releaseCount(), 1);
    await f.apps.stop(f.id, first.id);
    assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, actionCount);
    assert.equal(await readFile(f.file, 'utf8'), disk);
    assert.equal((await f.journal()).sessions.find((row: { id: string }) => row.id === first.id).closure.phase, 'closed');
    assert.equal((await f.journal()).sessions.find((row: { id: string }) => row.id === second.id).revoked, true);
    await f.apps.stop(f.id, first.id); assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, actionCount);
    await reopened.stop(f.id, second.id); assert.equal(f.releaseCount(), 2);
  } finally { if (reopened) await reopened.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: forged durable stopped tuple never retires a RAM lease or issues another guest ticket
 * 状态影响 / State effects: `changed.sessions[0].phase`, `changed.sessions[0].closure`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `readFile`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.stop(f.id, window.id), (error: unknown) => (error as AppError).code === 'SINGLE_APP_HOST_CHANGED')`; `assert.equal(f.releaseCount(), 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('forged durable stopped tuple never retires a RAM lease or issues another guest ticket', async () => {
  const f = await singleAppFixture();
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' });
    const original = await readFile(f.file, 'utf8'), changed = JSON.parse(original), actionCount = f.actions.length;
    changed.sessions[0].phase = 'stopped'; changed.sessions[0].closure = { ...changed.sessions[0].run, phase: 'closed', cgroupInode: '999' };
    await writeFile(f.file, JSON.stringify(changed));
    await assert.rejects(f.apps.stop(f.id, window.id), (error: unknown) => (error as AppError).code === 'SINGLE_APP_HOST_CHANGED');
    assert.equal(f.releaseCount(), 0); assert.equal(f.actions.length, actionCount);
    await writeFile(f.file, original); await f.apps.stop(f.id, window.id);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: committed clipboard policy remains restrictive after journal write failure and a readonly reload
 * 状态影响 / State effects: `persistence.save`, `reopened`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.apps.onSessionInvalidated`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true }), /journal ACK/)`; `assert.equal(disconnected, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('committed clipboard policy remains restrictive after journal write failure and a readonly reload', async () => {
  const f = await singleAppFixture(); let reopened: SingleAppWindows | undefined;
  const persistence = f.apps as unknown as { /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: id: string。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  save(id: string): Promise<void> }, save = persistence.save;
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' }); let disconnected = 0;
    f.apps.onSessionInvalidated(f.id, window.id, () => disconnected++);
    const before = await readFile(f.file, 'utf8');
    persistence.save = /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: committed clipboard policy remains restrictive after journal write failure and a readonly reload
     * 失败 / Failure: `new AppError('journal ACK failed', 503)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    async () => { throw new AppError('journal ACK failed', 503); };
    await assert.rejects(f.apps.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true }), /journal ACK/);
    persistence.save = save;
    assert.equal(disconnected, 1); assert.equal(await readFile(f.file, 'utf8'), before);
    await assert.rejects(f.apps.port(f.id, window.id), /规则已收紧/);
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    assert.equal((await reopened.list(f.id))[0].status, 'relaunch-required');
    await assert.rejects(reopened.connectionCommand(f.id, window.id, window.port), /规则已收紧/);
    assert.equal(await readFile(f.file, 'utf8'), before);
    await reopened.stop(f.id, window.id); await f.apps.stop(f.id, window.id);
    assert.equal(f.releaseCount(), 1);
  } finally { persistence.save = save; if (reopened) await reopened.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: owned application natural exit closes the exact independent run including detached descendants
 * 状态影响 / State effects: `f.faults.statusExited`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.journal`, `f.releaseCount`.
 * 检查边界 / Checked boundaries: `assert.equal(f.releaseCount(), 1)`; `assert.equal((await f.journal()).sessions[0].phase, 'stopped')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('owned application natural exit closes the exact independent run including detached descendants', async () => {
  const f = await singleAppFixture({ exitPollMs: 10 });
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' }); const run = (await f.journal()).sessions[0].run;
    f.faults.statusExited = true;
    for (let attempt = 0; attempt < 100 && f.releaseCount() === 0; attempt++) await delay(10);
    assert.equal(f.releaseCount(), 1); assert.equal((await f.journal()).sessions[0].phase, 'stopped');
    assert.deepEqual(f.actions.find(action => action.action === 'stop')!.origin!.run, run);
    assert.equal(f.runs.get(window.id)!.phase, 'closed');
    const count = f.actions.length; await delay(30); assert.equal(f.actions.length, count);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: natural exit cleanup failure preserves its original lease and read-only reload does not resume an owner watcher
 * 状态影响 / State effects: `f.faults.statusExited`, `f.faults.stopFail`, `reopened`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `Promise.allSettled`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.journal()).sessions[0].phase, 'cleanup-failed')`; `assert.equal(f.releaseCount(), 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('natural exit cleanup failure preserves its original lease and read-only reload does not resume an owner watcher', { timeout: 5000 }, async () => {
  const f = await singleAppFixture({ exitPollMs: 10 }); let reopened: SingleAppWindows | undefined;
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' });
    const call = f.options.control.call;
    const stopped = new Promise<void>(resolve => {
      f.options.control.call = /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: args。
       * 结果：返回分支计算值（`await call(...args)`），以 Promise 交付。
       * Result: Return the branch-computed value (`await call(...args)`) through a Promise.
       * 验证场景 / Scenario: natural exit cleanup failure preserves its original lease and read-only reload does not resume an owner watcher
       * 协作入口 / Collaborators: `call`, `resolve`.
       * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
       * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
       */
      async (...args) => {
        try { return await call(...args); }
        finally { if (args[2] === 'stop') resolve(); }
      };
    });
    f.faults.statusExited = f.faults.stopFail = true;
    // The production exit watcher is unref'd; this bounded test wait must keep
    // the event loop alive until the original owner's cleanup attempt arrives.
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('natural exit cleanup was not attempted within 2 seconds')), 2000);
      void stopped.then(() => { clearTimeout(deadline); resolve(); }, error => { clearTimeout(deadline); reject(error); });
    });
    // Wait for this owner's actual journal publication, rather than repeatedly opening its
    // rename target while Windows is publishing the cleanup receipt.
    await Promise.allSettled([...(f.apps as unknown as { pending: Set<Promise<unknown>> }).pending]);
    assert.equal((await f.journal()).sessions[0].phase, 'cleanup-failed'); assert.equal(f.releaseCount(), 0);
    const before = await readFile(f.file, 'utf8'), actionCount = f.actions.length;
    reopened = new SingleAppWindows(f.machines, f.workspaces, f.options);
    assert.equal((await reopened.list(f.id))[0].cleanupPending, true); await delay(50);
    assert.equal(await readFile(f.file, 'utf8'), before); assert.equal(f.actions.length, actionCount);
    f.faults.stopFail = false; await f.apps.stop(f.id, window.id); assert.equal(f.releaseCount(), 1);
  } finally { if (reopened) await reopened.close(); await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: captured configuration changing during install never launches or prepares a native run
 * 状态影响 / State effects: `f.options.control.install`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).code === 'SINGLE_APP_CONFIG_CHANG…`; `assert.equal(f.releaseCount(), 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('captured configuration changing during install never launches or prepares a native run', async () => {
  const f = await singleAppFixture();
  try {
    const install = f.options.control.install;
    f.options.control.install = /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`install()`），以 Promise 交付。
     * Result: Return the branch-computed value (`install()`) through a Promise.
     * 验证场景 / Scenario: captured configuration changing during install never launches or prepares a native run
     * 状态影响 / State effects: `project.environment`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `f.configs.get`, `install`.
     */
    async () => { const project = f.configs.get('default')!;
      project.environment = { ...project.environment, LATE: 'changed' }; return install(); };
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).code === 'SINGLE_APP_CONFIG_CHANGED');
    assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, 0); assert.equal((await f.apps.list(f.id)).length, 0);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: caller cancellation after guest prepare closes only the original UUID before application exec
 * 状态影响 / State effects: `f.options.control.call`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }, abort.signal))`; `assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'prepare', 'stop'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('caller cancellation after guest prepare closes only the original UUID before application exec', async () => {
  const f = await singleAppFixture();
  try {
    const abort = new AbortController(), call = f.options.control.call;
    f.options.control.call = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result`) through a Promise.
     * 验证场景 / Scenario: caller cancellation after guest prepare closes only the original UUID before application exec
     * 协作入口 / Collaborators: `call`, `abort.abort`.
     */
    async (...args) => { const result = await call(...args); if (args[2] === 'prepare') abort.abort(); return result; };
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }, abort.signal));
    assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'prepare', 'stop']);
    assert.equal(new Set(f.actions.map(action => action.id)).size, 1); assert.equal(f.releaseCount(), 1);
    assert.equal((await f.journal()).sessions[0].closure.phase, 'closed');
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: same-boot live replacement keeps cleanup retryable and a proven later boot retires the original run
 * 状态影响 / State effects: `f.faults.reboot`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `f.apps.start`, `f.journal`, `f.machines.live.set`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.stop(f.id, window.id), (error: unknown) => (error as AppError).code === 'SESSION_CLEANUP_PENDING')`; `assert.equal(f.releaseCount(), 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('same-boot live replacement keeps cleanup retryable and a proven later boot retires the original run', async () => {
  const f = await singleAppFixture();
  try {
    const window = await f.apps.start(f.id, { program: 'xterm' }), original = (await f.journal()).sessions[0].run;
    f.machines.live.set(f.id, { ...f.machines.live.get(f.id)! });
    await assert.rejects(f.apps.stop(f.id, window.id), (error: unknown) => (error as AppError).code === 'SESSION_CLEANUP_PENDING');
    assert.equal(f.releaseCount(), 0); assert.deepEqual((await f.journal()).sessions[0].run, original);
    assert.equal(f.actions.filter(action => action.action === 'stop').length, 0);
    f.faults.reboot = true; await f.apps.stop(f.id, window.id);
    const retired = (await f.journal()).sessions[0];
    assert.deepEqual(retired.run, original); assert.deepEqual(retired.closure, original);
    assert.deepEqual(retired.retirement, { reason: 'guest-reboot', bootId: f.rebootId }); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: recovery rejects a foreign native tuple before adopting it or closing any other run
 * 状态影响 / State effects: `f.faults.prepareAckLost`, `f.options.control.recover`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `f.journal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).status === 503)`; `assert.equal(journal.sessions[0].run, null)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('recovery rejects a foreign native tuple before adopting it or closing any other run', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.prepareAckLost = true; const recover = f.options.control.recover;
    f.options.control.recover = /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`result.run ? { ...result, run: { ...result.run, bootId: f.rebootId } } : result`），以 Promise 交付。
     * Result: Return the branch-computed value (`result.run ? { ...result, run: { ...result.run, bootId: f.rebootId } } : result`) through a Promise.
     * 验证场景 / Scenario: recovery rejects a foreign native tuple before adopting it or closing any other run
     * 协作入口 / Collaborators: `recover`.
     */
    async (...args) => { const result = await recover(...args);
      return result.run ? { ...result, run: { ...result.run, bootId: f.rebootId } } : result; };
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).status === 503);
    const journal = await f.journal(); assert.equal(journal.sessions[0].run, null); assert.equal(f.releaseCount(), 0);
    assert.equal(f.actions.filter(action => action.action === 'stop').length, 0);
    f.options.control.recover = recover; await f.apps.stop(f.id, journal.sessions[0].id); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a no-run durable intent cannot change its captured native build during retry
 * 状态影响 / State effects: `f.faults.prepareAckLost`, `f.faults.unknownGroup`, `session.nativeBuild`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }))`; `assert.equal(session.run, null)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a no-run durable intent cannot change its captured native build during retry', async () => {
  const f = await singleAppFixture();
  try {
    f.faults.prepareAckLost = f.faults.unknownGroup = true;
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }));
    const original = await readFile(f.file, 'utf8'), modified = JSON.parse(original);
    const session = modified.sessions[0]; assert.equal(session.run, null);
    session.nativeBuild = 'c'.repeat(64); await writeFile(f.file, JSON.stringify(modified));
    const actionCount = f.actions.length;
    await assert.rejects(f.apps.stop(f.id, session.id), (error: unknown) => (error as AppError).code === 'SINGLE_APP_HOST_CHANGED');
    assert.equal(f.actions.length, actionCount); assert.equal(f.releaseCount(), 0);
    await writeFile(f.file, original); f.faults.unknownGroup = false;
    await f.apps.stop(f.id, session.id); assert.equal(f.releaseCount(), 1);
  } finally { await f.close(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: changed installed source is rejected before intent and a foreign returned source is recovered only from the captured build
 * 状态影响 / State effects: `f.options.nativeBuild`, `f.options.control.prepareRun`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `singleAppFixture`, `assert.rejects`, `f.apps.start`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).code === 'SINGLE_APP_NATIVE_CHANG…`; `assert.equal(f.releaseCount(), 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('changed installed source is rejected before intent and a foreign returned source is recovered only from the captured build', async () => {
  const f = await singleAppFixture();
  try {
    const expected = f.options.nativeBuild;
    f.options.nativeBuild = /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'c'.repeat(64)`），以 Promise 交付。
     * Result: Return the branch-computed value (`'c'.repeat(64)`) through a Promise.
     * 验证场景 / Scenario: changed installed source is rejected before intent and a foreign returned source is recovered only from the captured build
     * 协作入口 / Collaborators: `'c'.repeat`.
     */
    async () => 'c'.repeat(64);
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), (error: unknown) => (error as AppError).code === 'SINGLE_APP_NATIVE_CHANGED');
    assert.equal(f.releaseCount(), 1); assert.equal(f.actions.length, 0);
    f.options.nativeBuild = expected;
    const prepareRun = f.options.control.prepareRun;
    f.options.control.prepareRun = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`({ ...await prepareRun(...args), build: 'c'.repeat(64) })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ ...await prepareRun(...args), build: 'c'.repeat(64) })`) through a Promise.
     * 验证场景 / Scenario: changed installed source is rejected before intent and a foreign returned source is recovered only from the captured build
     * 协作入口 / Collaborators: `prepareRun`, `'c'.repeat`.
     */
    async (...args) => ({ ...await prepareRun(...args), build: 'c'.repeat(64) });
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }));
    assert.deepEqual(f.actions.map(action => action.action), ['native-prepare', 'recover', 'stop']);
    const session = (await f.journal()).sessions[0];
    assert.equal(session.nativeBuild, await expected()); assert.equal(session.run.build, session.nativeBuild);
    assert.equal(session.phase, 'stopped'); assert.equal(f.releaseCount(), 2);
  } finally { await f.close(); }
});
