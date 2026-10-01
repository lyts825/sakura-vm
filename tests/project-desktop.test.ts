import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Writable } from 'node:stream';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import type { Secrets } from '../server/secrets.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-desktop-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Desktops } = await import('../server/desktop.ts');
const { DesktopBindings, desktopLauncherPath } = await import('../server/desktop-binding.ts');
const { desktopCommands } = await import('../server/desktop-guest.ts');
const { vmDir } = await import('../server/model.ts');
after(() => rm(root, { recursive: true, force: true }));

class Guest extends EventEmitter {
  id = randomUUID();
  record = { id: this.id, distro: 'alpine', memoryMiB: 2048, snapshots: [] };
  records = new Map([[this.id, this.record]]);
  live = new Map([[this.id, { status: 'stopped', startedAt: 'boot-1' }]]);
  locks = new Machines({} as Engine);
  locked = this.locks.locked.bind(this.locks);
  closing = false;
  phase = 'not-installed';
  files = new Map<string, string>();
  commands: string[] = [];
  starts = 0;
  invalidNetwork = false;
  failedPublish = false;
  failedStart = false;
  hangingStart = false;
  hangingPreparation = false;
  preparations = 0;
  get() { return this.record; }
  state() { return this.live.get(this.id)!.status; }
  async sftp(_id: string, work: Function) {
    return work({ createWriteStream: (path: string, options: { mode: number; flags: string }) => {
      assert.equal(options.mode, 0o700); assert.equal(options.flags, 'wx');
      let value = '';
      return new Writable({ write(chunk, _encoding, done) { value += chunk; done(); },
        final: (done) => { this.files.set(path, value); done(); } });
    } });
  }
  async exec(_id: string, command: string, _timeout?: number, signal?: AbortSignal,
    output?: (data: string) => void) {
    signal?.throwIfAborted();
    this.commands.push(command);
    let stdout = '', code = 0;
    if (command.startsWith('if [ ! -f /etc/sakura/desktop-version ]')) stdout = this.phase;
    else if (command.includes('mv -f ' + desktopLauncherPath + '.')) {
      if (this.failedPublish) code = 1;
      else this.files.set(desktopLauncherPath, this.files.get(command.match(/mv -f (\S+) /)![1])!);
    } else if (command.includes('expected=$(')) {
      const sha = createHash('sha256').update(this.files.get(desktopLauncherPath) || '').digest('hex');
      if (!command.includes(sha) || this.invalidNetwork) code = 1;
    } else if (command.includes('SAKURA_INSTALL') && !command.includes('rc-service sakura-desktop restart')) {
      this.preparations++;
      if (this.hangingPreparation) await delay(60000, undefined, { signal });
    } else if (command.includes('! rc-service sakura-desktop status')) this.phase = 'stopped';
    else if (command.includes('rc-service sakura-desktop restart')) {
      this.starts++;
      if (this.hangingStart) await delay(60000, undefined, { signal });
      output?.('private-');
      output?.('desktop-token');
      if (this.failedStart) { code = 1; stdout = 'private-desktop-token'; }
      else this.phase = 'ready';
    }
    return { code, stdout, stderr: code && this.failedStart ? 'private-desktop-token' : '' };
  }
}

async function fixture(t: TestContext) {
  const guest = new Guest(), machines = guest as unknown as MachineType;
  await mkdir(vmDir(guest.id), { recursive: true });
  const workspaces = new Workspaces(machines, {
    secrets: { resolve: async () => ({ TOKEN: 'private-desktop-token' }) } as unknown as Secrets,
  });
  const alpha = (await workspaces.projects.create(guest.id, 'Alpha', async () => {
    await workspaces.save(guest.id, { directory: '/workspace/alpha', networkIsolation: 'private',
      secrets: { TOKEN: 'desktop-key' }, environment: { HOME: '/root', DISPLAY: ':99' } });
  })).active;
  const beta = (await workspaces.projects.create(guest.id, 'Beta', async () => {
    await workspaces.save(guest.id, { directory: '/workspace/beta', networkIsolation: 'private' });
  })).active;
  guest.live.get(guest.id)!.status = 'running';
  const desktops = new Desktops(machines, workspaces), bindings = new DesktopBindings(machines);
  t.after(async () => { await desktops.close(); await workspaces.close(); });
  const scope = <T>(project: string, action: () => Promise<T>) => workspaces.projects.with(guest.id, project, action);
  const settled = async (project: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const view = await scope(project, () => desktops.view(guest.id));
      if (!['installing', 'starting'].includes(view.status)) return view;
      await delay(5);
    }
    throw new Error('Desktop operation did not settle');
  };
  const start = async (project: string) => {
    await scope(project, async () => { desktops.start(guest.id, 'start'); });
    return settled(project);
  };
  return { guest, machines, workspaces, desktops, bindings, alpha, beta, scope, start, settled };
}

test('KDE captures its project, exports secrets after dropping UID and protects display identity', async (t) => {
  const f = await fixture(t);
  const view = await f.start(f.alpha);
  assert.equal(view.status, 'ready');
  assert.equal(view.projectId, f.alpha);
  assert.equal(view.networkIsolation, 'private');
  assert.equal((await f.bindings.read(f.guest.id))!.enabled, true);
  const launcher = f.guest.files.get(desktopLauncherPath)!;
  assert.match(launcher, new RegExp(`ip netns exec sk-${f.alpha}`));
  assert.match(launcher, /\/bin\/setpriv --reuid/);
  assert.match(launcher, /cd .*workspace\/alpha/);
  assert.match(launcher, /private-desktop-token/);
  assert.doesNotMatch(launcher, /export (HOME|DISPLAY)=/);
  assert.ok(launcher.indexOf('/bin/setpriv') < launcher.indexOf('export TOKEN='));
  assert.doesNotMatch(JSON.stringify(view), /private-desktop-token/);
  assert.doesNotMatch(await readFile(join(vmDir(f.guest.id), 'desktop-binding.json'), 'utf8'), /TOKEN|private-desktop-token/);
  assert.equal((await f.scope(f.beta, () => f.desktops.view(f.guest.id))).bindingMismatch, true);
  assert.equal((await f.desktops.view(f.guest.id, true)).bindingMismatch, undefined);
});

