/**
 * 模块职责：回归验证模块，围绕 `operation-gateway` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `operation-gateway`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: resolved admission and media rejections identify a handler that never executed, while business failures cannot inherit that marker; all actual declarations resolve exactly and HTTP documentation shares their authority.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../shared/errors.ts';
import { PLUGINS } from '../shared/plugins.ts';
import { OperationGateway, validateOperationInput, operationPreflightFailure } from '../server/operation-gateway.ts';
import { createOperationAuthority } from '../server/operation-authority.ts';
import { operationEntries } from '../server/operation-catalog.ts';
import { apiDocument } from '../server/openapi.ts';
import { captureOperationCheck } from '../server/operation-context.ts';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { resourceContext } from '../server/host-runtime/context.ts';
import { vmLifetime } from '../server/vm-lifetime.ts';
import type { Machines } from '../server/machines.ts';
import type { Principal } from '../server/access-control.ts';
import { hostRuntimeDiagnosticSchema, networkRuntimeDiagnosticSchema } from '../shared/contracts/operations.ts';
import { networkRuntime } from '../server/network/index.ts';
import { metadataQueueSnapshot } from '../server/metadata-queue.ts';
import { backupRecoverySchema } from '../shared/backup-recovery.ts';
import { ZodError } from 'zod';

const vmId = 'd2f574eb-44c5-40b8-a2ac-581b56cb4a12';
const otherProject = '1234567890abcdef';
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: method = 'GET'; token = 'credential'。
 * 结果：返回分支计算值（`({ method, headers: { 'x-sakura-token': token } }) as unknown as IncomingMessage`）。
 * Result: Return the branch-computed value (`({ method, headers: { 'x-sakura-token': token } }) as unknown as IncomingMessage`).
 */
const req = (method = 'GET', token = 'credential') => ({ method,
  headers: { 'x-sakura-token': token } }) as unknown as IncomingMessage;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: path: string。
 * 结果：返回分支计算值（`new URL(path, 'http://localhost:7337')`）。
 * Result: Return the branch-computed value (`new URL(path, 'http://localhost:7337')`).
 */
