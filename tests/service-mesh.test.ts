import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-mesh-tests-'));
process.env.SAKURA_DATA_DIR = root;
const { ServiceMesh, envoySidecarConfig, serviceMeshInput } = await import('../server/service-mesh.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { vmDir } = await import('../server/model.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const policy = { name: 'frontend', listenPort: 15001, upstreamPort: 8080 };
after(async () => {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.match(basename(root), /^sakura-mesh-tests-/);
  await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const id = randomUUID(),
    locks = new Machines({} as Engine),
    commands: string[] = [];
  const running = new Map<string, { binding: string; runId: string; valid: boolean; orphan: boolean }>();
  let state = 'running',
    envoy = true,
    python = true,
    enabled = true,
    usable = true;
  let launch: (() => void) | undefined;
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { template: 'none' }]]),
    live: new Map(),
    get: () => ({ id, template: 'none', distro: 'alpine' }),
    state: () => state,
    locked: locks.locked.bind(locks),
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { code: 0, stdout: 'absent\n', stderr: '' };
      if (command.startsWith('set +e\nprintf')) {
        const project = /sakura-mesh-(default|[a-f0-9]{16})/.exec(command)![1];
        return {
          code: 0,
          stderr: '',
          stdout:
            `ENVOY=${envoy ? '/usr/local/bin/envoy' : ''}\nTMUX=/usr/bin/tmux\n` +
            `PYTHON=${python ? '/usr/bin/python3' : ''}\nDIRECTORY=yes\nNAMESPACE=yes\nRUNNING=${running.has(project) ? 'yes' : 'no'}\n`,
        };
      }
      if (command.includes('import hashlib,json,os,re,select')) {
        const literal = /data=json.loads\((".*")\)\n/.exec(command)![1];
        const data = JSON.parse(JSON.parse(literal));
        const project = data.session.replace('sakura-mesh-', ''),
          current = running.get(project);
        if (command.endsWith("stop()'")) {
          if (!data.expectedRunId || current?.runId === data.expectedRunId) running.delete(project);
          return { code: 0, stderr: '', stdout: '' };
        }
        const valid = !!current && current.valid && !current.orphan && current.binding === data.binding;
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            sidecarRunning: !!current,
            bindingValid: current ? valid : null,
            bindingError: current && !valid ? '边车实际进程或项目网络绑定不一致，请先停止' : null,
            runId: valid ? current!.runId : null,
            processes: current ? [1234] : [],
          }),
        };
      }
      if (command.includes('tmux new-session')) {
        const project = /-s sakura-mesh-(default|[a-f0-9]{16})/.exec(command)![1];
        running.set(project, {
          binding: /SAKURA_MESH_BINDING=([a-f0-9]{64})/.exec(command)![1],
          runId: /SAKURA_MESH_RUN_ID=([a-f0-9-]{36})/.exec(command)![1],
          valid: true,
          orphan: false,
        });
        launch?.();
      }
      if (!usable && (command.includes('--mode validate') || command.includes('--version')))
        return { code: 127, stdout: '', stderr: 'incompatible Envoy' };
      return { code: 0, stdout: command.includes('--version') ? 'envoy version: fixture\n' : '', stderr: '' };
    },
  }) as unknown as MachineType;
  await mkdir(vmDir(id), { recursive: true });
  const workspaces = new Workspaces(machines),
    file = join(root, id + '.mesh.json');
  const create = () => new ServiceMesh(machines, workspaces, file, async () => enabled);
  let mesh = create();
  await mesh.init();
  return {
    id,
    machines,
    workspaces,
    commands,
    running,
    file,
    get mesh() {
      return mesh;
    },
    restart: async () => {
      await mesh.close();
      mesh = create();
      await mesh.init();
    },
    state: (value: string) => {
      state = value;
    },
    envoy: (value: boolean) => {
      envoy = value;
    },
    python: (value: boolean) => {
      python = value;
    },
    enabled: (value: boolean) => {
      enabled = value;
    },
    usable: (value: boolean) => {
      usable = value;
    },
    launch: (value: () => void) => {
      launch = value;
    },
    close: async () => {
      await mesh.close();
      await workspaces.close();
    },
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
    const prepared = f.commands.find((command) => command.includes('--mode validate'))!;
    assert.match(prepared, /ip netns exec sk-default/);
    assert.ok(prepared.indexOf('ip netns exec sk-default') < prepared.indexOf('export SCOPE'));
    const launch = f.commands.find((command) => command.includes('tmux new-session'))!;
    assert.match(launch, /exec ip netns exec sk-default/);
    assert.match(launch, /--disable-hot-restart/);
    assert.match(launch, /SAKURA_MESH_BINDING=[a-f0-9]{64}/);
    assert.match(launch, /SAKURA_MESH_RUN_ID=[a-f0-9-]{36}/);
    assert.ok(!launch.includes('setsid'), 'persistent tmux must survive short task cleanup');
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
    const current = await f.mesh.status(f.id);
    assert.equal(current.envoyInstalled, true);
    assert.equal(current.envoyUsable, false);
    assert.equal(current.ready, false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /incompatible Envoy/);
    assert.equal(f.running.size, 0);
    assert.equal(
      f.commands.some((command) => command.includes('tmux new-session')),
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
