import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';
import type { ProjectServiceRecord } from '../server/project-service-scope.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-service-scope-test-'));
process.env.SAKURA_DATA_DIR = root;
const { runServices, serviceSchema } = await import('../server/project-services.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { ProjectServiceScopes, projectServiceRecordSchema } = await import('../server/project-service-scope.ts');
const { writeStore } = await import('../server/local-store.ts');
const { scopeIdentityFixture } = await import('./project-scope-identity-fixture.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.match(basename(owned), /^sakura-project-service-scope-test-/);
  await rm(owned, { recursive: true, force: true });
});

function request(command: string) {
  const encoded = command.split('\n').find(line => line.startsWith('# SAKURA_PROJECT_SERVICE_REQUEST='));
  return encoded ? JSON.parse(Buffer.from(encoded.split('=')[1], 'base64').toString()) : null;
}
function fixture(mode = 'normal') {
  const id = randomUUID(), bootId = randomUUID(), instance = {}, records = new Map<string, ProjectServiceRecord>();
  const project = projectSchema.parse({ directory: '/workspace', services: [
    { name: 'db', command: 'sleep 600' },
    { name: 'api', command: 'sleep 600', dependsOn: ['db'], ready: 'ready-probe', timeout: 5 },
  ] });
  const events: { op: string; name: string; runId: string | null }[] = [];
  let stops = 0, commits = 0, sequence = 0;
  const state = { currentBoot: bootId, rebootProbes: 0, rebootBlock: '', rebootProbeFailures: 0 };
  const controller = new AbortController();
  const machines = {
    live: new Map([[id, instance]]), get: () => ({ distro: 'alpine' }),
    locked: async (_key: string, action: () => Promise<unknown>) => action(),
    exec: async (_id: string, command: string) => {
      const input = request(command);
      if (!input) return { code: command.startsWith('setsid sh -c') && command.includes('ready-probe') && mode === 'ready-failure' ? 1 : 0, stdout: '', stderr: '' };
      const { op, name } = input;
      events.push({ op, name, runId: input.record?.runId || null });
      const reply = (status: string, record: ProjectServiceRecord | null) => ({ code: 0, stdout: JSON.stringify({ status, bootId: state.currentBoot, record }), stderr: '' });
      if (op === 'probe-reboot') {
        if (++state.rebootProbes <= state.rebootProbeFailures) throw new Error('owned reboot probe connection failed');
        if (state.currentBoot !== input.record.bootId && (state.rebootBlock || records.has(name)))
          return { code: 73, stdout: '', stderr: state.rebootBlock || 'new boot service owner exists' };
        return { code: 0, stdout: JSON.stringify({ bootId: state.currentBoot, retired: state.currentBoot !== input.record.bootId }), stderr: '' };
      }
      if (op === 'status') {
        if (mode === 'unmanaged') return reply('unmanaged', null);
        const record = records.get(name);
        return reply(record?.phase === 'running' && mode === 'exited-pane' ? 'exited' : record?.phase || 'absent', record || null);
      }
      const scopes = new ProjectServiceScopes(machines as unknown as Machines, id, project);
      if (op === 'prepare') {
        const host = JSON.parse(await readFile(scopes.receipt(name), 'utf8'));
        assert.equal(host.runId, input.record.runId);
        assert.equal(host.phase, 'intent', 'host intent must exist before guest prepares');
        if (mode === 'scope-unavailable') return { code: 73, stdout: '', stderr: 'SAKURA_SERVICE_SCOPE_UNAVAILABLE: readonly cgroup' };
        const record = { ...input.record, phase: 'prepared', inode: '1000' + ++sequence } as ProjectServiceRecord;
        records.set(name, record);
        if (mode === 'prepare-ack-lost') throw new Error('owned prepare acknowledgement lost');
        return reply('prepared', record);
      }
      if (op === 'start') {
        const record = { ...records.get(name)!, sessionId: '$' + sequence, paneId: '%' + sequence,
          panePid: 100 + sequence, paneStartTicks: '999' + sequence };
        records.set(name, record);
        if (mode === 'pane-failure') throw new Error('owned pane launch failed');
        return reply('prepared', record);
      }
      if (op === 'commit') {
        ++commits;
        const host = JSON.parse(await readFile(scopes.receipt(name), 'utf8'));
        assert.equal(host.panePid, records.get(name)!.panePid);
        assert.equal(host.inode, records.get(name)!.inode);
        assert.equal(host.phase, 'prepared', 'full host pane identity must exist before project code');
        const record = { ...records.get(name)!, phase: 'running' as const };
        records.set(name, record);
        if (mode === 'commit-ack-lost') throw new Error('owned commit acknowledgement lost');
        if (mode === 'cancel-after-commit') controller.abort(new Error('owned cancellation'));
        return reply('running', record);
      }
      assert.equal(op, 'stop');
      ++stops;
      if ((mode === 'first-stop-failure' && stops === 1) || mode === 'all-stop-failures')
        throw new Error('owned cleanup connection failed');
      if (mode === 'replace-live') {
        machines.live.set(id, {});
        throw new Error('owned live replacement');
      }
      const record = records.get(name);
      if (record && record.runId !== input.record.runId)
        return { code: 73, stdout: '', stderr: '服务 run 身份已改变' };
      const stopped = { ...(record || input.record), phase: 'stopped' as const };
      records.set(name, stopped);
      if (mode === 'stop-ack-lost' && stops === 1) throw new Error('owned stop reply lost');
      return reply('stopped', stopped);
    },
  };
  const identity = scopeIdentityFixture(machines as unknown as Machines, project, () => state.currentBoot,
    runId => [...records.values()].find(item => item.runId === runId) || null,
    execution => mode === 'ready-failure' && execution.command === 'ready-probe' ? 1 : 0);
  return { id, bootId, project, machines: machines as unknown as Machines, records, events, controller, identity, state,
    startService: async (record: ProjectServiceRecord) => {
      const scopes = new ProjectServiceScopes(machines as unknown as Machines, id, project);
      await scopes.persistIntent(record);
      return scopes.start(record, await identity.payload(id, record, { command: 'sleep 600' }), controller.signal);
    },
    counts: () => ({ stops, commits }), scopes: () => new ProjectServiceScopes(machines as unknown as Machines, id, project) };
}

