/**
 * 模块职责：回归验证模块，围绕 `disaster-recovery-drill` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `disaster-recovery-drill`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: drill verifies a backup, boots a temporary VM, checks a file hash and removes it; a mismatched file hash fails the drill but still removes its temporary VM.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Backups } from '../server/backups.ts';
import type { Bundles } from '../server/bundles.ts';
import { storageRuntime, type StorageLease } from '../server/storage-runtime.ts';
import { DisasterRecoveryDrill } from '../server/disaster-recovery-drill.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-drill-test-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
after(async () => {
  await rm(root, { recursive: true, force: true });
});
const file = join(root, 'backup.sakura');
await writeFile(file, 'verified-backup');
const sourceId = randomUUID(),
  backupId = randomUUID();
const expected = createHash('sha256').update('restored-data').digest('hex');

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: probeCode = 0; hash = expected。
 * 结果：返回受控对象，公开字段包括 `service, calls, temporaryId`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, calls, temporaryId`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`.
 */
function fixture(probeCode = 0, hash = expected) {
  const calls: string[] = [];
  const temporaryId = randomUUID();
  let status = 'stopped';
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`({ id, name: id === sourceId ? 'source' : 'drill-copy' })`）。
     * Result: Return the branch-computed value (`({ id, name: id === sourceId ? 'source' : 'drill-copy' })`).
     */
    get: (id: string) => ({ id, name: id === sourceId ? 'source' : 'drill-copy' }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `calls.push`.
     */
    start: async (id: string) => {
      calls.push('start:' + id);
      status = 'running';
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`status`）。
     * Result: Return the branch-computed value (`status`).
     */
    state: () => status,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`.
     */
    exec: async (_id: string, command: string) => {
      calls.push('probe:' + command);
      return { code: probeCode, stdout: `${hash}  /workspace/proof.txt\n`, stderr: '' };
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `status`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `calls.push`.
     */
    stop: async (id: string) => {
      calls.push('stop:' + id);
      status = 'stopped';
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `calls.push`.
     */
    delete: async (id: string) => {
      calls.push('delete:' + id);
    },
  } as unknown as Machines;
  const backups = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ items: [ { id: backupId, createdAt: new Date().toISOString(), bytes: 15, encr…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ items: [ { id: backupId, createdAt: new Date().toISOString(), bytes: 15, encr…`) through a Promise.
     * 协作入口 / Collaborators: `new Date().toISOString`.
     */
    view: async () => ({
      items: [
        {
          id: backupId,
          createdAt: new Date().toISOString(),
          bytes: 15,
          encrypted: false,
          storage: 'file',
          verifiedAt: undefined,
        },
      ],
    }),
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; _backupId: string; _password: undefined; _signal: AbortSignal; work: (file: string, lease: StorageLease) => Promise<unknown>。
     * 结果：返回分支计算值（`storageRuntime.run( { owner: 'test:drill', taskId: 'drill:' + temporaryId, label…`），以 Promise 交付。
     * Result: Return the branch-computed value (`storageRuntime.run( { owner: 'test:drill', taskId: 'drill:' + temporaryId, label…`) through a Promise.
     * 协作入口 / Collaborators: `calls.push`, `storageRuntime.run`.
     */
    withVerifiedFile: async (
      _id: string,
      _backupId: string,
      _password: undefined,
      _signal: AbortSignal,
      work: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: file: string; lease: StorageLease。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (file: string, lease: StorageLease) => Promise<unknown>,
    ) => {
      calls.push('verify');
      return storageRuntime.run(
        {
          owner: 'test:drill',
          taskId: 'drill:' + temporaryId,
          label: 'Verify fixture',
          mode: 'write',
          paths: [root],
          dynamicTemporary: [root],
          buffers: 20 * 1024 ** 2,
          files: 8,
        },
        (lease) => work(file, lease),
      );
    },
  } as unknown as Backups;
  const bundles = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: name: string。
     * 结果：返回受控对象，公开字段包括 `id`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`.
     */
    import: async (name: string) => {
      calls.push('import:' + name);
      return { id: temporaryId };
    },
  } as unknown as Bundles;
  return { service: new DisasterRecoveryDrill(machines, backups, bundles), calls, temporaryId };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: drill verifies a backup, boots a temporary VM, checks a file hash and removes it
 * 协作入口 / Collaborators: `fixture`, `service.run`, `assert.ok`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok('backups' in status)`; `assert.equal(status.backups[0].id, backupId)`.
 */
test('drill verifies a backup, boots a temporary VM, checks a file hash and removes it', async () => {
  const { service, calls, temporaryId } = fixture();
  const status = await service.run(sourceId, { mode: 'status' }, 'check');
  assert.ok('backups' in status);
  assert.equal(status.backups[0].id, backupId);
  const result = await service.run(
    sourceId,
    { mode: 'run', backupId, probePath: '/workspace/proof.txt', expectedSha256: expected },
    'run',
  );
  assert.ok('temporaryVmRemoved' in result);
  assert.equal(result.ready, true);
  assert.equal(result.temporaryVmRemoved, true);
  assert.equal(result.probeSha256, expected);
  assert.deepEqual(
    calls.slice(0, 3).map((call) => call.split(':')[0]),
    ['verify', 'import', 'start'],
  );
  assert.equal(calls.at(-2), 'stop:' + temporaryId);
  assert.equal(calls.at(-1), 'delete:' + temporaryId);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a mismatched file hash fails the drill but still removes its temporary VM
 * 协作入口 / Collaborators: `fixture`, `'0'.repeat`, `service.run`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok('temporaryVmRemoved' in result)`; `assert.equal(result.ready, false)`.
 */
test('a mismatched file hash fails the drill but still removes its temporary VM', async () => {
  const { service, calls, temporaryId } = fixture(0, '0'.repeat(64));
  const result = await service.run(
    sourceId,
    { mode: 'run', backupId, probePath: '/workspace/proof.txt', expectedSha256: expected },
    'run',
  );
  assert.ok('temporaryVmRemoved' in result);
  assert.equal(result.ready, false);
  assert.match(result.error || '', /不匹配/);
  assert.equal(result.temporaryVmRemoved, true);
  assert.equal(calls.at(-1), 'delete:' + temporaryId);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid backup and unsafe probe paths fail before creating a temporary VM
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `service.run`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.run(sourceId, { mode: 'run' }, 'run'), /请选择/)`; `assert.rejects( service.run(sourceId, { mode: 'run', backupId, probePath: '../../host' }, 'run'), /绝对路径/, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('invalid backup and unsafe probe paths fail before creating a temporary VM', async () => {
  const { service, calls } = fixture();
  await assert.rejects(service.run(sourceId, { mode: 'run' }, 'run'), /请选择/);
  await assert.rejects(
    service.run(sourceId, { mode: 'run', backupId, probePath: '../../host' }, 'run'),
    /绝对路径/,
  );
  await assert.rejects(
    service.run(sourceId, { mode: 'run', backupId, expectedSha256: expected }, 'run'),
    /检查文件路径/,
  );
  assert.deepEqual(calls, []);
});
