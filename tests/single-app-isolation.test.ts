import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { setVmStorageRoot } from '../server/model.ts';
import { projectSchema, Workspaces } from '../server/workspaces.ts';
import { SingleAppWindows } from '../server/single-app-windows.ts';
import { appIdentity, appCleanupScript } from '../server/single-app-sandbox.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sakura-app-isolation-'));
  const id = randomUUID();
  setVmStorageRoot(id, root);
  await mkdir(join(root, id));
  await writeFile(join(root, id, 'projects.json'), JSON.stringify({ active: 'default',
    projects: [{ id: 'default', name: '默认项目' },
      { id: '1234567890abcdef', name: '其他项目' }] }));
  const commands: string[] = [];
  const live = { status: 'running' };
  let uid = 1000;
  const machines = Object.assign(new EventEmitter(), {
    get: () => ({ id, distro: 'alpine', template: 'none' }), requireUnlocked: () => {},
    locked: async (_key: string, task: () => Promise<unknown>) => task(),
    records: new Map([[id, { id }]]), live: new Map([[id, live]]), state: () => live.status,
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stderr: '', stdout: command.includes('password=$(head -c 6')
        ? `${++uid}\nAbc/123+\n` : '' };
    },
  }) as unknown as Machines;
  const workspaces = new Workspaces(machines);
  const configs = new Map([['default', projectSchema.parse({ networkIsolation: 'private' })]]);
  workspaces.config = async (vm) => {
    const scope = workspaces.projects.current(vm);
    return { ...(configs.get(scope) || projectSchema.parse({})),
      ...(scope === 'default' ? {} : { _workspace: scope }) };
  };
  const apps = new SingleAppWindows(machines, workspaces);
  return { id, commands, machines, live, workspaces, configs, apps,
    async close() {
      await apps.close();
      await workspaces.close();
      setVmStorageRoot(id);
      const path = await realpath(root);
      assert.equal(dirname(path), resolve(tmpdir()));
      assert.ok(basename(path).startsWith('sakura-app-isolation-'));
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } };
}

test('single-app transport stays bound to its launch project and cannot select another port', async () => {
  const f = await fixture();
  try {
    const first = await f.apps.start(f.id, { program: 'xterm' });
    f.configs.set('default', projectSchema.parse({ networkIsolation: 'host' }));
    const other = await f.workspaces.projects.inScope(f.id, '1234567890abcdef',
      () => f.apps.start(f.id, { program: 'xterm' }));
    assert.equal(first.networkIsolation, 'private');
    assert.equal(other.networkIsolation, 'host');
    assert.equal(other.projectId, '1234567890abcdef');
    assert.match(await f.apps.connectionCommand(f.id, first.id, first.port), /ip netns exec sk-default/);
    assert.doesNotMatch(await f.apps.connectionCommand(f.id, other.id, other.port), /ip netns/);
    await assert.rejects(f.apps.connectionCommand(f.id, first.id, other.port), /端口不匹配/);
    const launch = f.commands.find((command) => command.startsWith('tmux new-session'))!;
    assert.match(launch, /SecurityTypes VncAuth/);
    assert.doesNotMatch(launch, /SecurityTypes None/);
    assert.ok(!launch.includes(first.password), 'password must not become readable in process arguments');
    assert.match(launch, new RegExp(appIdentity(first.id).user));
    assert.match(launch, /ip netns exec sk-default/);
    assert.ok(!('project' in first) && !('uid' in first));
  } finally { await f.close(); }
});

