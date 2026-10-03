import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { Machines } from '../server/machines.ts';
import { ProjectSessionLifetime } from '../server/project-session-lifetime.ts';
import { ExecutionScope } from '../server/execution-scope.ts';
import { vmLifetime } from '../server/vm-lifetime.ts';
import { fakeVmNetwork } from './support/fake-vm-network.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture() {
  const machines = new Machines({} as never, fakeVmNetwork),
    vmId = randomUUID();
  const live = { status: 'running', abort: new AbortController() } as any;
  machines.live.set(vmId, live);
  const lifetime = vmLifetime(vmId, live);
  const governor = new HostRuntime({
    budgets: { execution: { capacity: 1 }, 'execution.session': { capacity: 32 } },
  });
  const receipt = {
    projectId: 'default',
    runId: randomUUID(),
    bootId: randomUUID(),
    inode: '100',
    phase: 'running',
  };
  const used = () => governor.snapshot().budgets.find((b) => b.key === 'execution.session')!.used;
  return { machines, vmId, live, lifetime, governor, receipt, used };
}

test('persistent sessions use independent atomic budgets and retain ordinary domain start/stop access', async () => {
  const f = fixture();
  let stops = 0;
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    kind: 'main',
    cleanup: async () => {
      stops++;
    },
  });
  assert.equal(f.used(), 1);
  await f.machines.locked(f.vmId, async () => {});
  await ExecutionScope.run(
    { ...f, projectId: 'default', signal: new AbortController().signal },
    async () => {},
  );
  assert.equal(f.used(), 1);
  assert.equal(stops, 0);
  await session.close();
  assert.equal(stops, 1);
  assert.equal(f.used(), 0);
  await f.lifetime.close();
  f.governor.close();
});

test('VM transition cancels session startup, waits for it to settle, and then awaits full domain cleanup', async () => {
  const f = fixture(),
    startup = deferred(),
    stopped = deferred(),
    closeAllowed = deferred();
  const events: string[] = [];
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    kind: 'service',
    cleanup: async () => {
      events.push('cleanup');
      stopped.resolve();
      await closeAllowed.promise;
    },
  });
  const starting = session.perform(async (signal) => {
    startup.resolve();
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    events.push('startup-retired');
  });
  await startup.promise;
  const barrier = f.lifetime.barrier(async () => {
    events.push('snapshot');
  });
  await stopped.promise;
  assert.deepEqual(events, ['startup-retired', 'cleanup']);
  assert.equal(f.used(), 1);
  await assert.rejects(
    ProjectSessionLifetime.acquire({
      ...f,
      receipt: { ...f.receipt, runId: randomUUID() },
      kind: 'service',
      cleanup: async () => {},
    }),
    { code: 'VM_EXECUTION_DRAINING' },
  );
  closeAllowed.resolve();
  await Promise.all([starting, barrier]);
  assert.deepEqual(events, ['startup-retired', 'cleanup', 'snapshot']);
  assert.equal(f.used(), 0);
  await f.lifetime.close();
  f.governor.close();
});

test('failed session stop keeps quota and VM barrier until the exact full receipt is retired', async () => {
  const f = fixture();
  let confirmed = false,
    calls = 0;
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    kind: 'ssh',
    cleanup: async () => {
      calls++;
      if (!confirmed) throw Error('native descendants still live');
    },
  });
  await assert.rejects(
    f.lifetime.barrier(async () => assert.fail('snapshot must remain fenced')),
    { code: 'EXECUTION_CLEANUP_PENDING' },
  );
  assert.equal(f.used(), 1);
  await assert.rejects(
    ProjectSessionLifetime.retire(f.machines, f.vmId, { ...f.receipt, inode: 'other' }, async () =>
      assert.fail('wrong receipt'),
    ),
    { code: 'SESSION_CLEANUP_PENDING' },
  );
  confirmed = true;
  await session.close();
  assert.equal(calls, 2);
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
  await f.lifetime.close();
  f.governor.close();
});

test('session project partitions preserve 16 independent runs and cannot be bypassed by another domain kind', async () => {
  const f = fixture();
  const sessions = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      ProjectSessionLifetime.acquire({
        ...f,
        kind: i % 2 ? 'terminal' : 'main',
        receipt: { ...f.receipt, runId: randomUUID() },
        cleanup: async () => {},
      }),
    ),
  );
  assert.equal(f.used(), 16);
  await assert.rejects(
    ProjectSessionLifetime.acquire({
      ...f,
      kind: 'ssh',
      receipt: { ...f.receipt, runId: randomUUID() },
      cleanup: async () => {},
    }),
    { code: 'RESOURCE_CAPACITY' },
  );
  assert.equal(f.used(), 16);
  await Promise.all(sessions.map((session) => session.close()));
  await f.lifetime.close();
  f.governor.close();
});

test('session native identity can only grow and old intents retire using the captured complete receipt', async () => {
  const f = fixture(),
    intent = { ...f.receipt, inode: null as string | null };
  const session = await ProjectSessionLifetime.acquire({
    ...f,
    receipt: intent,
    kind: 'main',
    cleanup: async () => {},
  });
  session.pin(f.receipt);
  assert.throws(() => session.pin(intent), { code: 'SESSION_CLEANUP_PENDING' });
  let observed: unknown;
  await ProjectSessionLifetime.retire(f.machines, f.vmId, intent, async (receipt) => {
    observed = receipt.inode;
  });
  assert.equal(observed, f.receipt.inode);
  assert.equal(f.used(), 0);
  await f.lifetime.close();
  f.governor.close();
});

test('a retained session cannot admit or control a replacement Live even when its old abort was not signalled', async () => {
  const f = fixture();
  const session = await ProjectSessionLifetime.acquire({ ...f, kind: 'main', cleanup: async () => {} });
  f.machines.live.set(f.vmId, { status: 'running', abort: new AbortController() } as any);
  await assert.rejects(
    session.perform(async () => assert.fail('stale session control')),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' },
  );
  await assert.rejects(ProjectSessionLifetime.acquire({ ...f, kind: 'main', cleanup: async () => {} }), {
    code: 'PROJECT_IDENTITY_HOST_CHANGED',
  });
  assert.equal(f.used(), 1);
  await session.close();
  await f.lifetime.close();
  f.governor.close();
});
