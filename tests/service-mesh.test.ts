import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const parent = process.env.SAKURA_DATA_DIR || tmpdir();
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'sakura-mesh-tests-'));
process.env.SAKURA_DATA_DIR = root;
const { ServiceMesh, envoySidecarConfig, serviceMeshInput } = await import('../server/service-mesh.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { vmDir } = await import('../server/model.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const { meshIdentityFixture } = await import('./service-mesh-identity-fixture.ts');
const policy = { name: 'frontend', listenPort: 15001, upstreamPort: 8080 };
after(async () => {
  assert.equal(dirname(resolve(root)), resolve(parent));
  assert.match(basename(root), /^sakura-mesh-tests-/);
  await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const model = await meshIdentityFixture();
  return { ...model, model, get mesh() { return model.mesh; },
    state: (value: string) => { model.state.guest = value; },
    envoy: (value: boolean) => { model.state.envoy = value; },
    python: (value: boolean) => { model.state.python = value; },
    enabled: (value: boolean) => { model.state.enabled = value; },
    usable: (value: boolean) => { model.state.usable = value; },
    launch: (value: () => void) => { model.state.launchHook = value; },
  };
}

test('mesh saves legacy-compatible policies and binds persistent sidecars to a private project', async () => {
  const f = await fixture();
  try {
    await f.workspaces.save(f.id, {
      directory: '/workspace/private',
      networkIsolation: 'private',
      environment: { SCOPE: 'private' },
    });
    assert.equal((await f.mesh.action(f.id, { mode: 'save', policy }, 'check')).ready, true);
    assert.equal((await f.mesh.status(f.id)).policy, null, 'preview must not persist');
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.envoy(false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /Envoy/);
    f.envoy(true);
    f.python(false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /Python/);
    f.python(true);
    const start = await f.mesh.action(f.id, { mode: 'start' }, 'run');
    assert.equal(start.sidecarRunning, true);
    assert.equal(start.bindingValid, true);
    assert.equal(start.networkIsolation, 'private');
    assert.equal(start.directory, '/workspace/private');
    const prepared = f.executions.find(execution => execution.command.includes('--mode'))!;
    assert.equal(prepared.project.networkIsolation, 'private');
    assert.equal(prepared.project.directory, '/workspace/private');
    assert.equal(prepared.environment?.SCOPE, 'private');
    assert.match(prepared.command, /--disable-hot-restart/);
    assert.match(prepared.command, /--concurrency/);
    assert.equal(f.frames[0].subarray(0, 8).toString(), 'SKIDP001');
    assert.equal(f.frames[0].readUInt32LE(12), 0);
    assert.match(f.frames[0].toString(), /SCOPE/);
    assert.equal(f.rootLaunches.length, 1);
    assert.ok(!f.rootLaunches[0].includes('SCOPE'));
    assert.ok(!f.rootLaunches[0].includes('/workspace/private'));
    const account = f.identities.get('default')!;
    assert.equal(account.gid, account.uid);
    assert.notEqual(account.home, '/root');
    assert.equal(f.held.get('default'), 0, 'completed persistent service releases its finite preparation');
    await assert.rejects(
      f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }),
      /停止.*边车/,
    );
    await assert.rejects(
      f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' }),
      /停止.*边车/,
    );
    await assert.rejects(f.mesh.action(f.id, { mode: 'save', policy }, 'run'), /先停止/);
    await assert.rejects(f.mesh.action(f.id, { mode: 'remove' }, 'run'), /先停止/);
    await assert.rejects(
      f.mesh.configure(f.id, false, async () => f.enabled(false)),
      /停止所有项目/,
    );
    const runId = start.runId;
    await f.restart();
    assert.equal((await f.mesh.status(f.id)).runId, runId);
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).version, 1);
    await f.mesh.action(f.id, { mode: 'stop' }, 'run');
    assert.equal((await f.mesh.status(f.id)).sidecarRunning, false);
    await f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'host' });
    await f.mesh.action(f.id, { mode: 'remove' }, 'run');
    assert.equal((await f.mesh.status(f.id)).policy, null);
  } finally {
    await f.close();
  }
});

test('private projects reuse ports while shared policy saves and network edits cannot race reservations', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    const alpha = (
      await f.workspaces.projects.create(f.id, 'Private A', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/a', networkIsolation: 'private' });
      })
    ).active;
    const beta = (
      await f.workspaces.projects.create(f.id, 'Private B', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/b', networkIsolation: 'private' });
      })
    ).active;
    for (const project of [alpha, beta])
      await f.workspaces.projects.with(f.id, project, async () => {
        await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
        await f.mesh.action(f.id, { mode: 'start' }, 'run');
      });
    await f.workspaces.projects.with(f.id, alpha, async () => {
      await f.mesh.action(f.id, { mode: 'stop' }, 'run');
      await assert.rejects(
        f.workspaces.save(f.id, { directory: '/workspace/a', networkIsolation: 'host' }),
        /共享网络项目/,
      );
    });
    assert.ok(f.running.has(beta));
    assert.equal(f.running.has(alpha), false);
    const host = (
      await f.workspaces.projects.create(f.id, 'Shared', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/shared' });
      })
    ).active;
    const saves = await Promise.allSettled(
      ['default', host].map((project) =>
        f.workspaces.projects.with(f.id, project, () =>
          f.mesh.action(f.id, { mode: 'save', policy: { ...policy, listenPort: 15002 } }, 'run'),
        ),
      ),
    );
    assert.equal(saves.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(saves.filter((item) => item.status === 'rejected').length, 1);
    const failure = saves.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(failure.reason), /共享网络项目/);
  } finally {
    await f.close();
  }
});