test('active windows guard only their own project configuration and unregister on shutdown', async () => {
  const f = await fixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' });
    await f.workspaces.projects.inScope(f.id, '1234567890abcdef', () =>
      f.workspaces.save(f.id, { directory: '/other', networkIsolation: 'private' }));
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用窗口/);
    await assert.rejects(f.workspaces.save(f.id,
      { directory: '/different', networkIsolation: 'private' }), /单应用窗口/);
    await f.apps.stop(f.id, session.id);
    await f.workspaces.save(f.id, { networkIsolation: 'host' });
    const terminated = f.commands.find((command) => command.includes('signal.SIGTERM') &&
      !command.startsWith('tmux new-session'))!;
    assert.match(terminated, /signal.SIGKILL/);
    assert.match(terminated, /pidfd_send_signal/);
    assert.match(terminated, /test "\$\(id -u skapp/);
    assert.doesNotMatch(terminated, /rm -rf.*\/home\//, 'stopping cannot erase application data');
    await f.apps.close();
    await f.workspaces.save(f.id, { networkIsolation: 'host' });
  } finally { await f.close(); }
});

test('suspending a VM disconnects its app bridges but preserves the session for resume', async () => {
  const f = await fixture();
  try {
    const session = await f.apps.start(f.id, { program: 'xterm' });
    let disconnected = 0;
    f.apps.onSessionInvalidated(f.id, session.id, () => { disconnected++; });
    f.live.status = 'paused';
    f.machines.emit('change');
    assert.equal(disconnected, 1);
    await assert.rejects(f.apps.port(f.id, session.id));
    await assert.rejects(f.apps.stop(f.id, session.id), /先恢复实例/);
    await assert.rejects(f.workspaces.save(f.id, { networkIsolation: 'host' }), /单应用窗口/);
    f.live.status = 'running';
    f.machines.emit('change');
    assert.equal(await f.apps.port(f.id, session.id), session.port);
    f.apps.onSessionInvalidated(f.id, session.id, () => { disconnected++; });
    f.machines.emit('incident-lockdown', f.id);
    assert.equal(disconnected, 2);
    await f.apps.saveClipboardPolicy(f.id, 'xterm', { copy: false, paste: true });
    await assert.rejects(f.apps.connectionCommand(f.id, session.id, session.port), /规则已收紧/);
  } finally { await f.close(); }
});

test('app account cleanup rejects root and account names remain portable', () => {
  const identity = appIdentity(randomUUID());
  assert.ok(identity.user.length <= 32);
  assert.throws(() => appCleanupScript(randomUUID(), 0));
  assert.throws(() => appCleanupScript(randomUUID(), -1));
  assert.throws(() => appCleanupScript(randomUUID(), NaN));
});

test('a failed VNC firewall never launches the application or erases its data', async () => {
  const f = await fixture();
  const exec = f.machines.exec;
  f.machines.exec = async (...args) => {
    if (args[1].includes('created4=no')) {
      f.commands.push(args[1]);
      return { code: 1, stdout: '', stderr: 'owner module unavailable' };
    }
    return exec(...args);
  };
  try {
    await assert.rejects(f.apps.start(f.id, { program: 'xterm' }), /owner module unavailable/);
    assert.equal((await f.apps.list(f.id)).length, 0);
    assert.ok(!f.commands.some((command) => command.startsWith('tmux new-session')));
    assert.ok(f.commands.some((command) => command.includes('signal.SIGTERM')));
    assert.ok(!f.commands.some((command) => /rm -rf.*\/home\//.test(command)));
  } finally { await f.close(); }
});

test('shutdown stops every window without colliding with the per-VM operation lock', async () => {
  const f = await fixture();
  const locks = new Set<string>();
  f.machines.locked = async (key, task) => {
    if (locks.has(key)) throw new Error('another operation is running');
    locks.add(key);
    try { return await task(); }
    finally { locks.delete(key); }
  };
  try {
    const first = await f.apps.start(f.id, { program: 'xterm' });
    const second = await f.apps.start(f.id, { program: 'xterm' });
    await f.apps.close();
    for (const session of [first, second])
      assert.ok(f.commands.some((command) => !command.startsWith('tmux new-session') &&
        command.includes(session.id) && command.includes('signal.SIGTERM')),
      `window ${session.id} was skipped by shutdown`);
  } finally { await f.close(); }
});
