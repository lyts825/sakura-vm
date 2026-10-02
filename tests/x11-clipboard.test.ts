import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { X11Clipboard, x11ClipboardRequest } from '../server/x11-clipboard.ts';
import { WaylandClipboard } from '../server/wayland-clipboard.ts';
import { waylandAssetNames } from '../server/wayland-clipboard-assets.ts';
import { x11AssetNames } from '../server/x11-clipboard-assets.ts';
import { desktopControlProofSchema } from '../server/desktop-project-control.ts';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { X11ClipboardSession } from '../shared/x11-clipboard.ts';

const image = '/usr/bin/editor',
  hash = 'a'.repeat(64),
  launcher = 'b'.repeat(64);
const projectId = 'abcdefabcdefabcd', identityId = '11111111-1111-4111-8111-111111111111',
  runId = '22222222-2222-4222-8222-222222222222', bootId = '33333333-3333-4333-8333-333333333333';
const identity = { version: 1 as const, phase: 'active' as const, projectId, registryId: bootId, identityId, revision: 3,
  account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20001, gid: 20001,
  home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace/private',
  directoryDevice: '12', directoryInode: '101', homeDevice: '12', homeInode: '102', networkIsolation: 'private' as const };
const run = { version: 1 as const, phase: 'active' as const, mode: 'inherit-current' as const, projectId, registryId: bootId,
  identityId, revision: 3, runId, bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '1000',
  cgroupDevice: '29', cgroupInode: '1001', cgroupName: 'sakura-service-' + runId, namespace: 'sk-' + projectId };
const desktop = { version: 1 as const, identity, run, record: { version: 1 as const, projectId, name: 'desktop' as const,
  session: 'sakura-desktop-' + projectId, runId, bootId, scopeName: run.cgroupName, inode: run.cgroupInode,
  binding: 'b'.repeat(64), phase: 'running' as const, sessionId: '$1', paneId: '%1', panePid: 3456, paneStartTicks: '4567' },
  sha256: launcher, runtime: '/run/sakura-desktop-uid/20001/' + runId,
  endpoint: { plasmaPid: 1234, plasmaCreated: '2345', vncPid: 2345, vncCreated: '3456', runtimeDevice: '12',
    runtimeInode: '2001', xauthDevice: '12', xauthInode: '2002', xauthSha256: 'c'.repeat(64), readyDevice: '12', readyInode: '2003' } };