test('a running KDE session must stop before project rebinding or directory/network edits', async (t) => {
  const f = await fixture(t);
  await f.start(f.alpha);
  assert.equal((await f.start(f.beta)).status, 'error');
  assert.equal(f.guest.starts, 1);
  await f.scope(f.alpha, async () => {
    const config = await f.workspaces.config(f.guest.id);
    await assert.rejects(f.workspaces.save(f.guest.id, { ...config, directory: '/workspace/new' }), /停止/);
    await assert.rejects(f.workspaces.save(f.guest.id, { ...config, networkIsolation: 'host' }), /停止/);
  });
  await f.desktops.stop(f.guest.id);
  assert.equal((await f.bindings.read(f.guest.id))!.enabled, false);
  assert.equal((await f.scope(f.beta, () => f.desktops.view(f.guest.id))).bindingMismatch, undefined);
  assert.equal((await f.start(f.beta)).status, 'ready');
  assert.equal((await f.bindings.read(f.guest.id))!.projectId, f.beta);
});

test('launcher publication failures and namespace drift refuse discovery without enabling recovery', async (t) => {
  const f = await fixture(t);
  f.guest.failedPublish = true;
  assert.equal((await f.start(f.alpha)).status, 'error');
  assert.equal(f.guest.starts, 0);
  assert.equal((await f.bindings.read(f.guest.id))!.enabled, false);
  f.guest.failedPublish = false;
  assert.equal((await f.start(f.alpha)).status, 'ready');
  f.guest.invalidNetwork = true;
  await assert.rejects(f.scope(f.alpha, () => f.desktops.view(f.guest.id)), /网络空间不符/);
  f.guest.invalidNetwork = false;
  f.guest.files.set(desktopLauncherPath, '# tampered');
  await assert.rejects(f.desktops.view(f.guest.id, true), /绑定/);
});

test('KDE failure logs redact resolved secrets and persist a disabled recovery binding', async (t) => {
  const f = await fixture(t);
  f.guest.failedStart = true;
  const view = await f.start(f.alpha);
  assert.equal(view.status, 'error');
  assert.doesNotMatch(JSON.stringify(view), /private-desktop-token/);
  assert.equal((await f.bindings.read(f.guest.id))!.enabled, false);
});

test('stopping KDE aborts an unfinished installation before waiting for the VM lock', async (t) => {
  const f = await fixture(t);
  f.guest.hangingPreparation = true;
  await f.scope(f.alpha, async () => { f.desktops.start(f.guest.id, 'install'); });
  for (let i = 0; i < 100 && !f.guest.preparations; i++) await delay(5);
  assert.equal(f.guest.preparations, 1);
  assert.equal(f.guest.starts, 0, 'the desktop service must not start during package preparation');
  await f.desktops.stop(f.guest.id);
  assert.equal((await f.bindings.read(f.guest.id))!.enabled, false);
  assert.ok(f.guest.commands.some((command) => command.includes('sakura_owned_anchor') && command.includes('.pid.stop')));
  assert.equal((await f.scope(f.alpha, () => f.desktops.view(f.guest.id))).status, 'stopped');
});

test('controller restart preserves an active session and a new boot recovers the saved binding', async (t) => {
  const f = await fixture(t);
  await f.start(f.alpha);
  await f.desktops.close();
  const recovered = new Desktops(f.machines, f.workspaces);
  t.after(() => recovered.close());
  await delay(30);
  assert.equal(f.guest.starts, 1, 'controller reload must not interrupt an active GUI');
  f.guest.live.get(f.guest.id)!.status = 'stopped'; f.guest.emit('change');
  f.guest.live.get(f.guest.id)!.status = 'running';
  f.guest.live.get(f.guest.id)!.startedAt = 'boot-2'; f.guest.phase = 'stopped'; f.guest.emit('change');
  for (let i = 0; i < 100 && f.guest.starts === 1; i++) await delay(5);
  assert.equal(f.guest.starts, 2);
  assert.equal((await f.scope(f.alpha, () => recovered.view(f.guest.id))).projectId, f.alpha);
});

test('stopped-instance project edits disable stale desktop recovery, and corrupt bindings never fall back', async (t) => {
  const f = await fixture(t);
  await f.start(f.alpha);
  f.guest.live.get(f.guest.id)!.status = 'stopped'; f.guest.emit('change');
  await f.scope(f.alpha, async () => {
    const config = await f.workspaces.config(f.guest.id);
    await f.workspaces.save(f.guest.id, { ...config, networkIsolation: 'host' });
  });
  assert.equal((await f.bindings.read(f.guest.id))!.enabled, false);
  await writeFile(join(vmDir(f.guest.id), 'desktop-binding.json'), 'null');
  await assert.rejects(f.bindings.read(f.guest.id));
  f.guest.live.get(f.guest.id)!.status = 'running';
  await assert.rejects(f.scope(f.alpha, () => f.desktops.view(f.guest.id)));
  await f.desktops.stop(f.guest.id);
  assert.equal(await f.bindings.read(f.guest.id), null);
  assert.equal((await f.start(f.alpha)).status, 'ready');
});
