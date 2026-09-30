import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { X11Clipboard, x11ClipboardRequest } from '../server/x11-clipboard.ts';
import { x11AssetNames } from '../server/x11-clipboard-assets.ts';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { X11ClipboardSession } from '../shared/x11-clipboard.ts';

const image = '/usr/bin/editor',
  hash = 'a'.repeat(64),
  launcher = 'b'.repeat(64);
const rule = { ...defaultClipboardRule(), copy: false };
const sessionId = '44444444-4444-4444-8444-444444444444';
async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-x11-clipboard-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const assets = join(directory, 'assets'),
    file = join(directory, 'state.json');
  await mkdir(assets);
  const buildHash = createHash('sha256'),
    files = [];
  for (const name of x11AssetNames) {
    const bytes = Buffer.from(name);
    buildHash.update(name).update(bytes);
    await writeFile(join(assets, name), bytes);
    files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const build = buildHash.digest('hex');
  await writeFile(join(assets, 'manifest.json'), JSON.stringify({ version: 1, build, files }));
  let rows: X11ClipboardSession[] = [],
    locked = false,
    failed = '',
    live = true;
  let queue = Promise.resolve();
  const calls: any[] = [];
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
      if (request.action === failed)
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
      return { code: 0, stdout: JSON.stringify(output), stderr: '' };
    },
  } as unknown as Machines;
  const secret = 'unit-project-private-value';
  const service = new X11Clipboard(
    machines,
    async () => ({
      launcherSha256: launcher,
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
    save,
    rows: (value: X11ClipboardSession[]) => {
      rows = value;
    },
    lock: () => {
      locked = true;
    },
    fail: (value: string) => {
      failed = value;
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
  assert.equal(launch.request.launcherSha256, launcher);
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