desktopControlProofSchema.parse({ ...desktop, build: run.build });
const rule = { ...defaultClipboardRule(), copy: false };
const sessionId = '44444444-4444-4444-8444-444444444444';
async function fixture(t: any, transport: 'x11' | 'wayland' = 'x11') {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-x11-clipboard-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const assets = join(directory, 'assets'),
    file = join(directory, 'state.json');
  await mkdir(assets);
  const buildHash = createHash('sha256'),
    files = [];
  for (const name of transport === 'wayland' ? waylandAssetNames : x11AssetNames) {
    const bytes = Buffer.from(name);
    buildHash.update(name).update(bytes);
    await writeFile(join(assets, name), bytes);
    files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const build = buildHash.digest('hex');
  await writeFile(join(assets, 'manifest.json'), JSON.stringify({ version: 1, build, files }));
  let rows: X11ClipboardSession[] = [],
    locked = false,
    failed: string[] = [],
    live = true;
  let queue = Promise.resolve();
  const calls: any[] = [], leases = { validated: 0, released: 0 };
  const machines = {
    get: () => ({ distro: 'debian' }),
    state: () => (live ? 'running' : 'stopped'),
    requireUnlocked: () => {
      if (locked) throw Error('locked');
    },
    locked: (_key: string, action: () => Promise<any>) => {
      const current = queue.then(action);
      queue = current.then(
        () => {},
        () => {},
      );
      return current;
    },
    exec: async (_id: string, code: string) => {
      const encoded = code.match(/[A-Za-z0-9+/]{64,}={0,2}/g) || [];
      let request: any;
      for (const value of encoded) {
        try {
          const decoded = JSON.parse(Buffer.from(value, 'base64').toString());
          if (decoded.action && decoded.owner) request = decoded;
        } catch {}
      }
      if (!request) return { code: 0, stdout: '', stderr: '' };
      calls.push({ request, code });
      if (failed.includes(request.action))
        return { code: 1, stdout: JSON.stringify({ error: 'injected native failure' }), stderr: '' };
      let output: unknown;
      if (request.action === 'list') output = { ready: true, build, sessions: rows };
      if (request.action === 'identify') output = { image, sha256: hash };
      if (request.action === 'configure') {
        const row = rows.find((item) => item.id === request.id)!;
        Object.assign(row, { active: request.enabled, generation: request.generation, rule: request.rule });
        output = row;
      }
      if (request.action === 'launch') {
        const journal = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(journal.owner, request.owner, 'owner journal must precede guest launch');
        const row = {
          id: request.id,
          state: 'running',
          image,
          sha256: hash,
          projectId: request.projectId,
          directory: request.directory,
          desktopOwner: { projectId, uid: identity.uid, runId },
          applicationOwner: { uid: transport === 'wayland' ? 12345 : identity.uid,
            kind: transport === 'wayland' ? 'window-sandbox' : 'project-desktop' },
          active: true,
          compatible: true,
          generation: request.generation,
          rule: request.rule,
          blockedCopy: 2,
          blockedPaste: 0,
          processes: [{ pid: 7654, created: '456', image, loaded: true }],
        } as X11ClipboardSession;
        rows.push(row);
        output = row;
      }
      if (request.action === 'stop') {
        const row = rows.find((item) => item.id === request.id);
        if (row) row.state = 'stopped';
        output = { stopped: true };
      }
      if (request.action === 'stop-desktop') {
        const expected = { ...request.desktop, record: { ...request.desktop.record, phase: 'running' } };
        assert.deepEqual(expected, desktop);
        const selected = rows.filter(row => row.desktopOwner?.runId === request.desktop.run.runId);
        for (const row of selected) row.state = 'stopped';
        output = { stopped: true, sessions: selected.map(row => row.id) };
      }
      return { code: 0, stdout: JSON.stringify(output), stderr: '' };
    },
  } as unknown as Machines;
  const secret = 'unit-project-private-value';
  const Service = transport === 'wayland' ? WaylandClipboard : X11Clipboard;
  const service = new Service(
    machines,
    async () => ({
      desktop,
      validate: async () => { ++leases.validated; },
      release: async () => { ++leases.released; },
      project: {
        directory: '/workspace/private',
        template: 'none',
        repository: '',
        setup: '',
        command: '',
        networkIsolation: 'private',
        _workspace: 'abcdefabcdefabcd',
        environment: { TOKEN: secret, LD_PRELOAD: 'foreign', DISPLAY: ':99' },
      },
    }),
    { assets, file: () => file, jobsDirectory: join(directory, 'jobs') },
  );
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const row = (): X11ClipboardSession => ({
    id: sessionId,
    state: 'running',
    image,
    sha256: hash,
    active: true,
    rule: defaultClipboardRule(),
    compatible: true,
    blockedCopy: 1,
    blockedPaste: 0,
  });
  const save = async (version = 1) =>
    service.action('vm', {
      action: 'save',
      version,
      application: { image, sha256: hash, rule },
    }) as Promise<any>;
  return {
    directory,
    assets,
    file,
    build,
    service,
    machines,
    secret,
    row,
    calls,
    leases,
    save,
    rows: (value: X11ClipboardSession[]) => {
      rows = value;
    },
    lock: () => {
      locked = true;
    },
    fail: (value: string | string[]) => {
      failed = Array.isArray(value) ? value : value ? [value] : [];
    },
    stopVm: () => {
      live = false;
    },
  };
}

test('X11 settings reject traversal, shell bodies, privilege bypass options and extra rule fields', () => {
  for (const value of ['/usr/bin/../editor', '//usr/bin/editor', '/usr/bin/editor/', 'editor'])
    assert.equal(x11ClipboardRequest.safeParse({ action: 'identify', image: value }).success, false);
  assert.equal(
    x11ClipboardRequest.safeParse({ action: 'launch', version: 1, image, args: ['line\ncommand'] }).success,
    false,
  );
  assert.equal(
    x11ClipboardRequest.safeParse({ action: 'launch', version: 1, image, networkIsolation: 'host' }).success,
    false,
  );
  assert.equal(
    x11ClipboardRequest.safeParse({
      action: 'save',
      version: 1,
      application: { image, sha256: hash, rule: { ...rule, preload: false } },
    }).success,
    false,
  );
});

test('X11 launch journals its owner, preserves project scope and sends environment hashes without private values', async (t) => {
  const f = await fixture(t);
  await f.save();
  const started = (await f.service.action('vm', {
    action: 'launch',
    version: 2,
    image,
    args: ['--name', 'space & $()'],
  })) as any;
  assert.equal(started.state, 'running');
  const launch = f.calls.find((call) => call.request.action === 'launch');
  assert.deepEqual(launch.request.desktop, desktop);
  assert.equal(launch.request.launcherSha256, undefined);
  assert.match(launch.code, /env -i PATH=/);
  assert.equal(launch.request.projectId, 'abcdefabcdefabcd');
  assert.equal(launch.request.networkNamespace, 'sk-abcdefabcdefabcd');
  assert.ok(launch.code.includes('ip netns exec sk-abcdefabcdefabcd'));
  assert.ok(!launch.code.includes('ip netns exec sk-abcdefabcdefabcd sh -lc'));
  assert.deepEqual(launch.request.environment, {
    TOKEN: createHash('sha256').update(f.secret).digest('hex'),
  });
  assert.ok(!JSON.stringify(launch.request).includes(f.secret));
  assert.deepEqual(launch.request.args, ['--name', 'space & $()']);
});

test('X11 live tightening survives service reload and removal explicitly disables existing agents', async (t) => {
  const f = await fixture(t);
  f.rows([f.row()]);
  const saved = await f.save();
  assert.equal(saved.sessions[0].rule.copy, false);
  const owner = JSON.parse(await readFile(f.file, 'utf8')).owner;
  await f.service.close();
  assert.equal(f.calls.filter((call) => call.request.action === 'stop').length, 0);
  const restored = new X11Clipboard(
    f.machines,
    async () => {
      throw Error('not used');
    },
    { assets: f.assets, file: () => f.file, jobsDirectory: join(f.directory, 'reload-jobs') },
  );
  t.after(() => restored.close());
  assert.equal((await restored.view('vm')).sessions[0].state, 'running');
  assert.equal(f.calls.at(-1).request.owner, owner);
  const removed = (await restored.action('vm', { action: 'remove', version: 2, image })) as any;
  assert.equal(removed.applications.length, 0);
  assert.equal(removed.sessions[0].active, false);
  assert.equal(f.calls.findLast((call) => call.request.action === 'configure').request.enabled, false);
});

test('X11 failed native updates remain visible and refresh retries the saved intent', async (t) => {
  const f = await fixture(t);
  f.rows([f.row()]);
  f.fail('configure');
  const saved = await f.save();
  assert.equal(saved.version, 2);
  assert.equal(saved.sessions[0].state, 'error');
  assert.ok(saved.error.includes('failure'));
  f.fail('');
  const refreshed = (await f.service.action('vm', { action: 'refresh' })) as any;
  assert.equal(refreshed.sessions[0].state, 'running');
  assert.equal(refreshed.sessions[0].rule.copy, false);
  await assert.rejects(f.save(), /配置已变化/);
});

test('Wayland broker service journals a distinct owner, project binding and literal arguments', async (t) => {
  const f = await fixture(t, 'wayland');
  await f.save();
  const started = await f.service.action('vm', { action: 'launch', version: 2, image,
    args: ['--name', 'space & $()'] }) as any;
  assert.equal(started.state, 'running');
  const launch = f.calls.find(call => call.request.action === 'launch');
  assert.match(launch.code, /sakura-wayland-clipboard/);
  assert.equal(launch.request.projectId, 'abcdefabcdefabcd');
  assert.equal(launch.request.networkNamespace, 'sk-abcdefabcdefabcd');
  assert.deepEqual(launch.request.desktop, desktop);
  assert.equal(launch.request.launcherSha256, undefined);
  assert.match(launch.code, /env -i PATH=/);
  assert.deepEqual(launch.request.args, ['--name', 'space & $()']);
  assert.deepEqual(launch.request.environment, { TOKEN: createHash('sha256').update(f.secret).digest('hex') });
  assert.ok(!JSON.stringify(launch.request).includes(f.secret));
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).owner, launch.request.owner);
});

