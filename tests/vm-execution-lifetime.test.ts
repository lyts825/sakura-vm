import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { HostRuntime, withResourceContext, resourceContext } from '../server/host-runtime/index.ts';
import { Machines } from '../server/machines.ts';
import { ExecutionScope } from '../server/execution-scope.ts';
import { VmLifetime, vmLifetime, registerVmBootProvider, vmBootProviders } from '../server/vm-lifetime.ts';
import type { Live } from '../server/vm-state.ts';
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import { withOperationCheck } from '../server/operation-context.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(capacity = 16) {
  const id = randomUUID(),
    governor = new HostRuntime({ budgets: { execution: { capacity } } });
  const machines = new Machines({ runtime: { close: async () => {} } } as never, fakeVmNetwork);
  const live = { status: 'running', abort: new AbortController(), clients: new Set() } as Live;
  machines.live.set(id, live);
  const lifetime = vmLifetime(id, live),
    signal = new AbortController().signal;
  const options = { machines, vmId: id, projectId: 'default', live, signal, governor };
  const used = () => governor.snapshot().budgets.find((value) => value.key === 'execution')!.used;
  return { machines, id, live, lifetime, governor, options, used };
}

test('process identity, RAM execution generation, observed kernel boot and NIC generation remain independent', async () => {
  const lifetime = new VmLifetime(randomUUID()),
    bootId = randomUUID();
  lifetime.observeBoot(bootId);
  const lease = await fakeVmNetwork.attachVm({
    vmId: lifetime.vmId,
    generation: 'network-before',
    sshPort: 35001,
    forwards: [],
    isolated: false,
    onFailure: () => {},
  });
  await lifetime.setNetwork(lease);
  const captured = lifetime.capture(),
    signal = lifetime.signal;
  lifetime.advanceExecution();
  const restored = lifetime.capture();
  assert.equal(restored.vmProcessId, captured.vmProcessId);
  assert.notEqual(restored.executionGeneration, captured.executionGeneration);
  assert.equal(restored.bootId, undefined);
  assert.equal(lifetime.lastObservedBootId, bootId);
  assert.equal(restored.networkGeneration, captured.networkGeneration);
  assert.equal(signal.aborted, true);
  assert.throws(() => lifetime.assert(captured), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  await lifetime.setNetwork(await lease.renew('network-after'));
  assert.equal(lifetime.capture().networkGeneration, 'network-after');
  assert.throws(() => lifetime.assert(restored), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  const generation = lifetime.capture().executionGeneration;
  const restoredBootId = randomUUID();
  lifetime.observeBoot(restoredBootId);
  assert.equal(lifetime.capture().executionGeneration, generation);
  assert.equal(lifetime.capture().bootId, restoredBootId);
  lifetime.observeBoot(randomUUID());
  assert.notEqual(lifetime.capture().executionGeneration, generation);
  await lifetime.close();
});

test('legacy Live fixtures receive actual identities and cannot reuse another VM lifetime', () => {
  const live = {} as Live,
    id = randomUUID(),
    first = vmLifetime(id, live);
  assert.equal(vmLifetime(id, live), first);
  assert.throws(() => vmLifetime(randomUUID(), live), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  first.advanceExecution();
  assert.equal(live.lifetime, first);
});

test('late network adoption after process death closes the returned lease', async () => {
  const lifetime = new VmLifetime(randomUUID());
  lifetime.end();
  const lease = await fakeVmNetwork.attachVm({
    vmId: lifetime.vmId,
    generation: 'late',
    sshPort: 35001,
    forwards: [],
    isolated: false,
    onFailure: () => {},
  });
  await assert.rejects(lifetime.setNetwork(lease), { code: 'PROJECT_IDENTITY_HOST_CHANGED' });
  assert.equal(lease.signal.aborted, true);
  await lifetime.close();
});

test('attachments are named registrations and failed resource disposal is retained for explicit retry', async () => {
  const owner = {},
    provider = { prepare: async () => undefined };
  const remove = registerVmBootProvider(owner, 'share', provider);
  assert.throws(() => registerVmBootProvider(owner, 'share', provider), /already registered/);
  registerVmBootProvider(owner, 'tpm', provider);
  remove();
  remove();
  assert.deepEqual(
    vmBootProviders(owner).map(([name]) => name),
    ['tpm'],
  );
  const lifetime = new VmLifetime(randomUUID()),
    calls: string[] = [];
  let failed = true;
  await lifetime.own(
    'first',
    {
      close: async () => {
        calls.push('first');
      },
    },
    1,
  );
  await lifetime.own(
    'helper',
    {
      close: async () => {
        calls.push('helper');
        if (failed) throw Error('still alive');
      },
    },
    2,
  );
  await assert.rejects(lifetime.close(), /cleanup failed/);
  failed = false;
  await lifetime.close();
  assert.deepEqual(calls, ['first', 'helper', 'helper']);
});

test('VM transition cancels execution and waits for control cleanup before taking the VM lock', async () => {
  const f = fixture(),
    started = deferred(),
    cleanup = deferred(),
    release = deferred();
  const order: string[] = [];
  const running = ExecutionScope.run(f.options, async (scope) => {
    started.resolve();
    await new Promise<void>((resolve) =>
      scope.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    assert.equal(f.machines.isBusy(f.id), false);
    await f.machines.locked(`cleanup:${f.id}`, async () => {
      order.push('cleanup');
      cleanup.resolve();
      await release.promise;
    });
  });
  await started.promise;
  (f.machines as any).stopInternal = async () => {
    assert.equal(f.used(), 0);
    order.push('stop');
  };
  const stopping = f.machines.stop(f.id);
  await cleanup.promise;
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.admitting, false);
  await assert.rejects(
    ExecutionScope.run(f.options, async () => assert.fail('must not enter')),
    { code: 'VM_EXECUTION_DRAINING' },
  );
  release.resolve();
  await Promise.all([running, stopping]);
  assert.deepEqual(order, ['cleanup', 'stop']);
  assert.equal(f.used(), 0);
  f.governor.close();
});

test('ordinary VM mutation rejects active executions and a held VM lock closes unrelated execution admission', async () => {
  const f = fixture(),
    started = deferred(),
    release = deferred();
  const task = ExecutionScope.run(f.options, async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  await assert.rejects(
    f.machines.locked(f.id, async () => {}),
    { code: 'VM_EXECUTION_ACTIVE' },
  );
  release.resolve();
  await task;
  const holding = deferred(),
    unlock = deferred();
  const locked = f.machines.locked(f.id, async () => {
    await ExecutionScope.run(f.options, async () => {}); // Native child of this exact exclusive operation.
    holding.resolve();
    await unlock.promise;
  });
  await holding.promise;
  await assert.rejects(
    ExecutionScope.run(f.options, async () => {}),
    { code: 'VM_EXECUTION_DRAINING' },
  );
  unlock.resolve();
  await locked;
  f.governor.close();
});

test('an execution cannot wait on its own VM transition', async () => {
  const f = fixture();
  await ExecutionScope.run(f.options, async () => {
    await assert.rejects(f.machines.stop(f.id), { code: 'VM_EXECUTION_REENTRANT' });
  });
  f.governor.close();
});

test('a callback from a completed exclusive operation cannot bypass a later transition barrier', async () => {
  const f = fixture(),
    callback = deferred(),
    locked = deferred(),
    unlock = deferred();
  let stale!: Promise<unknown>;
  await f.machines.locked(f.id, async () => {
    stale = callback.promise.then(() =>
      ExecutionScope.run(f.options, async () => assert.fail('stale exclusive permit')),
    );
  });
  const transition = f.lifetime.barrier(async () => {
    locked.resolve();
    await unlock.promise;
  });
  await locked.promise;
  const refused = assert.rejects(stale, { code: 'VM_EXECUTION_DRAINING' });
  callback.resolve();
  await refused;
  unlock.resolve();
  await transition;
  f.governor.close();
});

test('four same-project slots remain concurrent and queued work holds no partial global budget', async () => {
  const f = fixture(8),
    release = deferred();
  let started = 0;
  const tasks = Array.from({ length: 5 }, () =>
    ExecutionScope.run(f.options, async () => {
      started++;
      await release.promise;
    }),
  );
  await turn();
  assert.equal(started, 4);
  assert.equal(f.used(), 4);
  assert.equal(f.governor.snapshot().queued, 1);
  await ExecutionScope.run({ ...f.options, projectId: '1111111111111111' }, async () => {
    assert.equal(f.used(), 5);
  });
  release.resolve();
  await Promise.all(tasks);
  assert.equal(started, 5);
  assert.equal(f.lifetime.active, 0);
  f.governor.close();
});

test('queued cancellation and generation changes reject before guest launch without leaking a budget', async () => {
  const f = fixture(1),
    started = deferred(),
    release = deferred(),
    abort = new AbortController();
  const first = ExecutionScope.run(f.options, async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  const queued = ExecutionScope.run({ ...f.options, signal: abort.signal }, async () =>
    assert.fail('queued task entered'),
  );
  const rejected = assert.rejects(queued);
  abort.abort();
  await rejected;
  assert.equal(f.used(), 1);
  assert.equal(f.governor.snapshot().queued, 0);
  const stale = f.lifetime.capture();
  release.resolve();
  await first;
  f.lifetime.advanceExecution();
  await assert.rejects(
    ExecutionScope.run({ ...f.options, identity: stale }, async () => {}),
    { code: 'PROJECT_IDENTITY_HOST_CHANGED' },
  );
  f.governor.close();
});

test('same operation borrows exactly one slot and parent completion waits for unawaited child cleanup', async () => {
  const f = fixture(1),
    started = deferred(),
    cleanup = deferred();
  let child!: Promise<void>,
    done = false;
  const parent = ExecutionScope.run({ ...f.options, delegate: true }, async () => {
    child = ExecutionScope.run(f.options, async () => {
      started.resolve();
      await cleanup.promise;
    });
  }).then(() => {
    done = true;
  });
  await started.promise;
  await turn();
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.active, 1);
  assert.equal(done, false);
  cleanup.resolve();
  await Promise.all([parent, child]);
  f.governor.close();
});

test('siblings in one explicit operation borrow serially at full capacity and child cancellation remains effective', async () => {
  const f = fixture(1),
    cleanup = deferred(),
    firstStarted = deferred(),
    abort = new AbortController();
  let started = 0;
  await ExecutionScope.run({ ...f.options, delegate: true }, async () => {
    const first = ExecutionScope.run({ ...f.options, signal: abort.signal }, async (scope) => {
      started++;
      firstStarted.resolve();
      await new Promise<void>((resolve) =>
        scope.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      await cleanup.promise;
    });
    const second = ExecutionScope.run(f.options, async () => {
      started++;
      await cleanup.promise;
    });
    await firstStarted.promise;
    assert.equal(f.used(), 1);
    assert.equal(started, 1);
    abort.abort();
    cleanup.resolve();
    await Promise.all([first, second]);
    assert.equal(started, 2);
  });
  f.governor.close();
});

test('queued delegated execution rechecks authority and preserves the original cleanup capability', async (t) => {
  const f = fixture(2),
    started = deferred(),
    release = deferred(),
    denied = new AppError('authority revoked', 403, 'OPERATION_FORBIDDEN');
  t.after(() => f.governor.close());
  let revoked = false,
    ran = false,
    cleaned = 0,
    cleanup!: () => Promise<void>;
  await withOperationCheck(
    async () => {
      if (revoked) throw denied;
    },
    () => ExecutionScope.run({ ...f.options, delegate: true }, async () => {
      const first = ExecutionScope.run(f.options, async (child) => {
        cleanup = child.deferCleanup(async () => {
          const lease = await f.governor.acquire({
            owner: 'original-child-cleanup',
            kind: 'cleanup',
            label: 'original receipt',
            cost: { execution: 1 },
          });
          try {
            assert.equal(f.used(), 2);
            cleaned++;
          } finally {
            lease.release();
          }
        });
        started.resolve();
        await release.promise;
      });
      await started.promise;
      const second = ExecutionScope.run(f.options, async () => { ran = true; });
      const refused = assert.rejects(second, (error) => error === denied);
      revoked = true;
      release.resolve();
      await Promise.all([first, refused]);
      assert.equal(ran, false);
      assert.equal(f.used(), 1, 'refusing a borrower must retain the parent budget');
      assert.equal(f.lifetime.active, 1);
      await cleanup();
      assert.equal(cleaned, 1, 'revocation must not prevent original resource cleanup');
      assert.equal(f.used(), 1);
    }),
  );
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
  assert.equal(f.governor.snapshot().resources.length, 0);
  await cleanup();
  assert.equal(cleaned, 1, 'confirmed cleanup remains idempotent');
});

test('delegated execution observes cancellation while its authorization check is pending', { timeout: 2000 }, async (t) => {
  const f = fixture(1),
    checking = deferred(),
    release = deferred(),
    abort = new AbortController();
  t.after(() => f.governor.close());
  await ExecutionScope.run({ ...f.options, delegate: true }, async () => {
    const child = withOperationCheck(async () => {
      checking.resolve();
      await release.promise;
    }, () => ExecutionScope.run({ ...f.options, signal: abort.signal }, async () => {
      assert.fail('cancelled child entered');
    }));
    const refused = assert.rejects(child, { name: 'AbortError' });
    await checking.promise;
    abort.abort();
    release.resolve();
    await refused;
    assert.equal(f.used(), 1);
  });
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
});

test('undelegated and cross-project nesting fail immediately instead of waiting on their own occupied slot', async () => {
  const f = fixture(1);
  await ExecutionScope.run(f.options, async () => {
    await assert.rejects(
      ExecutionScope.run(f.options, async () => {}),
      { code: 'EXECUTION_NESTING_INVALID' },
    );
  });
  await ExecutionScope.run({ ...f.options, delegate: true }, async () => {
    await assert.rejects(
      ExecutionScope.run({ ...f.options, projectId: 'other' }, async () => {}),
      { code: 'EXECUTION_NESTING_INVALID' },
    );
  });
  f.governor.close();
});

test('plugin ownership survives admission and multiple explicit orchestration layers without another slot', async () => {
  const f = fixture(1),
    owner = 'plugin:search';
  await withResourceContext({ owner, pluginId: 'search', actorId: 'actor-fixture' }, () =>
    ExecutionScope.run({ ...f.options, owner, delegate: true }, async (parent) => {
      await ExecutionScope.run({ ...f.options, delegate: true }, async (child) => {
        await ExecutionScope.run(f.options, async (leaf) => {
          assert.equal(parent.identity, child.identity);
          assert.equal(parent.identity, leaf.identity);
          assert.equal(f.used(), 1);
          const resource = f.governor.snapshot().resources[0];
          assert.equal(resource.owner, owner);
          assert.equal(resource.identity.pluginId, 'search');
          assert.equal(resourceContext()?.actorId, 'actor-fixture');
          assert.equal(resourceContext()?.owner, owner);
        });
      });
    }),
  );
  f.governor.close();
});

test('cancellation never releases an unconfirmed native cleanup quota or allows a snapshot', async () => {
  const f = fixture(),
    failure = new AppError('native cleanup not confirmed', 503, 'GUEST_TASK_CLEANUP_FAILED');
  await assert.rejects(
    ExecutionScope.run(f.options, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.active, 1);
  assert.equal(f.governor.snapshot().resources[0].state, 'cleanup-pending');
  await assert.rejects(
    f.lifetime.barrier(async () => {}),
    { code: 'EXECUTION_CLEANUP_PENDING' },
  );
  let stopped = false;
  (f.machines as any).stopInternal = async () => {
    stopped = true;
  };
  await f.machines.stop(f.id, true);
  assert.equal(stopped, true);
  assert.equal(f.used(), 1, 'guest stop alone is not a host resource retirement receipt');
});

test('only the original cleanup closure can retire a failed execution after a successful explicit retry', async () => {
  const f = fixture(),
    failure = new AppError('guest cleanup pending', 503, 'GUEST_TASK_CLEANUP_FAILED');
  let ready = false,
    attempts = 0,
    recover!: () => Promise<void>;
  await assert.rejects(
    ExecutionScope.run(f.options, async (scope) => {
      recover = scope.recovery();
      const cleanup = scope.deferCleanup(async () => {
        attempts++;
        if (!ready) throw failure;
      });
      await cleanup();
    }),
    (error) => error === failure,
  );
  assert.equal(f.used(), 1);
  assert.equal(f.lifetime.active, 1);
  await assert.rejects(recover(), (error) => error === failure);
  assert.equal(f.used(), 1);
  ready = true;
  await recover();
  assert.equal(attempts, 3);
  assert.equal(f.used(), 0);
  assert.equal(f.lifetime.active, 0);
  await recover();
  assert.equal(attempts, 3);
  f.governor.close();
});

test('execution cleanup uses its original capability after request authority is revoked', async () => {
  const f = fixture(2);
  let revoked = false,
    cleaned = false;
  await withOperationCheck(
    async () => {
      if (revoked) throw new Error('authority revoked');
    },
    () =>
      ExecutionScope.run(f.options, async (scope) => {
        scope.deferCleanup(async () => {
          const child = await f.governor.acquire({
            owner: 'original-cleanup',
            kind: 'cleanup',
            label: 'receipt',
            cost: { execution: 1 },
          });
          assert.equal(f.used(), 2);
          child.release();
          cleaned = true;
        });
        revoked = true;
      }),
  );
  assert.equal(cleaned, true);
  assert.equal(f.used(), 0);
  f.governor.close();
});

test('a child recovery cannot retire an unrelated parent cleanup failure', async () => {
  const f = fixture(),
    native = new AppError('native', 503, 'GUEST_TASK_CLEANUP_FAILED');
  let ready = false,
    recover!: () => Promise<void>;
  await assert.rejects(
    ExecutionScope.run({ ...f.options, delegate: true }, async () => {
      await ExecutionScope.run(f.options, async (scope) => {
        recover = scope.recovery();
        await scope.deferCleanup(async () => {
          if (!ready) throw native;
        })();
      }).catch(() => {});
      throw new AppError('another owner remains', 503, 'HOST_PROCESS_CLEANUP_PENDING');
    }),
  );
  ready = true;
  await recover();
  assert.equal(f.used(), 1);
  assert.equal(f.governor.snapshot().resources[0].state, 'cleanup-pending');
});
