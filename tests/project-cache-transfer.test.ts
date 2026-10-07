/**
 * 模块职责：回归验证模块，围绕 `project-cache-transfer` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-cache-transfer`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: npm and pip get distinct writable copies bound to one exact native owner; retirement archives the full proof; lost preparation ACK keeps run:null intent, then exact native never-issued proof safely retires the partial copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Machines } from '../server/machines.ts';
import { AppError } from '../server/model.ts';
import { projectSchema, type Project } from '../server/workspaces.ts';
import type { ProjectIdentityRun } from '../server/project-identity.ts';
import { ProjectCacheTransfers, projectCachedInstallCommand, projectCacheTransferLimits,
  type ProjectCacheTransferOptions, type ProjectCacheTransferOwner, type ProjectCacheTransferReply } from '../server/project-cache-transfer.ts';
import { projectCacheTransferControl } from '../server/project-cache-transfer-control.ts';
import type { ProjectTaskResourceContext, ProjectTaskResourceReceipt } from '../server/project-run-scope.ts';
import { projectIdentityTask } from '../server/project-run-scope.ts';
import { setVmStorageRoot } from '../server/model.ts';
import { scopeIdentityFixture } from './project-scope-identity-fixture.ts';

const projectId = '0123456789abcdef';
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `allocate, transfers, options, vmId, folder, context, state, receipts, commands`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `allocate, transfers, options, vmId, folder, context, state, receipts, commands`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 */
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'sakura-cache-transfer-')), vmId = randomUUID(), bootId = randomUUID();
  const live = { startedAt: 'fixture' }, registryId = randomUUID(), identityId = randomUUID();
  const identity = { version: 1 as const, phase: 'active' as const, registryId, projectId, identityId, revision: 1,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20001, gid: 20001,
    home: '/var/lib/sakura-project-homes/' + identityId, directory: '/srv/project',
    directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: 'private' as const };
  const context: ProjectTaskResourceContext = { identity, owner: { kind: 'task', runId: randomUUID(), bootId }, sha256: 'b'.repeat(64), live: live as any };
  const full: ProjectIdentityRun = { version: 1, phase: 'closed', mode: 'inherit-current', registryId, projectId, identityId, revision: 1,
    runId: context.owner.runId, bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '5', cgroupDevice: '6',
    cgroupInode: '23456', cgroupName: 'sakura-task-' + context.owner.runId, namespace: 'sk-' + projectId };
  const receipts = new Map<string, ProjectCacheTransferReply>(), commands: any[] = [], retired: any[] = [];
  const state = { lostPrepareAck: false, failedRetire: false, groupAbsent: true, proof: { run: full } as ProjectTaskResourceReceipt };
  const machines = { live: new Map([[vmId, live]]), /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 失败 / Failure: `new Error('Unapproved root control')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  exec: async () => { throw new Error('Unapproved root control'); } } as unknown as Machines;
  const options: ProjectCacheTransferOptions = { rootDirectory: folder,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ manifest: { build: 'a'.repeat(64) } as any, files: new Map(), directory: '/tr…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ manifest: { build: 'a'.repeat(64) } as any, files: new Map(), directory: '/tr…`) through a Promise.
     * 协作入口 / Collaborators: `'a'.repeat`.
     */
    source: async () => ({ manifest: { build: 'a'.repeat(64) } as any, files: new Map(), directory: '/trusted/build' }),
    scopes: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     */
    taskResources: async () => [], /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id; value。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `assert.deepEqual`.
     * 检查边界 / Checked boundaries: `assert.deepEqual(value.owner, context.owner)`.
     */
    completeTaskResource: async (_id, value) => { assert.deepEqual(value.owner, context.owner); }, /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new AppError('scope remains', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    recoverStoppedTasks: async () => { if (!state.groupAbsent) throw new AppError('scope remains', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED'); },
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _id; value。
       * 结果：返回分支计算值（`state.proof`），以 Promise 交付。
       * Result: Return the branch-computed value (`state.proof`) through a Promise.
       * 协作入口 / Collaborators: `assert.deepEqual`.
       * 检查边界 / Checked boundaries: `assert.deepEqual(value.identity, identity)`; `assert.deepEqual(value.owner, context.owner)`.
       */
      taskResourceReceipt: async (_id, value) => { assert.deepEqual(value.identity, identity); assert.deepEqual(value.owner, context.owner); return state.proof; } },
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _id; request。
     * 结果：返回分支计算值（`reply / structuredClone(result)`），以 Promise 交付。
     * Result: Return the branch-computed value (`reply / structuredClone(result)`) through a Promise.
     * 失败 / Failure: `new Error('ack lost after root durable copy')`; `new AppError('fsync or unlink failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `structuredClone`, `assert.equal`, `receipts.has`.
     * 检查边界 / Checked boundaries: `assert.equal(receipts.has(owner.stageId), false)`; `assert.ok(state.groupAbsent, 'retirement cannot kill or ignore a present/replacement domain')`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    control: async (_id, request) => {
      commands.push(structuredClone(request));
      const owner = request.owner;
      if (request.action === 'prepare') {
        assert.equal(receipts.has(owner.stageId), false);
        const receipt = { version: 1 as const, phase: 'ready' as const, owner, stage: { device: '7', inode: '100' },
          data: { device: '7', inode: '101' }, manifest: { sha256: 'c'.repeat(64), bytes: 20, nodes: 3 }, task: null };
        const reply: ProjectCacheTransferReply = { version: 1, state: 'present', bootId, receipt }; receipts.set(owner.stageId, reply);
        if (state.lostPrepareAck) throw new Error('ack lost after root durable copy');
        return reply;
      }
      const result = receipts.get(owner.stageId) || { version: 1 as const, state: 'absent' as const, bootId };
      if (request.action === 'probe') return structuredClone(result);
      assert.ok(state.groupAbsent, 'retirement cannot kill or ignore a present/replacement domain');
      assert.deepEqual(request.task, state.proof);
      if (state.failedRetire) throw new AppError('fsync or unlink failed', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED');
      if (result.state === 'absent') return result;
      const next = { ...result, receipt: { ...result.receipt, phase: 'closed' as const, task: request.task! } };
      receipts.set(owner.stageId, next); retired.push(owner.stageId); return next;
    },
  };
  const project = Object.defineProperty(projectSchema.parse({ directory: identity.directory, networkIsolation: 'private' }),
    '_workspace', { value: projectId, enumerable: false }) as Project;
  const transfers = new ProjectCacheTransfers(machines, options);
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: manager: 'npm' | 'pip' = 'npm'。
   * 结果：返回分支计算值（`transfers.allocate(vmId, project, manager, new AbortController().signal, live as…`）。
   * Result: Return the branch-computed value (`transfers.allocate(vmId, project, manager, new AbortController().signal, live as…`).
   * 协作入口 / Collaborators: `transfers.allocate`.
   */
  const allocate = (manager: 'npm' | 'pip' = 'npm') => transfers.allocate(vmId, project, manager, new AbortController().signal, live as any);
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 状态影响 / State effects: `names`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `join`, `readdir`, `Promise.all`, `names.filter(name => name.endsWith('.json')).map`.
   */
  const records = async () => {
    const root = join(folder, 'project-cache-transfers', projectId);
    let names: string[]; try { names = await readdir(root); } catch { return []; }
    return Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(root, name), 'utf8').then(JSON.parse)));
  };
  return { allocate, transfers, options, vmId, folder, context, state, receipts, commands, retired, records, full, project,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`rm(folder, { recursive: true, force: true })`）。
     * Result: Return the branch-computed value (`rm(folder, { recursive: true, force: true })`).
     * 协作入口 / Collaborators: `rm`.
     */
    dispose: () => rm(folder, { recursive: true, force: true }) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: npm and pip get distinct writable copies bound to one exact native owner; retirement archives the full proof
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.commands[0].action, 'prepare')`; `assert.equal(f.commands[0].owner.manager, manager)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('npm and pip get distinct writable copies bound to one exact native owner; retirement archives the full proof', async () => {
  for (const manager of ['npm', 'pip'] as const) {
    const f = await fixture();
    try {
      const allocation = await f.allocate(manager); await allocation.resource.prepare(f.context);
      assert.equal(f.commands[0].action, 'prepare'); assert.equal(f.commands[0].owner.manager, manager);
      assert.equal(f.commands[0].owner.identity.projectId, projectId);
      assert.equal(f.commands[0].owner.owner.runId, f.context.owner.runId);
      assert.equal(f.commands[0].owner.sha256, f.context.sha256);
      assert.equal((await f.records())[0].phase, 'prepared');
      const command = projectCachedInstallCommand(f.project.directory, allocation.directory, manager);
      assert.equal(command.includes('/var/cache/'), false);
      assert.equal(command.includes("cd '/srv/project'"), false);
      assert.match(command, /\/run\/sakura-project-cache-transfers\/[a-f0-9-]{36}\/data/);
      assert.match(command, manager === 'npm' ? /npm ci --offline --ignore-scripts/ : /--no-index --no-build-isolation --only-binary=:all:/);
      await allocation.resource.retire(f.context, f.state.proof);
      assert.deepEqual(await f.records(), []); assert.deepEqual(f.retired, [allocation.stageId]);
      const path = join(f.folder, 'project-cache-transfers', projectId, 'closed', allocation.stageId.slice(0, 2), allocation.stageId + '.json');
      const closed = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(closed.phase, 'closed'); assert.deepEqual(closed.task.run, f.full);
      await assert.rejects(allocation.resource.prepare(f.context));
    } finally { await f.dispose(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost preparation ACK keeps run:null intent, then exact native never-issued proof safely retires the partial copy
 * 状态影响 / State effects: `f.state.lostPrepareAck`, `f.state.proof`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `assert.rejects`, `allocation.resource.prepare`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.prepare(f.context), /ack lost/)`; `assert.equal(intent.phase, 'intent')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('lost preparation ACK keeps run:null intent, then exact native never-issued proof safely retires the partial copy', async () => {
  const f = await fixture(); f.state.lostPrepareAck = true; f.state.proof = { run: null };
  try {
    const allocation = await f.allocate(); await assert.rejects(allocation.resource.prepare(f.context), /ack lost/);
    const intent = (await f.records())[0]; assert.equal(intent.phase, 'intent'); assert.equal(intent.preparation, null);
    await allocation.resource.retire(f.context, f.state.proof);
    assert.deepEqual(await f.records(), []); assert.deepEqual(f.commands.map(value => value.action), ['prepare', 'probe', 'retire']);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: orphan recovery first obtains the original full native closure and never repeats prepare or UID execution
 * 状态影响 / State effects: `f.state.failedRetire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.retire(f.context, f.state.proof))`; `assert.deepEqual(pending.task.run, f.full)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('orphan recovery first obtains the original full native closure and never repeats prepare or UID execution', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    f.state.failedRetire = true; await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    const pending = (await f.records())[0]; assert.deepEqual(pending.task.run, f.full); assert.equal(pending.phase, 'retiring');
    f.state.failedRetire = false; await new ProjectCacheTransfers((f.transfers as any).machines, f.options).recover(f.vmId, projectId);
    assert.deepEqual(await f.records(), []); assert.equal(f.commands.filter(value => value.action === 'prepare').length, 1);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: wrong project, task cgroup name or payload digest cannot retire a prepared copy
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.retire({ ...f.context, sha256: 'd'.repeat(64) }, f.state.proof))`; `assert.rejects(allocation.resource.retire({ ...f.context, identity: { ...f.context.identity, projectId: 'default' } }, f.state.pro…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('wrong project, task cgroup name or payload digest cannot retire a prepared copy', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    await assert.rejects(allocation.resource.retire({ ...f.context, sha256: 'd'.repeat(64) }, f.state.proof));
    await assert.rejects(allocation.resource.retire({ ...f.context, identity: { ...f.context.identity, projectId: 'default' } }, f.state.proof));
    await assert.rejects(allocation.resource.retire(f.context, { run: { ...f.full, cgroupName: 'sakura-task-' + randomUUID() } }));
    assert.equal((await f.records())[0].phase, 'prepared'); assert.equal(f.retired.length, 0);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stage/data inode replacement is rejected before unlink and preserves the original full task proof
 * 状态影响 / State effects: `reply.receipt[field].inode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `f.receipts.get`.
 * 检查边界 / Checked boundaries: `assert.equal(reply.state, 'present')`; `assert.rejects(allocation.resource.retire(f.context, f.state.proof), (e: any) => e.status === 503)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('stage/data inode replacement is rejected before unlink and preserves the original full task proof', async () => {
  for (const field of ['stage', 'data'] as const) {
    const f = await fixture();
    try {
      const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
      const reply = f.receipts.get(allocation.stageId)!; assert.equal(reply.state, 'present');
      if (reply.state === 'present') reply.receipt[field].inode = '99999';
      await assert.rejects(allocation.resource.retire(f.context, f.state.proof), (e: any) => e.status === 503);
      const pending = (await f.records())[0]; assert.deepEqual(pending.task.run, f.full);
      assert.equal(pending.preparation[field].inode, field === 'stage' ? '100' : '101'); assert.equal(f.retired.length, 0);
    } finally { await f.dispose(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a present original/replacement cgroup causes retirement failure while the full pinned proof remains recoverable
 * 状态影响 / State effects: `f.state.groupAbsent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.retire(f.context, f.state.proof))`; `assert.deepEqual(pending.task.run, f.full)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a present original/replacement cgroup causes retirement failure while the full pinned proof remains recoverable', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context); f.state.groupAbsent = false;
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    const pending = (await f.records())[0]; assert.deepEqual(pending.task.run, f.full); assert.equal(pending.phase, 'retiring');
    const count = f.commands.length;
    await assert.rejects(f.transfers.recover(f.vmId, projectId)); assert.equal(f.commands.length, count);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unlink/fsync failure retains the accurate task and cache proof, never closing or overwriting the journal
 * 状态影响 / State effects: `f.state.failedRetire`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.retire(f.context, f.state.proof))`; `assert.equal(first.phase, 'retiring')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('unlink/fsync failure retains the accurate task and cache proof, never closing or overwriting the journal', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context); f.state.failedRetire = true;
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    const first = (await f.records())[0]; assert.equal(first.phase, 'retiring'); assert.deepEqual(first.task.run, f.full);
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof)); assert.deepEqual((await f.records())[0], first);
    f.state.failedRetire = false; await allocation.resource.retire(f.context, f.state.proof); assert.deepEqual(await f.records(), []);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost retirement ACK is recovered from a closed root tombstone without replaying execution or deletion
 * 状态影响 / State effects: `f.options.control`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.retire(f.context, f.state.proof))`; `assert.deepEqual(await f.records(), [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('lost retirement ACK is recovered from a closed root tombstone without replaying execution or deletion', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    const original = f.options.control!; let lost = true;
    f.options.control = /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: args。
     * 结果：返回分支计算值（`reply`），以 Promise 交付。
     * Result: Return the branch-computed value (`reply`) through a Promise.
     * 验证场景 / Scenario: lost retirement ACK is recovered from a closed root tombstone without replaying execution or deletion
     * 状态影响 / State effects: `lost`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('closed ACK lost')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `original`.
     */
    async (...args) => { const reply = await original(...args); if (args[1].action === 'retire' && lost) { lost = false; throw new Error('closed ACK lost'); } return reply; };
    await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    await allocation.resource.retire(f.context, f.state.proof); assert.deepEqual(await f.records(), []);
    assert.equal(f.commands.filter(value => value.action === 'prepare').length, 1);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a retirement transport failure remains cleanup 503 with the original full proof and preserves an existing 503 object
 * 状态影响 / State effects: `f.options.control`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.retire(f.context, f.state.proof), (error: any) => { assert.equal(error.status, 503); assert.equ…`; `assert.equal(record.phase, 'retiring')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a retirement transport failure remains cleanup 503 with the original full proof and preserves an existing 503 object', async () => {
  for (const failure of [new Error('retirement connection lost'), new AppError('original cleanup pending', 503, 'PROJECT_IDENTITY_CLEANUP_FAILED')]) {
    const f = await fixture();
    try {
      const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
      const control = f.options.control!;
      f.options.control = /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: args。
       * 结果：返回分支计算值（`control(...args)`），以 Promise 交付。
       * Result: Return the branch-computed value (`control(...args)`) through a Promise.
       * 验证场景 / Scenario: a retirement transport failure remains cleanup 503 with the original full proof and preserves an existing 503 object
       * 失败 / Failure: `failure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `control`.
       */
      async (...args) => { if (args[1].action === 'retire') throw failure; return control(...args); };
      await assert.rejects(allocation.resource.retire(f.context, f.state.proof), (error: any) => {
        assert.equal(error.status, 503); assert.equal(error.code, 'PROJECT_IDENTITY_CLEANUP_FAILED');
        if (failure instanceof AppError) assert.equal(error, failure);
        return true;
      });
      const record = (await f.records())[0]; assert.equal(record.phase, 'retiring'); assert.deepEqual(record.task.run, f.full);
      assert.equal(f.retired.length, 0);
    } finally { await f.dispose(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: read-only probe and malformed JSON never mutate the host receipt
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `f.records`.
 * 检查边界 / Checked boundaries: `assert.equal(result.state, 'present')`; `assert.equal(await readFile(path, 'utf8'), before)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('read-only probe and malformed JSON never mutate the host receipt', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    const record = (await f.records())[0], path = join(f.folder, 'project-cache-transfers', projectId, allocation.stageId + '.json');
    const before = await readFile(path, 'utf8'); const result = await f.options.control!(f.vmId, { action: 'probe', owner: record.owner });
    assert.equal(result.state, 'present'); assert.equal(await readFile(path, 'utf8'), before);
    await writeFile(path, '{malformed'); await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    assert.equal(await readFile(path, 'utf8'), '{malformed'); assert.equal(f.retired.length, 0);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a missing cache host receipt is reconstructed only from the exact durable original native resource descriptor
 * 状态影响 / State effects: `f.state.failedRetire`, `f.options.scopes!.taskResources`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.allocate`, `allocation.resource.prepare`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(allocation.resource.retire(f.context, f.state.proof))`; `assert.deepEqual(await f.records(), [])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a missing cache host receipt is reconstructed only from the exact durable original native resource descriptor', async () => {
  const f = await fixture();
  try {
    const allocation = await f.allocate(); await allocation.resource.prepare(f.context);
    f.state.failedRetire = true; await assert.rejects(allocation.resource.retire(f.context, f.state.proof));
    await rm(join(f.folder, 'project-cache-transfers', projectId, allocation.stageId + '.json'));
    f.options.scopes!.taskResources = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 验证场景 / Scenario: a missing cache host receipt is reconstructed only from the exact durable original native resource descriptor
     */
    async () => [{ context: f.context, descriptor: allocation.resource.descriptor, active: false }];
    f.state.failedRetire = false;
    await f.transfers.recover(f.vmId, projectId);
    assert.deepEqual(await f.records(), []); assert.equal(f.retired.length, 1);
    assert.equal(f.commands.filter(value => value.action === 'prepare').length, 1);
  } finally { await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real native journals bind both manager copies before issuance and retain the original task through resource retirement
 * 状态影响 / State effects: `machines.get`, `machines.state`, `machines.locked`, `machines.exec`, `f.options.rootDirectory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `setVmStorageRoot`, `scopeIdentityFixture`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(native.inputs.length, 1)`; `assert.equal(native.tickets.size, 1)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('real native journals bind both manager copies before issuance and retain the original task through resource retirement', async () => {
  for (const manager of ['npm', 'pip'] as const) {
    const f = await fixture(), commands: string[] = [];
    const machines = (f.transfers as any).machines as Machines;
    machines.get = /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'alpine' }) as any`）。
     * Result: Return the branch-computed value (`({ distro: 'alpine' }) as any`).
     * 验证场景 / Scenario: real native journals bind both manager copies before issuance and retain the original task through resource retirement
     */
    () => ({ distro: 'alpine' }) as any;
    machines.state = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: real native journals bind both manager copies before issuance and retain the original task through resource retirement
     */
    () => 'running'; machines.locked = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id; action。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 验证场景 / Scenario: real native journals bind both manager copies before issuance and retain the original task through resource retirement
     * 协作入口 / Collaborators: `action`.
     */
    async (_id, action) => action();
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; command。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: real native journals bind both manager copies before issuance and retain the original task through resource retirement
     * 协作入口 / Collaborators: `commands.push`.
     */
    async (_id, command) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; };
    setVmStorageRoot(f.vmId, f.folder);
    const native = scopeIdentityFixture(machines, f.project, () => f.context.owner.bootId, () => null);
    delete f.options.scopes;
    f.options.rootDirectory = join(f.folder, f.vmId);
    f.options.control = /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _id; request。
     * 结果：返回分支计算值（`reply / prepared`），以 Promise 交付。
     * Result: Return the branch-computed value (`reply / prepared`) through a Promise.
     * 验证场景 / Scenario: real native journals bind both manager copies before issuance and retain the original task through resource retirement
     * 失败 / Failure: `new Error('missing exact preparation')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `join`, `JSON.parse`, `readFile`, `journal.runs.find`.
     * 检查边界 / Checked boundaries: `assert.equal(entry.cacheTransfer.stageId, owner.stageId)`; `assert.equal(entry.sha256, owner.sha256)`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    async (_id, request) => {
      const owner = request.owner;
      const journalPath = join(f.folder, f.vmId, 'project-identities', projectId + '.json');
      const journal = JSON.parse(await readFile(journalPath, 'utf8')), entry = journal.runs.find((run: any) => run.runId === owner.owner.runId);
      assert.equal(entry.cacheTransfer.stageId, owner.stageId); assert.equal(entry.sha256, owner.sha256);
      assert.deepEqual(entry.identity, owner.identity);
      f.commands.push(structuredClone(request));
      if (request.action === 'prepare') {
        assert.equal(entry.phase, 'intent'); assert.equal(entry.run, null);
        const reply: ProjectCacheTransferReply = { version: 1, state: 'present', bootId: owner.owner.bootId,
          receipt: { version: 1, phase: 'ready', owner, stage: { device: '7', inode: '100' }, data: { device: '7', inode: '101' },
            manifest: { sha256: 'c'.repeat(64), bytes: 30, nodes: 3 }, task: null } };
        f.receipts.set(owner.stageId, reply); return reply;
      }
      const prepared = f.receipts.get(owner.stageId)!;
      if (request.action === 'probe') return prepared;
      assert.equal(entry.phase, 'closed'); assert.equal(entry.cacheTransfer.phase, 'pending');
      assert.deepEqual(entry.run, request.task?.run); assert.deepEqual(native.tickets.get(owner.owner.runId), request.task?.run);
      assert.equal(request.task?.run?.phase, 'closed'); assert.equal(request.task?.run?.cgroupInode, '23456');
      assert.equal(prepared.state, 'present');
      if (prepared.state !== 'present') throw new Error('missing exact preparation');
      const closed = { ...prepared, receipt: { ...prepared.receipt, phase: 'closed' as const, task: request.task! } };
      f.receipts.set(owner.stageId, closed); return closed;
    };
    const transfers = new ProjectCacheTransfers(machines, f.options);
    try {
      const allocation = await transfers.allocate(f.vmId, f.project, manager, new AbortController().signal, machines.live.get(f.vmId)!);
      await projectIdentityTask(machines, f.vmId, f.project,
        { command: projectCachedInstallCommand(f.project.directory, allocation.directory, manager), environment: { TOKEN: 'cache-private-token' } },
        new AbortController().signal, undefined, 600000, undefined, undefined,
        { expectedLive: machines.live.get(f.vmId), resource: allocation.resource });
      assert.equal(native.inputs.length, 1); assert.equal(native.tickets.size, 1);
      assert.ok(commands.every(command => !command.includes('cache-private-token') && !command.includes('npm ci') && !command.includes('pip install')));
      const ticket = [...native.tickets.values()][0];
      const journal = JSON.parse(await readFile(join(f.folder, f.vmId, 'project-identities', projectId + '.json'), 'utf8'));
      assert.equal(journal.runs[0].phase, 'closed'); assert.equal(journal.runs[0].cacheTransfer.phase, 'closed');
      assert.deepEqual(journal.runs[0].run, ticket); assert.equal(ticket.projectId, projectId);
    } finally { setVmStorageRoot(f.vmId); await f.dispose(); }
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
 * 状态影响 / State effects: `machines.get`, `machines.state`, `machines.locked`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `setVmStorageRoot`, `scopeIdentityFixture`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(projectIdentityTask(machines, f.vmId, f.project, { command: 'true' }, new AbortController().signal, undefined, 6000…`; `assert.equal(journal.runs[0].phase, 'closed')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a live replacement during final resource confirmation retains the pending descriptor and original closed native proof', async () => {
  const f = await fixture(), machines = (f.transfers as any).machines as Machines;
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ distro: 'alpine' }) as any`）。
   * Result: Return the branch-computed value (`({ distro: 'alpine' }) as any`).
   * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
   */
  () => ({ distro: 'alpine' }) as any;
  machines.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
   */
  () => 'running'; machines.locked = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _id; action。
   * 结果：返回分支计算值（`action()`），以 Promise 交付。
   * Result: Return the branch-computed value (`action()`) through a Promise.
   * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
   * 协作入口 / Collaborators: `action`.
   */
  async (_id, action) => action();
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: '', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: '', stderr: '' })`) through a Promise.
   * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
   */
  async () => ({ code: 0, stdout: '', stderr: '' });
  setVmStorageRoot(f.vmId, f.folder);
  const native = scopeIdentityFixture(machines, f.project, () => f.context.owner.bootId, () => null);
  try {
    await assert.rejects(projectIdentityTask(machines, f.vmId, f.project, { command: 'true' },
      new AbortController().signal, undefined, 600000, undefined, undefined, {
        expectedLive: machines.live.get(f.vmId), resource: {
          descriptor: { stageId: randomUUID(), manager: 'npm', build: 'a'.repeat(64) },
          /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
           */
          prepare: async () => {},
          /**
           * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
           * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
           * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
           */
          retire: async () => {
            const original = machines.exec;
            machines.exec = /**
             * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
             * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
             * 输入 / Inputs: args。
             * 结果：返回分支计算值（`result`），以 Promise 交付。
             * Result: Return the branch-computed value (`result`) through a Promise.
             * 验证场景 / Scenario: a live replacement during final resource confirmation retains the pending descriptor and original closed native proof
             * 协作入口 / Collaborators: `original`, `args[1].includes`, `machines.live.set`.
             */
            async (...args) => {
              const result = await original(...args);
              if (args[1].includes('assert not os.path.lexists') && args[1].includes('sakura-task-'))
                machines.live.set(f.vmId, { startedAt: 'replacement' } as any);
              return result;
            };
          },
        },
      }), (error: any) => error.status === 503);
    const journal = JSON.parse(await readFile(join(f.folder, f.vmId, 'project-identities', projectId + '.json'), 'utf8'));
    assert.equal(journal.runs[0].phase, 'closed');
    assert.equal(journal.runs[0].cacheTransfer.phase, 'pending');
    assert.deepEqual(journal.runs[0].run, [...native.tickets.values()][0]);
    assert.equal(journal.runs[0].run.phase, 'closed');
    assert.equal(native.inputs.length, 1);
  } finally { setVmStorageRoot(f.vmId); await f.dispose(); }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: actual root controller compiles and its POSIX model exercises source links, bounds, lost ACK, inode and fsync failures
 * 协作入口 / Collaborators: `fileURLToPath`, `spawnSync`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(output.error, undefined)`; `assert.equal(output.status, 0, output.stderr)`.
 */
test('actual root controller compiles and its POSIX model exercises source links, bounds, lost ACK, inode and fsync failures', () => {
  const path = fileURLToPath(new URL('./project-cache-transfer-control-model.py', import.meta.url));
  const output = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python', ['-I', '-S', path], {
    input: projectCacheTransferControl, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  assert.equal(output.error, undefined); assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout); assert.ok(result.tests >= 15);
  assert.deepEqual(result.limits, { file: projectCacheTransferLimits.fileBytes, total: projectCacheTransferLimits.totalBytes,
    nodes: projectCacheTransferLimits.nodes, depth: projectCacheTransferLimits.depth });
});