test('Wayland reload retains broker ownership and incomplete tightening remains visible until refresh succeeds', async (t) => {
  const f = await fixture(t, 'wayland');
  f.rows([f.row()]);
  f.fail('configure');
  const saved = await f.save();
  assert.equal(saved.sessions[0].state, 'error');
  const owner = JSON.parse(await readFile(f.file, 'utf8')).owner;
  await f.service.close();
  const restored = new WaylandClipboard(f.machines, async () => { throw Error('unused'); },
    { assets: f.assets, file: () => f.file, jobsDirectory: join(f.directory, 'reload-jobs') });
  t.after(() => restored.close());
  f.fail('');
  const refreshed = await restored.action('vm', { action: 'refresh' }) as any;
  assert.equal(refreshed.sessions[0].state, 'running');
  assert.equal(refreshed.sessions[0].rule.copy, false);
  assert.equal(f.calls.findLast(call => call.request.action === 'configure').request.owner, owner);
  const removed = await restored.action('vm', { action: 'remove', version: 2, image }) as any;
  assert.equal(removed.sessions[0].active, false);
  assert.equal(f.calls.filter(call => call.request.action === 'stop').length, 0);
});

test('Wayland validates all packaged sources before any broker action', async (t) => {
  const f = await fixture(t, 'wayland');
  await writeFile(join(f.assets, 'primary-selection-unstable-v1.xml'), 'corrupted');
  await assert.rejects(f.service.action('vm', { action: 'identify', image }), /源码摘要不符/);
  assert.equal(f.calls.length, 0);
});