test('mesh refuses stale process bindings, preserves other projects on cancellation and cleans orphans', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    await f.mesh.action(f.id, { mode: 'start' }, 'run');
    f.running.get('default')!.valid = false;
    assert.equal((await f.mesh.status(f.id)).ready, false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /先停止/);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /停止.*边车/);
    await f.mesh.action(f.id, { mode: 'stop' }, 'run');
    await f.mesh.action(f.id, { mode: 'start' }, 'run');
    const other = (
      await f.workspaces.projects.create(f.id, 'Other', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/other', networkIsolation: 'private' });
      })
    ).active;
    await f.workspaces.projects.with(f.id, other, async () => {
      await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
      const abort = new AbortController();
      f.launch(() => abort.abort());
      await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run', abort.signal));
      assert.equal(f.running.has(other), false);
      assert.ok(f.running.has('default'));
    });
    f.running.get('default')!.orphan = true;
    await f.workspaces.projects.with(f.id, 'default', async () => {
      assert.equal((await f.mesh.status(f.id)).bindingValid, false);
      await assert.rejects(f.mesh.action(f.id, { mode: 'remove' }, 'run'), /先停止/);
      await f.mesh.action(f.id, { mode: 'stop' }, 'run');
      assert.equal((await f.mesh.status(f.id)).sidecarRunning, false);
    });
  } finally {
    await f.close();
  }
});

test('paused guests and serialized disabled settings cannot allow unsafe edits or a late start', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.state('paused');
    assert.equal((await f.mesh.status(f.id)).sidecarStateKnown, false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'save', policy }, 'run'), /恢复实例/);
    await assert.rejects(f.mesh.action(f.id, { mode: 'remove' }, 'run'), /恢复实例/);
    await assert.rejects(
      f.mesh.configure(f.id, false, async () => f.enabled(false)),
      /恢复实例/,
    );
    f.state('running');
    const disable = f.mesh.configure(f.id, false, async () => f.enabled(false));
    const start = f.mesh.action(f.id, { mode: 'start' }, 'run');
    await disable;
    await assert.rejects(start, /已禁用/);
    assert.equal(f.running.size, 0);
    await f.mesh.configure(f.id, true, async () => f.enabled(true));
    await f.mesh.action(f.id, { mode: 'start' }, 'run');
  } finally {
    await f.close();
  }
});

test('an installed but unusable Envoy is reported unready and cannot leave a running sidecar', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.usable(false);
    const unprobed = await f.mesh.status(f.id);
    assert.equal(unprobed.envoyUsable, null);
    const current = await f.mesh.action(f.id, { mode: 'status' }, 'check');
    assert.equal(current.envoyInstalled, true);
    assert.equal(current.envoyUsable, false);
    assert.equal(current.ready, false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /incompatible Envoy/);
    assert.equal(f.running.size, 0);
    assert.equal(
      f.model.state.starts > 0,
      false,
    );
  } finally {
    await f.close();
  }
});

test('public capability settings persist and the real enabled callback rejects stale sidecar starts', async () => {
  const f = await fixture(),
    next = new NextFeatures(f.machines, f.workspaces);
  try {
    Object.assign(next.serviceMesh, { options: f.options, scopes: f.options.scopes, identities: f.options.identities, file: f.file });
    await next.init();
    await next.serviceMesh.action(f.id, { mode: 'save', policy }, 'run');
    await next.configure(f.id, { featureId: 'service-mesh', enabled: false, options: {} });
    assert.equal((await next.view(f.id)).settings['service-mesh'].enabled, false);
    await assert.rejects(next.serviceMesh.action(f.id, { mode: 'start' }, 'run'), /已禁用/);
    await next.configure(f.id, { featureId: 'service-mesh', enabled: true, options: {} });
    await next.serviceMesh.action(f.id, { mode: 'start' }, 'run');
    await assert.rejects(
      next.configure(f.id, { featureId: 'service-mesh', enabled: false, options: {} }),
      /停止所有项目/,
    );
    assert.equal((await next.view(f.id)).settings['service-mesh'].enabled, true);
    await next.serviceMesh.action(f.id, { mode: 'stop' }, 'run');
    await next.configure(f.id, { featureId: 'service-mesh', enabled: false, options: {} });
    assert.equal((await next.view(f.id)).settings['service-mesh'].enabled, false);
  } finally {
    await next.close();
    await f.close();
  }
});

test('sidecar schema accepts only fixed loopback TCP policies', () => {
  assert.equal(
    serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, upstreamPort: 15001 } }).success,
    false,
  );
  assert.equal(
    serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, name: 'api;rm' } }).success,
    false,
  );
  assert.equal(
    serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, bootstrap: {} } }).success,
    false,
  );
  const config = envoySidecarConfig(policy);
  assert.ok(!JSON.stringify(config).includes('0.0.0.0'));
  assert.ok(!('admin' in config));
});