test('service scope persists after readiness and repeated stop is idempotent', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'api');
  assert.equal(f.records.get('api')?.phase, 'running');
  assert.equal(f.records.get('db')?.phase, 'running');
  assert.equal(f.counts().stops, 0);
  assert.equal(f.counts().commits, 2);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal);
  assert.equal(f.records.get('api')?.phase, 'stopped');
  assert.equal(f.records.get('db')?.phase, 'stopped');
  assert.equal(f.counts().stops, 4);
});

test('legacy service v1 may stop but cannot reuse a root execution entry', async () => {
  const f = fixture(), scope = f.scopes();
  const record = { ...scope.intent(f.project.services![0], f.bootId), phase: 'running' as const, inode: '555',
    sessionId: '$1', paneId: '%1', panePid: 100, paneStartTicks: '1234' };
  f.records.set('db', record); await writeStore(scope.receipt('db'), record);
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'),
    { code: 'SERVICE_IDENTITY_REQUIRED' });
  assert.equal(f.counts().commits, 0);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal(f.records.get('db')!.phase, 'stopped'); assert.equal(f.identity.state.stopCalls, 0);
});

test('service ready uses protected task input and identity closure retries before scope retirement', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'api');
  assert.ok(f.identity.inputs.some(input => input.includes(Buffer.from('ready-probe'))));
  f.identity.state.stopFailures = 1;
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal);
  assert.equal(f.records.get('api')!.phase, 'stopped'); assert.equal(f.records.get('db')!.phase, 'stopped');
  assert.ok(f.identity.state.stopCalls >= 4);
});