test('X11 disk failure cannot replace cached settings or issue an unjournaled rule update', async (t) => {
  const f = await fixture(t);
  f.rows([f.row()]);
  await f.service.view('vm');
  await mkdir(f.file);
  const before = f.calls.length;
  await assert.rejects(f.save());
  assert.equal(f.calls.slice(before).filter((call) => call.request.action === 'configure').length, 0);
  await rmdir(f.file);
  assert.equal((await f.service.view('vm')).version, 1);
});

test('X11 corrupted source bundles are rejected before native actions and locks or stopped guests refuse writes', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.assets, 'policy.cpp'), 'changed');
  await assert.rejects(f.service.action('vm', { action: 'refresh' }), /摘要不符/);
  assert.equal(f.calls.length, 0);
  f.lock();
  await assert.rejects(f.service.action('vm', { action: 'stop', id: sessionId }), /locked/);
  const other = await fixture(t);
  other.stopVm();
  await assert.rejects(other.save(), /启动 Linux 实例/);
  assert.equal((await other.service.view('vm')).ready, false);
});

test('X11 launch failure cleans only the allocated session and refuses unsaved applications', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.action('vm', { action: 'launch', version: 1, image }), /先绑定应用/);
  await f.save();
  f.fail('launch');
  await assert.rejects(f.service.action('vm', { action: 'launch', version: 2, image }), /failure/);
  const launch = f.calls.findLast((call) => call.request.action === 'launch').request;
  const stopped = f.calls.findLast((call) => call.request.action === 'stop').request;
  assert.equal(stopped.id, launch.id);
  assert.notEqual(stopped.id, sessionId);
  assert.equal(stopped.owner, launch.owner);
});

for (const transport of ['x11', 'wayland'] as const) {
  test(`${transport} launch rollback503 retains preparation until exact original stop ACK`, async t => {
    const f = await fixture(t, transport); await f.save(); f.fail(['launch', 'stop']);
    await assert.rejects(f.service.action('vm', { action: 'launch', version: 2, image }),
      { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAILED' });
    assert.equal(f.leases.released, 0);
    const request = f.calls.findLast(call => call.request.action === 'launch').request;
    await assert.rejects(f.service.action('vm', { action: 'stop', id: request.id }), { status: 503 });
    assert.equal(f.leases.released, 0); f.fail('');
    await f.service.action('vm', { action: 'stop', id: request.id }); assert.equal(f.leases.released, 1);
  });

  test(`${transport} Desktop retirement matches full original owner and preserves neighboring application domain`, async t => {
    const f = await fixture(t, transport); await f.save();
    const launched = await f.service.action('vm', { action: 'launch', version: 2, image }) as X11ClipboardSession;
    assert.equal(f.leases.validated, 2); assert.equal(f.leases.released, 1);
    assert.equal(launched.desktopOwner!.uid, 20001);
    assert.equal(launched.applicationOwner!.uid, transport === 'wayland' ? 12345 : 20001);
    const neighbor: X11ClipboardSession = { ...launched, id: sessionId,
      desktopOwner: { ...launched.desktopOwner!, runId: '55555555-5555-4555-8555-555555555555' } };
    f.rows([launched, neighbor]); f.fail('stop-desktop');
    await assert.rejects(f.service.retireDesktop('vm', { ...desktop, build: run.build }),
      { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAILED' });
    assert.equal(launched.state, 'running'); f.fail('');
    await f.service.retireDesktop('vm', { ...desktop, record: { ...desktop.record, phase: 'stopped' }, build: run.build });
    assert.equal(launched.state, 'stopped'); assert.equal(neighbor.state, 'running');
    assert.equal(f.calls.findLast(call => call.request.action === 'stop-desktop').request.desktop.run.runId, runId);
  });
}