const url = (path: string) => new URL(path, 'http://localhost:7337');

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resolved admission and media rejections identify a handler that never executed, while business failures cannot inherit that marker
 * 状态影响 / State effects: `allowed`, `request.headers['content-type']`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `operationEntries.find`, `gateway.register`, `gateway.seal`, `req`.
 * 检查边界 / Checked boundaries: `assert.rejects(gateway.dispatch(request, response, url(entry.declaration.path)), error => error === original)`; `assert.equal(operationPreflightFailure(original), entry.declaration.id)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('resolved admission and media rejections identify a handler that never executed, while business failures cannot inherit that marker', async () => {
  const entry = operationEntries.find(item => item.declaration.id === 'core.access.password')!;
  const original = new AppError('private credential details', 403, 'REVOKED');
  let allowed = false, executions = 0;
  const gateway = new OperationGateway({ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: resolved admission and media rejections identify a handler that never executed, while business failures cannot inherit that marker
   */
  enabled: () => [], /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ check: async () => { if (!allowed) throw original; return 'owner'; } })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ check: async () => { if (!allowed) throw original; return 'owner'; } })`) through a Promise.
   * 验证场景 / Scenario: resolved admission and media rejections identify a handler that never executed, while business failures cannot inherit that marker
   */
  bind: async () => ({ /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'owner'`），以 Promise 交付。
   * Result: Return the branch-computed value (`'owner'`) through a Promise.
   * 验证场景 / Scenario: resolved admission and media rejections identify a handler that never executed, while business failures cannot inherit that marker
   * 失败 / Failure: `original`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  check: async () => {
    if (!allowed) throw original; return 'owner';
  } }) }, [entry]);
  gateway.register(entry, () => { executions++; throw original; }); gateway.seal();
  const request = req('POST'), response = {} as ServerResponse;
  await assert.rejects(gateway.dispatch(request, response, url(entry.declaration.path)), error => error === original);
  assert.equal(operationPreflightFailure(original), entry.declaration.id); assert.equal(executions, 0);
  allowed = true;
  await assert.rejects(gateway.dispatch(request, response, url(entry.declaration.path)), (error: any) => {
    assert.equal(error.code, 'UNSUPPORTED_MEDIA_TYPE');
    return operationPreflightFailure(error) === entry.declaration.id;
  });
  assert.equal(executions, 0);
  request.headers['content-type'] = 'application/json';
  await assert.rejects(gateway.dispatch(request, response, url(entry.declaration.path)), error => error === original);
  assert.equal(executions, 1); assert.equal(operationPreflightFailure(original), undefined);
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: role: Principal['role'] = 'owner'。
 * 结果：返回受控对象，公开字段包括 `gateway, machines, live, enabled, migration, revoke, lock, revokeProject, switchProject`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `gateway, machines, live, enabled, migration, revoke, lock, revokeProject, switchProject`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `PLUGINS.map`, `createOperationAuthority`.
 */
function fixture(role: Principal['role'] = 'owner') {
  let allowed = true, locked = false, projectAllowed = true, active = 'default', approved = false;
  let roleNow = role;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id: 'actor', username: 'actor', role: roleNow, vmIds: [vmId], expiresAt: Date…`）。
   * Result: Return the branch-computed value (`({ id: 'actor', username: 'actor', role: roleNow, vmIds: [vmId], expiresAt: Date…`).
   * 协作入口 / Collaborators: `Date.now`.
   */
  const principal = (): Principal => ({ id: 'actor', username: 'actor', role: roleNow, vmIds: [vmId], expiresAt: Date.now() + 60_000 });
  const live = { abort: new AbortController() } as any;
  const records = new Map([[vmId, {}]]);
  const machines = { records, live: new Map([[vmId, live]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`records.get(id)`）。
     * Result: Return the branch-computed value (`records.get(id)`).
     * 失败 / Failure: `new AppError('Missing VM', 404)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `records.has`, `records.get`.
     */
    get(id: string) { if (!records.has(id)) throw new AppError('Missing VM', 404); return records.get(id); },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked() {},
  } as unknown as Machines;
  const enabled = new Set(PLUGINS.map(plugin => plugin.id));
  const migration = { blocked: false };
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ active, projects: [{ id: 'default', name: 'default' }, { id: otherProject, na…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ active, projects: [{ id: 'default', name: 'default' }, { id: otherProject, na…`) through a Promise.
   */
  const list = async () => ({ active, projects: [{ id: 'default', name: 'default' }, { id: otherProject, name: 'other' }] });
  let extensionAllowed = true;
  const bind = createOperationAuthority({ machines, features: { enabled, migration } as any,
    access: { enabled: true, /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: token: unknown。
     * 结果：返回分支计算值（`principal()`）。
     * Result: Return the branch-computed value (`principal()`).
     * 失败 / Failure: `new AppError('Revoked', 401, 'REVOKED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `principal`.
     */
    authorize(token: unknown) {
      if (!allowed || token !== 'credential') throw new AppError('Revoked', 401, 'REVOKED');
      return principal();
    } },
    session: { /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new AppError('Locked', 423)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    requireUnlocked() { if (locked) throw new AppError('Locked', 423); } },
    projectPermissions: {
      /**
       * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
       * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 失败 / Failure: `new AppError('Project permission revoked', 403, 'PROJECT_REVOKED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      async require() { if (!projectAllowed) throw new AppError('Project permission revoked', 403, 'PROJECT_REVOKED'); },
      /**
       * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
       * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 失败 / Failure: `new AppError('Project permission revoked', 403, 'PROJECT_REVOKED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      async requireCommitted() { if (!projectAllowed) throw new AppError('Project permission revoked', 403, 'PROJECT_REVOKED'); },
      /**
       * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
       * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`approved`）。
       * Result: Return the branch-computed value (`approved`).
       */
      requiresApproval: () => approved,
    },
    browserExtensions: { /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`{} as any`）。
     * Result: Return the branch-computed value (`{} as any`).
     * 失败 / Failure: `new AppError('Extension revoked', 403)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    authorize() { if (!extensionAllowed) throw new AppError('Extension revoked', 403); return {} as any; } },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`allowed`）。
     * Result: Return the branch-computed value (`allowed`).
     */
    equalToken: () => allowed,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`allowed ? principal() : null`）。
     * Result: Return the branch-computed value (`allowed ? principal() : null`).
     * 协作入口 / Collaborators: `principal`.
     */
    socketAuthorization: () => allowed ? principal() : null,
    projects: { list, readCommittedList: list },
  });
  return { gateway: new OperationGateway({ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`enabled`）。
   * Result: Return the branch-computed value (`enabled`).
   */
  enabled: () => enabled, bind }), machines, live, enabled, migration,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `allowed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    revoke: () => { allowed = false; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `locked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    lock: () => { locked = true; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `projectAllowed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    revokeProject: () => { projectAllowed = false; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `active`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    switchProject: () => { active = otherProject; },
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `approved`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    requireApproval: () => { approved = true; }, /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: Principal['role']。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `roleNow`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    role: (value: Principal['role']) => { roleNow = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `extensionAllowed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    revokeExtension: () => { extensionAllowed = false; } };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all actual declarations resolve exactly and HTTP documentation shares their authority
 * 协作入口 / Collaborators: `fixture`, `apiDocument`, `declaration.path.replace`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.gateway.resolve(declaration.method, path).entry.declaration.id, declaration.id)`; `assert.deepEqual( spec.paths[declaration.path][declaration.method.toLowerCase()]['x-sakura-operation'], { ...declaration, enabled:…`.
 */
test('all actual declarations resolve exactly and HTTP documentation shares their authority', () => {
  const f = fixture(), spec = apiDocument(f.enabled, 7337);
  for (const { declaration } of operationEntries) {
    const path = declaration.path.replace(/\{([^}]+)\}/g, (_, name) => name === 'vmId' ? vmId : 'sample');
    assert.equal(f.gateway.resolve(declaration.method, path).entry.declaration.id, declaration.id);
    if (declaration.method !== 'UPGRADE') assert.deepEqual(
      spec.paths[declaration.path][declaration.method.toLowerCase()]['x-sakura-operation'],
      { ...declaration, enabled: true });
  }
  assert.throws(() => f.gateway.resolve('GET', '/api/vms/' + vmId + '/commands/undeclared'), { code: 'OPERATION_NOT_FOUND' });
  assert.throws(() => f.gateway.resolve('GET', '/api/vms/' + vmId + '/commands/%2f'), { code: 'OPERATION_NOT_FOUND' });
  assert.throws(() => f.gateway.resolve('POST', '/api/images'), { status: 405 });
  assert.throws(() => f.gateway.resolve('DELETE', '/api/vms/batch'), { status: 405 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: diagnostic contracts accept the real runtime resource association shapes
 * 协作入口 / Collaborators: `host.register`, `hostRuntimeDiagnosticSchema.parse`, `host.snapshot`, `metadataQueueSnapshot`.
 */
test('diagnostic contracts accept the real runtime resource association shapes', () => {
  const host = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const lease = host.register({ owner: 'test:diagnostic', kind: 'operation', label: 'scope' });
  hostRuntimeDiagnosticSchema.parse({ ...host.snapshot(), schedules: [], metadata: metadataQueueSnapshot() });
  networkRuntimeDiagnosticSchema.parse(networkRuntime.snapshot());
  lease.release(); host.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GET requires an explicit role and member projects must be named and currently authorized
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.gateway.prepare`, `req`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.gateway.prepare(req(), url('/api/host-runtime')), { status: 403 })`; `assert.rejects(f.gateway.prepare(req(), url(`/api/vms/${vmId}/project`)), { status: 400 })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('GET requires an explicit role and member projects must be named and currently authorized', async () => {
  const f = fixture('viewer');
  await assert.rejects(f.gateway.prepare(req(), url('/api/host-runtime')), { status: 403 });
  await f.gateway.prepare(req(), url('/api/access/view'));
  f.role('member');
  await assert.rejects(f.gateway.prepare(req(), url(`/api/vms/${vmId}/project`)), { status: 400 });
  const a = await f.gateway.prepare(req(), url(`/api/vms/${vmId}/project?project=default`));
  f.revokeProject();
  await assert.rejects(a.check(), { code: 'PROJECT_REVOKED' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM lifecycle queries accept the selected project hint without changing scope or role grants
 * 协作入口 / Collaborators: `fixture`, `f.revokeProject`, `f.gateway.prepare`, `req`.
 * 检查边界 / Checked boundaries: `assert.equal(admitted.declaration.projectScoped, false)`; `assert.equal(admitted.declaration.projectBinding, 'none')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('VM lifecycle queries accept the selected project hint without changing scope or role grants', async () => {
  const f = fixture();
  f.revokeProject();
  const path = `/api/vms/${vmId}/files?path=%2Fworkspace&project=default`;
  const admitted = await f.gateway.prepare(req(), url(path));
  assert.equal(admitted.declaration.projectScoped, false);
  assert.equal(admitted.declaration.projectBinding, 'none');
  await admitted.check();
  await f.gateway.prepare(req(), url(`/api/vms/${vmId}/files?path=&project=${otherProject}`));
  for (const query of ['path=%2Fworkspace&project=arbitrary', 'path=%2Fworkspace&project=default&unknown=1'])
    await assert.rejects(f.gateway.prepare(req(), url(`/api/vms/${vmId}/files?${query}`)), ZodError);
  await assert.rejects(f.gateway.prepare(req(), url('/api/network-profiles?project=default')), ZodError);
  f.role('member');
  await assert.rejects(f.gateway.prepare(req(), url(path)), { status: 403 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resource queues recheck captured credentials, return their slot, and preserve control cleanup
 * 状态影响 / State effects: `request.headers['x-sakura-token']`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `runtime.acquire`, `req`, `f.gateway.prepare`.
 * 检查边界 / Checked boundaries: `assert.rejects(queued, { code: 'REVOKED' })`; `assert.equal(runtime.snapshot().resources.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('resource queues recheck captured credentials, return their slot, and preserve control cleanup', async () => {
  const f = fixture(), runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
  const resource = { owner: 'test:gateway', kind: 'test', label: 'queued', cost: { jobs: 1 } };
  const held = await runtime.acquire(resource);
  const request = req(), admission = await f.gateway.prepare(request, url('/api/system'));
  const queued = admission.run(() => runtime.acquire(resource));
  const rejected = assert.rejects(queued, { code: 'REVOKED' });
  request.headers['x-sakura-token'] = 'replacement';
  f.revoke(); held.release(); await rejected;
  assert.equal(runtime.snapshot().resources.length, 0);
  await admission.run(async () => { (await runtime.acquire({ ...resource, lane: 'control' })).release(); });
  runtime.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disabled plugins retain 403 before VM lookup, after credential and session checks
 * 协作入口 / Collaborators: `fixture`, `req`, `f.enabled.delete`, `f.machines.records.delete`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.gateway.prepare(request, url(`/api/vms/${vmId}/backup-recovery`)), { status: state === 'disabled' ? 403 : state =…`.
 */
test('disabled plugins retain 403 before VM lookup, after credential and session checks', async () => {
  for (const state of ['disabled', 'unauthenticated', 'locked'] as const) {
    const f = fixture(), request = req();
    f.enabled.delete('backups');
    f.machines.records.delete(vmId);
    if (state === 'unauthenticated') delete request.headers['x-sakura-token'];
    if (state === 'locked') f.lock();
    await assert.rejects(f.gateway.prepare(request, url(`/api/vms/${vmId}/backup-recovery`)), {
      status: state === 'disabled' ? 403 : state === 'unauthenticated' ? 401 : 423,
      ...(state === 'disabled' ? { message: '请在插件中心启用插件「backups」，并重启 Sakura 服务' } : {}),
    });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: queued plugin checks preserve credential and session priority when the plugin unloads
 * 协作入口 / Collaborators: `fixture`, `runtime.acquire`, `f.gateway.prepare`, `req`.
 * 检查边界 / Checked boundaries: `assert.rejects(queued, { status: state === 'disabled' ? 403 : state === 'revoked' ? 401 : 423, })`; `assert.equal(runtime.snapshot().resources.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('queued plugin checks preserve credential and session priority when the plugin unloads', async () => {
  for (const state of ['disabled', 'revoked', 'locked'] as const) {
    const f = fixture(), runtime = new HostRuntime({ budgets: { jobs: { capacity: 1 } } });
    const resource = { owner: 'test:plugin-authority', kind: 'test', label: 'queued', cost: { jobs: 1 } };
    const held = await runtime.acquire(resource);
    const admission = await f.gateway.prepare(req(), url(`/api/vms/${vmId}/backup-recovery`));
    const queued = admission.run(() => runtime.acquire(resource));
    const refused = assert.rejects(queued, {
      status: state === 'disabled' ? 403 : state === 'revoked' ? 401 : 423,
    });
    f.enabled.delete('backups');
    if (state === 'revoked') f.revoke();
    if (state === 'locked') f.lock();
    held.release();
    await refused;
    assert.equal(runtime.snapshot().resources.length, 0);
    runtime.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: typed plugin input validation precedes its domain lookup for a missing VM
 * 协作入口 / Collaborators: `fixture`, `f.machines.records.delete`, `assert.rejects`, `dispatch`.
 * 检查边界 / Checked boundaries: `assert.rejects(dispatch({ backupId: vmId, paths: ['../outside'] }), (error) => error instanceof ZodError)`; `assert.rejects(dispatch({ backupId: vmId, paths: ['workspace/readme'] }), { status: 404 })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('typed plugin input validation precedes its domain lookup for a missing VM', async () => {
  const f = fixture(), target = `/api/vms/${vmId}/backup-recovery`;
  f.machines.records.delete(vmId);
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: input: unknown。
   * 结果：返回分支计算值（`f.gateway.run(req('POST'), url(target), async () => { // Features.route validate…`）。
   * Result: Return the branch-computed value (`f.gateway.run(req('POST'), url(target), async () => { // Features.route validate…`).
   * 验证场景 / Scenario: typed plugin input validation precedes its domain lookup for a missing VM
   * 协作入口 / Collaborators: `f.gateway.run`, `req`, `url`.
   */
  const dispatch = (input: unknown) => f.gateway.run(req('POST'), url(target), async () => {
    // Features.route validates this declared schema before invoking the domain operation.
    backupRecoverySchema.parse(await validateOperationInput(input));
    return f.machines.get(vmId);
  });
  await assert.rejects(dispatch({ backupId: vmId, paths: ['../outside'] }), (error) => error instanceof ZodError);
  await assert.rejects(dispatch({ backupId: vmId, paths: ['workspace/readme'] }), { status: 404 });
  await assert.rejects(f.gateway.run(req(), url(target), () => f.machines.get(vmId)), { status: 404 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: project scope is pinned at admission while lifecycle operations can advance their own VM
 * 协作入口 / Collaborators: `fixture`, `url`, `f.gateway.prepare`, `req`.
 * 检查边界 / Checked boundaries: `assert.equal(target.searchParams.get('project'), 'default')`; `assert.equal(a.run(() => resourceContext()?.projectId), 'default')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('project scope is pinned at admission while lifecycle operations can advance their own VM', async () => {
  const f = fixture(), target = url(`/api/vms/${vmId}/commands`);
  const a = await f.gateway.prepare(req('POST'), target);
  f.switchProject(); await a.check();
  assert.equal(target.searchParams.get('project'), 'default');
  assert.equal(a.run(() => resourceContext()?.projectId), 'default');
  vmLifetime(vmId, f.live).advanceExecution();
  await assert.rejects(a.check(), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const start = await f.gateway.prepare(req('POST'), url(`/api/vms/${vmId}/start`));
  f.machines.live.set(vmId, { abort: new AbortController() } as any);
  await start.check();
  f.machines.records.delete(vmId); // Delete can still complete its metadata cleanup after the record goes away.
  await start.check();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: body-dependent instance execution keeps its no-project protocol, project execution captures a project
 * 协作入口 / Collaborators: `fixture`, `url`, `f.gateway.run`, `req`.
 * 检查边界 / Checked boundaries: `assert.equal(target.searchParams.has('project'), false)`; `assert.equal(target.searchParams.get('project'), 'default')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('body-dependent instance execution keeps its no-project protocol, project execution captures a project', async () => {
  const f = fixture(), target = url(`/api/vms/${vmId}/exec`);
  await f.gateway.run(req('POST'), target, () => validateOperationInput({ command: 'true', scope: 'instance' }));
  assert.equal(target.searchParams.has('project'), false);
  await f.gateway.run(req('POST'), target, () => validateOperationInput({ command: 'true' }));
  assert.equal(target.searchParams.get('project'), 'default');
  await assert.rejects(f.gateway.run(req('POST'), target, () => validateOperationInput({ command: 1 })));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: plugin unload, maintenance, approval changes and session lock revoke queued operations
 * 状态影响 / State effects: `f.migration.blocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.gateway.prepare`, `req`, `url`.
 * 检查边界 / Checked boundaries: `assert.rejects(a.check())`.
 */
test('plugin unload, maintenance, approval changes and session lock revoke queued operations', async () => {
  for (const change of ['unload', 'maintenance', 'approval', 'lock'] as const) {
    const f = fixture();
    const a = await f.gateway.prepare(req('PUT'), url(`/api/vms/${vmId}/project?project=default`));
    if (change === 'unload') f.enabled.delete('projects');
    if (change === 'maintenance') f.migration.blocked = true;
    if (change === 'approval') f.requireApproval();
    if (change === 'lock') f.lock();
    await assert.rejects(a.check());
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: locked public unlock and callback adapters retain protocol handling, protected public routes reject
 * 状态影响 / State effects: `f.migration.blocked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.lock`, `f.gateway.prepare`, `req`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.gateway.prepare(req(), url('/api/bootstrap')), { status: 423 })`; `assert.rejects(f.gateway.prepare(req(), url('/api/downloads/ticket')), { status: 423 })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('locked public unlock and callback adapters retain protocol handling, protected public routes reject', async () => {
  const f = fixture(); f.lock(); f.migration.blocked = true;
  for (const path of ['/api/session/unlock', '/api/session/unlock/passkey/options', '/api/session/unlock/passkey/verify', '/api/access/sso/saml/callback'])
    await f.gateway.prepare(req('POST'), url(path));
  await f.gateway.prepare(req(), url('/api/session'));
  await assert.rejects(f.gateway.prepare(req(), url('/api/bootstrap')), { status: 423 });
  await assert.rejects(f.gateway.prepare(req(), url('/api/downloads/ticket')), { status: 423 });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: special extension and socket credentials remain live checks after stream admission
 * 状态影响 / State effects: `request.headers.origin`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `req`, `'a'.repeat`, `f.gateway.prepare`.
 * 检查边界 / Checked boundaries: `assert.rejects(extension.check(), { status: 403 })`; `assert.rejects(check(), { status: 403 })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('special extension and socket credentials remain live checks after stream admission', async () => {
  const f = fixture(), request = req();
  request.headers.origin = 'chrome-extension://' + 'a'.repeat(32);
  const extension = await f.gateway.prepare(request, url('/api/extension/inventory'));
  f.revokeExtension(); await assert.rejects(extension.check(), { status: 403 });
  const socket = await f.gateway.prepare(req(), url(`/ws/${vmId}/terminal?token=credential`), 'UPGRADE');
  const check = socket.run(() => captureOperationCheck());
  f.revoke(); await assert.rejects(check(), { status: 403 });
});