test('a cold reboot retires the exact absent service and its identity without ordinary stop signals', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const old = { ...f.records.get('db')! }; f.records.clear(); f.state.currentBoot = randomUUID();
  f.state.rebootProbeFailures = 1;
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal(f.counts().stops, 0); assert.equal(f.state.rebootProbes, 3);
  assert.deepEqual(await f.scopes().metadata('db'), { ...old, phase: 'stopped' });
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  assert.notEqual(f.records.get('db')!.runId, old.runId); assert.equal(f.records.get('db')!.bootId, f.state.currentBoot);
});
for (const replacement of ['new guest owner', 'replacement cgroup', 'replacement pane'])
  test(`cross-boot service retirement refuses ${replacement} and retains the exact host record`, async () => {
    const f = fixture();
    await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
    const before = await readFile(f.scopes().receipt('db'), 'utf8'); f.records.clear();
    f.state.currentBoot = randomUUID(); f.state.rebootBlock = replacement;
    await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_CLEANUP_FAILED' });
    assert.equal(f.counts().stops, 0); assert.equal(await readFile(f.scopes().receipt('db'), 'utf8'), before);
  });
for (const mode of ['prepare-ack-lost', 'pane-failure', 'commit-ack-lost', 'cancel-after-commit', 'scope-unavailable']) {
  test(`service ${mode} rolls back only the known new run and retains a stopped receipt`, async () => {
    const f = fixture(mode);
    await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'));
    assert.equal(f.counts().stops, 1);
    assert.equal(f.records.get('db')?.phase, 'stopped');
    const saved = JSON.parse(await readFile(f.scopes().receipt('db'), 'utf8'));
    assert.equal(projectServiceRecordSchema.safeParse(saved).success, true);
    assert.equal(saved.runId, f.events.find(event => event.op === 'prepare')!.runId);
  });
}
for (const mode of ['first-stop-failure', 'stop-ack-lost']) {
  test(`service ${mode} retries independently and confirms whole-scope stop`, async () => {
    const f = fixture(mode);
    await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
    await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
    assert.equal(f.counts().stops, 2);
    assert.equal(f.records.get('db')?.phase, 'stopped');
  });
}
test('all stop connections failing retains the running receipt and reports cleanup failure', async () => {
  const f = fixture('all-stop-failures');
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const before = await readFile(f.scopes().receipt('db'), 'utf8');
  await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'),
    (error: any) => error.code === 'SERVICE_CLEANUP_FAILED' && error.status === 503);
  assert.equal(f.counts().stops, 3);
  assert.equal(await readFile(f.scopes().receipt('db'), 'utf8'), before);
});
test('an exited main pane still owns detached children and permits a verified full-scope stop', async () => {
  const f = fixture('exited-pane'), scopes = f.scopes(), service = f.project.services![0];
  const record = scopes.intent(service, f.bootId);
  await f.startService(record);
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'), /主 pane 已退出/);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal(f.counts().stops, 1);
  assert.equal(f.records.get('db')?.phase, 'stopped');
});
test('an exited dependent still blocks stopping its dependency until its owned descendants are cleaned', async () => {
  const f = fixture('exited-pane'), scopes = f.scopes();
  await f.startService(scopes.intent(f.project.services![1], f.bootId));
  await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), /请先停止依赖服务 api/);
  assert.equal(f.counts().stops, 0);
  assert.equal(f.records.get('api')?.phase, 'running');
});
for (const mode of ['prepare-ack-lost', 'pane-failure']) {
  test(`manual stop recovers a durable partial host receipt after ${mode} and a lost caller`, async () => {
    const f = fixture(mode), scopes = f.scopes();
    await assert.rejects(f.startService(scopes.intent(f.project.services![0], f.bootId)));
    await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
    assert.equal(f.counts().stops, 1);
    assert.equal(f.records.get('db')?.phase, 'stopped');
  });
}
test('service cleanup refuses a changed live instance after the first failed connection', async () => {
  const f = fixture('replace-live');
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_CLEANUP_FAILED' });
  assert.equal(f.counts().stops, 1);
});
for (const field of ['runId', 'bootId', 'inode', 'panePid', 'paneStartTicks'] as const) {
  test(`service refuses replaced ${field} against the persisted host receipt before signaling`, async () => {
    const f = fixture();
    await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
    const record = f.records.get('db')!;
    (record as any)[field] = field.endsWith('Id') ? randomUUID() : field === 'panePid' ? record.panePid! + 1 : '555555';
    await assert.rejects(runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db'), { code: 'SERVICE_SCOPE_CHANGED' });
    assert.equal(f.counts().stops, 0);
  });
}
test('unknown old tmux sessions are never guessed into a service scope or stopped', async () => {
  const f = fixture('unmanaged');
  for (const action of ['start', 'stop'] as const)
    await assert.rejects(runServices(f.machines, f.id, f.project, action, () => {}, f.controller.signal, 'db'), { code: 'SERVICE_SCOPE_UNMANAGED' });
  assert.equal(f.events.filter(event => event.op !== 'status').length, 0);
});
test('a failed dependent readiness check leaves the previously running dependency alone', async () => {
  const f = fixture('ready-failure');
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const dependency = { ...f.records.get('db')! };
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'api'), /就绪检查超时/);
  assert.deepEqual(f.records.get('db'), dependency);
  assert.equal(f.records.get('api')?.phase, 'stopped');
  assert.deepEqual(f.events.filter(event => event.op === 'stop').map(event => event.name), ['api']);
});
test('an old rollback cannot overwrite the host receipt for a newer run', async () => {
  const f = fixture();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  const old = { ...f.records.get('db')! }, current = { ...old, runId: randomUUID() };
  current.scopeName = 'sakura-service-' + current.runId;
  await writeFile(f.scopes().receipt('db'), JSON.stringify(current));
  await assert.rejects(f.scopes().stop(old), { code: 'SERVICE_CLEANUP_FAILED' });
  assert.equal(f.counts().stops, 0);
  assert.equal(JSON.parse(await readFile(f.scopes().receipt('db'), 'utf8')).runId, current.runId);
});
test('service scope protocol rejects mismatched fixed paths and incomplete pane identities', () => {
  const f = fixture(), service = serviceSchema.parse({ name: 'api', command: 'sleep 600' });
  const intent = f.scopes().intent(service, randomUUID());
  assert.equal(projectServiceRecordSchema.safeParse(intent).success, true);
  assert.equal(projectServiceRecordSchema.safeParse({ ...intent, scopeName: 'sakura-service-' + randomUUID() }).success, false);
  assert.equal(projectServiceRecordSchema.safeParse({ ...intent, panePid: 100 }).success, false);
});
test('a same-boot durable intent without a guest receipt remains unconfirmed until a stop fences delayed prepare', async () => {
  const f = fixture(), scopes = f.scopes(), intent = scopes.intent(f.project.services![0], f.bootId);
  await writeStore(scopes.receipt('db'), intent);
  assert.equal((await scopes.status('db')).status, 'unconfirmed');
  await assert.rejects(runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db'), /上次启动尚未确认/);
  await runServices(f.machines, f.id, f.project, 'stop', () => {}, f.controller.signal, 'db');
  assert.equal((await scopes.status('db')).status, 'stopped');
});

test('a corrupt host receipt consistently rejects status with an ownership error code', async () => {
  const f = fixture(), scopes = f.scopes();
  await runServices(f.machines, f.id, f.project, 'start', () => {}, f.controller.signal, 'db');
  for (const damaged of ['{', JSON.stringify({ version: 1 })]) {
    await writeFile(scopes.receipt('db'), damaged);
    await assert.rejects(scopes.metadata('db'), { code: 'SERVICE_SCOPE_CHANGED' });
    await assert.rejects(scopes.status('db'), { code: 'SERVICE_SCOPE_CHANGED' });
    assert.equal(f.counts().stops, 0);
  }
});

test('an incomplete successful status receipt cannot claim an owned service state', async () => {
  const f = fixture();
  for (const status of ['prepared', 'running', 'exited', 'stopped', 'unconfirmed']) {
    f.machines.exec = async () => ({ code: 0, stdout: JSON.stringify({ status, bootId: f.bootId, record: null }), stderr: '' });
    await assert.rejects(f.scopes().status('db'), { code: 'SERVICE_SCOPE_CHANGED' });
    assert.equal(f.counts().stops, 0);
  }
});
