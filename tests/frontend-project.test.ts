/**
 * 模块职责：回归验证模块，围绕 `frontend-project` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `frontend-project`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: workspace-scoped requests carry the selected development project; an active project action waits for boot and installation before saving and starting.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { VMView } from '../server/model.ts';
import type { Project } from '../server/workspaces.ts';
import type { Request } from '../src/feature-shared.tsx';
import { executeProjectAction } from '../src/project-action.ts';
import { workspacePath, workspaceRequest } from '../src/workspace-request.ts';

const vm = { id: 'test-vm', status: 'running' } as VMView;
const project: Project = {
  template: 'node',
  directory: '/workspace',
  repository: '',
  setup: 'npm install',
  command: 'npm start',
};

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: workspace-scoped requests carry the selected development project
 * 协作入口 / Collaborators: `assert.equal`, `workspacePath`, `workspaceRequest(base, '0123456789abcdef')`, `workspaceRequest`.
 * 检查边界 / Checked boundaries: `assert.equal( workspacePath('/vms/test-vm/advanced', '0123456789abcdef'), '/vms/test-vm/advanced?project=0123456789abcdef', )`; `assert.equal( workspacePath('/vms/test-vm/git?path=src%2Fmain.ts&staged=1', 'fedcba9876543210'), '/vms/test-vm/git?path=src%2Fmain…`.
 */
