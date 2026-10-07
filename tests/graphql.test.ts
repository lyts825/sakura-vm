/**
 * 模块职责：回归验证模块，围绕 `graphql` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `graphql`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: GraphQL executes aliases, variables, named operations, fragments and full inventory pagination with one snapshot; normal introspection works without reading host data and does not reveal private contracts.
 */
import type { JobsV1 } from '../server/service-contracts/v1.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getIntrospectionQuery } from 'graphql';
import { GraphApi, graphqlInfo, graphqlLimits, querySnapshot } from '../server/graphql-api.ts';
import type { Machines } from '../server/machines.ts';

const machines = {
  records: new Map(
    Array.from({ length: 125 }, (_, index) => [
      `vm-${index}`,
      { id: `vm-${index}`, name: `VM ${index}`, cpus: 2, memoryMiB: 512, secret: 'EXCLUDED_SSH_KEY' },
    ]),
  ),
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id: string。
   * 结果：返回分支计算值（`(Number(id.slice(3)) % 2 ? 'running' : 'stopped')`）。
   * Result: Return the branch-computed value (`(Number(id.slice(3)) % 2 ? 'running' : 'stopped')`).
   * 协作入口 / Collaborators: `Number`, `id.slice`.
   */
  state: (id: string) => (Number(id.slice(3)) % 2 ? 'running' : 'stopped'),
} as unknown as Machines;
const store = {
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   */
  list: () => [
    {
      id: 'job-1',
      vmId: 'vm-1',
      status: 'done',
      scope: 'commands',
      action: 'command:run',
      startedAt: '2026-09-26T01:00:00Z',
      log: 'EXCLUDED_JOB_LOG',
      title: 'EXCLUDED_SECRET_TITLE',
      result: { bytes: 5, sha256: 'EXCLUDED_JOB_RESULT' },
    },
  ],
} as unknown as JobsV1;
/**
 * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
 * English: Read or resolve observable fixture state for business calls or subsequent assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`querySnapshot(machines, [store], ['commands'])`）。
 * Result: Return the branch-computed value (`querySnapshot(machines, [store], ['commands'])`).
 * 协作入口 / Collaborators: `querySnapshot`.
 */
const snapshot = () => querySnapshot(machines, [store], ['commands']);
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GraphQL executes aliases, variables, named operations, fragments and full inventory pagination with one snapshot
 * 协作入口 / Collaborators: `t.after`, `api.query`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 200)`; `assert.equal(result.body.errors, undefined)`.
 */
test('GraphQL executes aliases, variables, named operations, fragments and full inventory pagination with one snapshot', async (t) => {
  let reads = 0;
  const api = new GraphApi(async () => {
    reads++;
    return snapshot();
  });
  t.after(() => api.close());
  const result = await api.query({
    query: `query Ignored { apiVersion }
    query Read($status: String!, $offset: Int!) { host { totalVms totalJobs capturedAt }
      selected: vms(status: $status, offset: $offset, limit: 2) { ...VMFields }
      final: vm(id: "vm-124") { name }
      jobs { id action scope status }
      plugins { id enabled }
    } fragment VMFields on VirtualMachine { id status }`,
    operationName: 'Read',
    variables: { status: 'running', offset: 1 },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.errors, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.data?.selected)), [
    { id: 'vm-3', status: 'running' },
    { id: 'vm-5', status: 'running' },
  ]);
  assert.equal((result.body.data?.host as any).totalVms, 125);
  assert.equal((result.body.data?.final as any).name, 'VM 124');
  assert.equal(reads, 1);
  assert.ok(!JSON.stringify(result).includes('EXCLUDED_'));
  const missing = await api.query({ query: '{ vm(id: "missing") { id } }' });
  assert.equal(missing.body.data?.vm, null);
  assert.ok(graphqlInfo().sdl.includes('type Query'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: normal introspection works without reading host data and does not reveal private contracts
 * 协作入口 / Collaborators: `t.after`, `api.query`, `getIntrospectionQuery`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 200, JSON.stringify(result.body.errors))`; `assert.ok(result.body.data?.__schema)`.
 */
