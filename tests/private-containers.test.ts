import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines as MachinesType } from '../server/machines.ts';
const directory = await mkdtemp(join(tmpdir(), 'sakura-private-container-unit-'));
process.env.SAKURA_DATA_DIR = directory;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Containers } = await import('../server/containers.ts');
type Runtime = {
  present: boolean;
  running: boolean;
  valid: boolean;
  reason: string | null;
  runId: string | null;
  containers: number;
};
after(async () => {
  const owned = await realpath(directory);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.ok(basename(owned).startsWith('sakura-private-container-unit-'));
  await rm(owned, { recursive: true, force: true });
});
async function fixture() {
  const id = randomUUID(),
    records = new Map([
      [
        id,
        {
          id,
          name: 'test',
          distro: 'debian',
          template: 'none',
          createdAt: new Date().toISOString(),
          snapshots: [],
        },
      ],
    ]);
  const calls: Array<{ project: string; command: string }> = [],
    runtime = new Map<string, Runtime>();
  const m = Object.assign(new EventEmitter(), {
    records,
    live: new Map(),
    locks: new Set(),
    operations: new Set(),
    requireUnlocked: () => {},
    get: (key: string) => {
      assert.equal(key, id);
      return records.get(id);
    },
    state: () => 'running',
  });
  const machines = m as unknown as MachinesType;
  machines.locked = Machines.prototype.locked.bind(machines);
  await mkdir(join(directory, 'machines', id), { recursive: true });
  const workspaces = new Workspaces(machines);
  machines.exec = async (_id, command) => {
    const project = workspaces.projects.current(id);
    calls.push({ project, command });
    if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
      return { code: 0, stdout: 'absent\n', stderr: '' };
    if (command.includes('SAKURA_PROJECT_DOCKER_PRESENT'))
      return { code: 0, stdout: runtime.has(project) ? 'SAKURA_PROJECT_DOCKER_PRESENT\n' : '', stderr: '' };
    if (command.includes('data=json.loads') && command.includes('containerd'))
      return {
        code: 0,
        stdout: JSON.stringify(
          runtime.get(project) || {
            present: false,
            running: false,
            valid: false,
            reason: null,
            runId: null,
            containers: 0,
          },
        ),
        stderr: '',
      };
    return { code: 0, stdout: '', stderr: '' };
  };
  const index = await workspaces.projects.create(id, 'private', () =>
    workspaces
      .save(id, {
        directory: '/workspace/private',
        networkIsolation: 'private',
        environment: { SCOPE: 'private' },
      })
      .then(() => {}),
  );
  const project = index.active,
    containers = new Containers(machines, workspaces);
  runtime.set(project, {
    present: true,
    running: true,
    valid: true,
    reason: null,
    runId: randomUUID(),
    containers: 1,
  });
  calls.length = 0;
  const within = <T>(work: () => Promise<T>) => workspaces.projects.with(id, project, work);
  return {
    id,
    machines,
    workspaces,
    containers,
    project,
    runtime,
    calls,
    within,
    close: async () => {
      await containers.close();
      await workspaces.close();
    },
  };
}
test('container jobs keep the requested project when the active project changes', async () => {
  const f = await fixture();
  try {
    await f.within(() => f.containers.run(f.id, { action: 'start', id: '0123456789ab' }));
    await f.workspaces.projects.update(f.id, 'default');
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'done');
    assert.equal(f.containers.jobs.view(f.id)?.projectId, f.project);
    assert.ok(f.calls.length > 1);
    assert.ok(f.calls.every((call) => call.project === f.project));
    const launch = f.calls.find((call) => call.command.includes('setsid sh'))!;
    assert.ok(launch.command.includes('nsenter --net=/run/netns/sk-' + f.project));
    assert.ok(launch.command.includes('/etc/sakura/docker/' + f.project + '/docker-client'));
    assert.ok(!launch.command.includes('unix:///var/run/docker.sock'));
  } finally {
    await f.close();
  }
});
test('saved Docker bindings prevent changes after the container plugin closes and while containers are stopped', async () => {
  const f = await fixture();
  try {
    await f.containers.close();
    const config = await f.within(() => f.workspaces.config(f.id));
    await f.within(() =>
      assert.rejects(
        f.workspaces.save(f.id, { ...config, directory: '/workspace/new' }),
        /移除项目容器并停止/,
      ),
    );
    f.runtime.get(f.project)!.running = false;
    await f.within(() =>
      assert.rejects(f.workspaces.save(f.id, { ...config, networkIsolation: 'host' }), /移除项目容器并停止/),
    );
    f.runtime.get(f.project)!.containers = 0;
    await f.within(() => f.workspaces.save(f.id, { ...config, directory: '/workspace/new' }));
    assert.equal((await f.within(() => f.workspaces.config(f.id))).directory, '/workspace/new');
  } finally {
    await f.close();
  }
});
test('an existing VM operation prevents container execution before any guest mutation', async () => {
  const f = await fixture();
  let release!: () => void;
  const hold = f.machines.locked(
    f.id,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    await f.within(() => f.containers.run(f.id, { action: 'start', id: '0123456789ab' }));
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'error');
    assert.match(f.containers.jobs.view(f.id)?.error || '', /另一项操作/);
    assert.equal(f.calls.length, 0);
  } finally {
    release();
    await hold;
    await f.close();
  }
});
test('container cleanup stays usable when the project secret provider is unavailable', async () => {
  const f = await fixture();
  try {
    const config = await f.within(() => f.workspaces.config(f.id));
    await f.within(() => f.workspaces.save(f.id, { ...config, secrets: { TOKEN: 'missing-key' } }));
    await f.within(() => f.containers.run(f.id, { action: 'stop', id: '0123456789ab' }));
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'done');
    assert.ok(f.calls.some((call) => call.command.includes('docker-client')));
    assert.ok(f.calls.every((call) => !call.command.includes('export TOKEN')));
    await f.within(() => f.containers.run(f.id, { action: 'start', id: '0123456789ab' }));
    await f.containers.jobs.wait(f.id);
    assert.equal(f.containers.jobs.view(f.id)?.status, 'error');
    assert.match(f.containers.jobs.view(f.id)?.error || '', /启用 secrets 插件/);
  } finally {
    await f.close();
  }
});

test('container logs redact database credentials, Redis arguments and rotated project secrets', async () => {
  const f = await fixture();
  try {
    const config = await f.within(() => f.workspaces.config(f.id));
    f.workspaces.resolvedConfig = async () => ({
      ...config,
      secrets: { CUSTOM_CREDENTIAL: 'test-key' },
      environment: { CUSTOM_CREDENTIAL: 'new-secret' },
    });
    const previous = f.machines.exec;
    f.machines.exec = async (id, command, ...args) => {
      if (command.includes('docker inspect --format'))
        return {
          code: 0,
          stdout: JSON.stringify({
            Env: ['MYSQL_PASSWORD=database-secret', 'API_TOKEN=api-secret', 'CUSTOM_CREDENTIAL=old-secret'],
            Cmd: ['redis-server', '--requirepass', 'redis-secret'],
          }),
          stderr: '',
        };
      if (command.includes('docker logs --tail'))
        return {
          code: 0,
          stdout: 'database-secret api-secret redis-secret old-secret new-secret',
          stderr: '',
        };
      return previous(id, command, ...args);
    };
    const result = await f.within(() => f.containers.logs(f.id, '0123456789ab'));
    assert.equal(
      result.log,
      '[私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏] [私密配置已隐藏]',
    );
  } finally {
    await f.close();
  }
});