test('workspace-scoped requests carry the selected development project', async () => {
  assert.equal(
    workspacePath('/vms/test-vm/advanced', '0123456789abcdef'),
    '/vms/test-vm/advanced?project=0123456789abcdef',
  );
  assert.equal(
    workspacePath('/vms/test-vm/git?path=src%2Fmain.ts&staged=1', 'fedcba9876543210'),
    '/vms/test-vm/git?path=src%2Fmain.ts&staged=1&project=fedcba9876543210',
  );
  assert.equal(
    workspacePath('/vms/test-vm/project?project=default', '0123456789abcdef'),
    '/vms/test-vm/project?project=0123456789abcdef',
  );
  assert.equal(workspacePath('/vms/test-vm/advanced', undefined), '/vms/test-vm/advanced');
  assert.equal(workspacePath('/vms/test-vm/files?path=%2Fworkspace', 'default'),
    '/vms/test-vm/files?path=%2Fworkspace&project=default');
  assert.equal(workspacePath('/api/vms/test-vm/files?path=', 'default'),
    '/api/vms/test-vm/files?path=&project=default');
  assert.equal(workspacePath('/access/terminal-shares?vmId=test-vm', 'default'),
    '/access/terminal-shares?vmId=test-vm&project=default');
  for (const path of ['/jobs/test-job/result', '/jobs/test-job/cancel', '/recipes', '/network-profiles', '/images'])
    assert.equal(workspacePath(path, 'default'), path, path);

  const calls: { path: string; method?: string; body?: unknown; signal?: AbortSignal }[] = [];
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: path: string; method: string; body: unknown; signal: AbortSignal。
   * 结果：返回分支计算值（`{ ok: true } as T`），以 Promise 交付。
   * Result: Return the branch-computed value (`{ ok: true } as T`) through a Promise.
   * 验证场景 / Scenario: workspace-scoped requests carry the selected development project
   * 协作入口 / Collaborators: `calls.push`.
   */
  const base = async <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => {
    calls.push({ path, method, body, signal });
    return { ok: true } as T;
  };
  const signal = new AbortController().signal;
  await workspaceRequest(base, '0123456789abcdef')(
    '/vms/test-vm/advanced',
    'POST',
    { action: 'sample' },
    signal,
  );
  assert.deepEqual(calls[0], {
    path: '/vms/test-vm/advanced?project=0123456789abcdef',
    method: 'POST',
    body: { action: 'sample' },
    signal,
  });
  await workspaceRequest(base, 'default')('/jobs/test-job/cancel', 'POST', undefined, signal);
  assert.deepEqual(calls[1], { path: '/jobs/test-job/cancel', method: 'POST', body: undefined, signal });
});

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function deferred<T>() {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: value: T。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const boundary of ['boot', 'installation', 'refresh', 'save'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `deferred`, `executeProjectAction`, `abort.abort`, `response.resolve`.
   * 检查边界 / Checked boundaries: `assert.rejects(running, { name: 'AbortError' })`; `assert.ok(!calls.includes('POST /vms/test-vm/project'), 'no new job is started')`.
   */
  test(`leaving the project during ${boundary} cannot submit later configuration or start a job`, async () => {
    const abort = new AbortController();
    const reached = deferred<void>();
    const response = deferred<unknown>();
    const calls: string[] = [];
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: path: string; method = 'GET'; _body: unknown; signal: AbortSignal。
     * 结果：返回分支计算值（`(await response.promise) as T / (path === '/vms/test-vm' ? vm : { job: null }) as T`），以 Promise 交付。
     * Result: Return the branch-computed value (`(await response.promise) as T / (path === '/vms/test-vm' ? vm : { job: null }) as T`) through a Promise.
     * 协作入口 / Collaborators: `assert.equal`, `calls.push`, `path.endsWith`, `reached.resolve`.
     * 检查边界 / Checked boundaries: `assert.equal(signal, abort.signal)`.
     */
    const request: Request = async <T>(
      path: string,
      method = 'GET',
      _body?: unknown,
      signal?: AbortSignal,
    ) => {
      assert.equal(signal, abort.signal);
      calls.push(`${method} ${path}`);
      if (
        (boundary === 'boot' && path === '/vms/test-vm') ||
        (boundary === 'installation' && path.endsWith('/project') && method === 'GET') ||
        (boundary === 'save' && method === 'PUT')
      ) {
        reached.resolve();
        // Deliberately ignore cancellation here to model a response already
        // queued when the effect cleanup aborts the request.
        return (await response.promise) as T;
      }
      return (path === '/vms/test-vm' ? vm : { job: null }) as T;
    };
    const running = executeProjectAction({
      request,
      vm: { ...vm, status: 'stopped' },
      project,
      kind: 'start',
      signal: abort.signal,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `calls.push`, `reached.resolve`.
       */
      refresh: async () => {
        calls.push('refresh');
        if (boundary === 'refresh') {
          reached.resolve();
          await response.promise;
        }
      },
    });
    await reached.promise;
    abort.abort();
    response.resolve(boundary === 'boot' ? vm : { job: null });
    await assert.rejects(running, { name: 'AbortError' });
    assert.ok(!calls.includes('POST /vms/test-vm/project'), 'no new job is started');
    if (boundary !== 'save')
      assert.ok(!calls.includes('PUT /vms/test-vm/project'), 'old draft is never written');
    if (boundary === 'boot') assert.ok(!calls.includes('refresh'));
    if (boundary === 'refresh') assert.ok(!calls.includes('GET /vms/test-vm/project'));
  });
}

for (const phase of ['boot', 'installation'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `t.mock.timers.enable`, `deferred`, `executeProjectAction`, `Promise.resolve`.
   * 检查边界 / Checked boundaries: `assert.rejects(running, { name: 'AbortError' })`; `assert.equal(calls.length, count)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`cancelling the ${phase} polling delay stops immediately and releases its timer`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const abort = new AbortController();
    const calls: string[] = [];
    const reached = deferred<void>();
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: path: string; method = 'GET'。
     * 结果：返回分支计算值（`{ status: 'starting' } as T / { job: { status: 'running' } } as T`），以 Promise 交付。
     * Result: Return the branch-computed value (`{ status: 'starting' } as T / { job: { status: 'running' } } as T`) through a Promise.
     * 协作入口 / Collaborators: `calls.push`, `reached.resolve`, `path.endsWith`.
     */
    const request: Request = async <T>(path: string, method = 'GET') => {
      calls.push(`${method} ${path}`);
      if (phase === 'boot' && path === '/vms/test-vm') {
        reached.resolve();
        return { status: 'starting' } as T;
      }
      if (phase === 'installation' && path.endsWith('/project')) {
        reached.resolve();
        return { job: { status: 'running' } } as T;
      }
      return vm as T;
    };
    const running = executeProjectAction({
      request,
      vm,
      project,
      kind: 'start',
      signal: abort.signal,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      refresh: async () => {},
    });
    await reached.promise;
    await Promise.resolve();
    abort.abort();
    await assert.rejects(running, { name: 'AbortError' });
    const count = calls.length;
    t.mock.timers.tick(1200000);
    assert.equal(calls.length, count);
    assert.ok(calls.every((call) => call.startsWith('GET ')));
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an active project action waits for boot and installation before saving and starting
 * 协作入口 / Collaborators: `executeProjectAction`, `assert.deepEqual`, `calls.map`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( calls.map(({ method, path }) => `${method} ${path}`), [ 'POST /vms/test-vm/start', 'GET /vms/test-vm', ' refresh…`; `assert.equal(calls[4].body, project)`.
 */
test('an active project action waits for boot and installation before saving and starting', async () => {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const abort = new AbortController();
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: path: string; method = 'GET'; body: unknown; signal: AbortSignal。
   * 结果：返回分支计算值（`(path === '/vms/test-vm' ? vm : { job: null }) as T`），以 Promise 交付。
   * Result: Return the branch-computed value (`(path === '/vms/test-vm' ? vm : { job: null }) as T`) through a Promise.
   * 验证场景 / Scenario: an active project action waits for boot and installation before saving and starting
   * 协作入口 / Collaborators: `assert.equal`, `calls.push`.
   * 检查边界 / Checked boundaries: `assert.equal(signal, abort.signal)`.
   */
  const request: Request = async <T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => {
    assert.equal(signal, abort.signal);
    calls.push({ path, method, body });
    return (path === '/vms/test-vm' ? vm : { job: null }) as T;
  };
  await executeProjectAction({
    request,
    vm: { ...vm, status: 'stopped' },
    project,
    kind: 'start',
    signal: abort.signal,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: an active project action waits for boot and installation before saving and starting
     * 协作入口 / Collaborators: `calls.push`.
     */
    refresh: async () => {
      calls.push({ path: 'refresh', method: '' });
    },
  });
  assert.deepEqual(
    calls.map(({ method, path }) => `${method} ${path}`),
    [
      'POST /vms/test-vm/start',
      'GET /vms/test-vm',
      ' refresh',
      'GET /vms/test-vm/project',
      'PUT /vms/test-vm/project',
      'POST /vms/test-vm/project',
    ],
  );
  assert.equal(calls[4].body, project);
  assert.deepEqual(calls[5].body, { action: 'start' });
});
