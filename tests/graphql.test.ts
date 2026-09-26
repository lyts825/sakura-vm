import test from 'node:test';
import assert from 'node:assert/strict';
import { getIntrospectionQuery } from 'graphql';
import { GraphApi, graphqlInfo, graphqlLimits, querySnapshot } from '../server/graphql-api.ts';
import type { Machines } from '../server/machines.ts';
import type { Jobs } from '../server/jobs.ts';

const machines = {
  records: new Map(
    Array.from({ length: 125 }, (_, index) => [
      `vm-${index}`,
      { id: `vm-${index}`, name: `VM ${index}`, cpus: 2, memoryMiB: 512, secret: 'EXCLUDED_SSH_KEY' },
    ]),
  ),
  state: (id: string) => (Number(id.slice(3)) % 2 ? 'running' : 'stopped'),
} as unknown as Machines;
const store = {
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
} as unknown as Jobs;
const snapshot = () => querySnapshot(machines, [store], ['commands']);
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
  await assert.rejects(api.query({ query: '#' + '中'.repeat(graphqlLimits.queryBytes / 2) }), /16 KiB/);
  await assert.rejects(api.query([{ query: '{ apiVersion }' }]));
});

test('invalid variables and page bounds are reported; source errors are redacted; cancellation and close release admission', async (t) => {
  const api = new GraphApi(async () => snapshot());
  t.after(() => api.close());
  const variables = await api.query({
    query: 'query Page($n:Int!){ vms(limit:$n){id} }',
    variables: { n: 'bad' },
  });
  assert.equal(variables.status, 400);
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
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pendingSource = new Promise<ReturnType<typeof snapshot>>((resolve) => {
    release = () => resolve(snapshot());
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