test('normal introspection works without reading host data and does not reveal private contracts', async (t) => {
  const api = new GraphApi(async () => {
    throw new Error('must not read host');
  });
  t.after(() => api.close());
  const result = await api.query({ query: getIntrospectionQuery() });
  assert.equal(result.status, 200, JSON.stringify(result.body.errors));
  assert.ok(result.body.data?.__schema);
  assert.equal((result.body.data!.__schema as any).mutationType, null);
  assert.equal((result.body.data!.__schema as any).subscriptionType, null);
  assert.ok(!graphqlInfo().sdl.includes('password'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: validation, cycles, cost, nesting, token and body bounds reject queries before resolving host data
 * 协作入口 / Collaborators: `t.after`, `Array.from({ length: 100 }, (_, i) => `a${i}:vms{ id name status cpus memor…`, `Array.from`, `'ofType { '.repeat`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 400)`; `assert.ok(result.body.errors?.length)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('validation, cycles, cost, nesting, token and body bounds reject queries before resolving host data', async (t) => {
  let reads = 0;
  const api = new GraphApi(async () => {
    reads++;
    return snapshot();
  });
  t.after(() => api.close());
  const bad = [
    '{ invalidField }',
    'mutation { startVM(id: "vm-1") { id } }',
    'subscription { vms { id } }',
    '{ vms { ...Loop } } fragment Loop on VirtualMachine { ...Loop }',
    '{ ' +
      Array.from({ length: 100 }, (_, i) => `a${i}:vms{ id name status cpus memoryMiB }`).join(' ') +
      ' }',
    '{ __type(name:"String") { ' + 'ofType { '.repeat(16) + 'name' + ' }'.repeat(16) + ' } }',
    '{ ' + 'apiVersion '.repeat(2501) + ' }',
    'query First { apiVersion } query Second { apiVersion }',
    'query First { apiVersion }',
  ];
  for (let i = 0; i < bad.length; i++) {
    const result = await api
      .query({ query: bad[i], ...(i === 8 ? { operationName: 'Missing' } : {}) })
      .catch((error) => ({ status: error.status || 400, body: { errors: [error] } }));
    assert.equal(result.status, 400);
    assert.ok(result.body.errors?.length);
  }
  assert.equal(reads, 0);
  const invalid = await api.query({ query: '{ unknownField }' });
  assert.equal(invalid.body.errors?.[0].extensions?.code, 'GRAPHQL_VALIDATION_FAILED');
  assert.match(invalid.body.errors![0].message, /unknownField/);
  const syntax = await api.query({ query: '{' });
  assert.equal(syntax.body.errors?.[0].extensions?.code, 'GRAPHQL_PARSE_FAILED');
  await assert.rejects(api.query({ query: '#' + '中'.repeat(graphqlLimits.queryBytes / 2) }), /16 KiB/);
  await assert.rejects(api.query([{ query: '{ apiVersion }' }]));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid variables and page bounds are reported; source errors are redacted; cancellation and close release admission
 * 协作入口 / Collaborators: `t.after`, `api.query`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(variables.status, 400)`; `assert.equal(variables.body.errors?.[0].extensions?.code, 'BAD_USER_INPUT')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('invalid variables and page bounds are reported; source errors are redacted; cancellation and close release admission', async (t) => {
  const api = new GraphApi(async () => snapshot());
  t.after(() => api.close());
  const variables = await api.query({
    query: 'query Page($n:Int!){ vms(limit:$n){id} }',
    variables: { n: 'bad' },
  });
  assert.equal(variables.status, 400);
  assert.equal(variables.body.errors?.[0].extensions?.code, 'BAD_USER_INPUT');
  for (const args of ['limit: 101', 'limit: -1', 'offset: -1', 'offset: 10001']) {
    const result = await api.query({ query: `{ vms(${args}) { id } }` });
    assert.equal(result.status, 200);
    assert.ok(result.body.errors?.some((error) => error.extensions?.code === 'BAD_USER_INPUT'));
  }
  const failed = new GraphApi(async () => {
    throw new Error('EXCLUDED_DISK_PATH_AND_SECRET');
  });
  t.after(() => failed.close());
  const failure = await failed.query({ query: '{ host { name } }' });
  assert.ok(failure.body.errors?.length);
  assert.ok(!JSON.stringify(failure).includes('EXCLUDED_'));
  assert.equal(failure.body.errors?.[0].extensions?.code, 'SOURCE_UNAVAILABLE');
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void, entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pendingSource = new Promise<ReturnType<typeof snapshot>>((resolve) => {
    release = /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`resolve(snapshot())`）。
     * Result: Return the branch-computed value (`resolve(snapshot())`).
     * 验证场景 / Scenario: invalid variables and page bounds are reported; source errors are redacted; cancellation and close release admission
     * 协作入口 / Collaborators: `resolve`, `snapshot`.
     */
    () => resolve(snapshot());
  });
  const slow = new GraphApi(async () => {
    entered();
    return pendingSource;
  });
  t.after(() => {
    release();
    return slow.close();
  });
  const abort = new AbortController();
  const query = slow.query({ query: '{ host { name } }' }, abort.signal);
  await ready;
  abort.abort();
  assert.ok((await query).body.errors?.some((error) => error.extensions?.code === 'CANCELLED'));
  const requests = Array.from({ length: graphqlLimits.concurrent }, () =>
    slow.query({ query: '{ host { name } }' }),
  );
  await assert.rejects(slow.query({ query: '{ apiVersion }' }), /并发/);
  await slow.close();
  for (const request of requests) assert.ok((await request).body.errors?.length);
  await assert.rejects(slow.query({ query: '{ apiVersion }' }), /关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: response size and elapsed query time remain bounded
 * 协作入口 / Collaborators: `t.after`, `large.query`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 400)`; `assert.match(result.body.errors![0].message, /1 MiB/)`.
 */
test('response size and elapsed query time remain bounded', async (t) => {
  const large = new GraphApi(async () => ({
    ...snapshot(),
    host: { ...snapshot().host, name: 'x'.repeat(graphqlLimits.responseBytes) },
  }));
  t.after(() => large.close());
  const result = await large.query({ query: '{ host { name } }' });
  assert.equal(result.status, 400);
  assert.match(result.body.errors![0].message, /1 MiB/);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slow = new GraphApi(async () => new Promise(() => {}));
  t.after(() => slow.close());
  const pending = slow.query({ query: '{ host { name } }' });
  t.mock.timers.tick(graphqlLimits.timeoutMs);
  assert.ok((await pending).body.errors?.some((error) => error.extensions?.code === 'CANCELLED'));
});
