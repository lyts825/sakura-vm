import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import {
  NativeIntegration,
  nativeRegistration,
  checkedHostPath,
  nativeRequest,
} from '../server/native-integration.ts';
import { windowsRegistry, systemExecutable, type RegistryEntry } from '../server/windows-shell.ts';
import type { NativeMapping, NativeSettings } from '../shared/native-integration.ts';
// @ts-ignore: the helper is deliberately dependency-free JavaScript for released installs.
import { parseNativeArguments, requestNativeOpen } from '../scripts/native-open.mjs';

const vmId = '11111111-1111-4111-8111-111111111111';
const settings: NativeSettings = {
  contextMenu: true,
  editor: 'notepad',
  associations: [{ extension: '.txt', vmId, projectId: 'default' }],
};
async function fixture(t: any, adapter?: (a: RegistryEntry[], b: RegistryEntry[]) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'sakura-native-'));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const host = join(dir, '项目 & $()');
  await mkdir(host);
  await writeFile(join(host, 'hello & 中文.txt'), 'hello');
  const mapping: NativeMapping = { vmId, projectId: 'default', name: 'demo', host, guest: '/workspace/中文' };
  let mappings = [mapping];
  const launches: any[] = [],
    registry: any[] = [];
  const runtime = {
    supported: true,
    node: process.execPath,
    helper: resolve('scripts/native-open.mjs'),
    port: 7337,
  };
  const file = join(dir, 'native.json');
  let now = Date.now();
  const service = new NativeIntegration(
    async () => mappings,
    file,
    adapter ||
      (async (a, b) => {
        registry.push([a, b]);
      }),
    async (file, args) => {
      launches.push({ file, args });
    },
    runtime,
    undefined,
    () => now,
  );
  t.after(() => service.close());
  await service.init();
  return {
    service,
    dir,
    file,
    host,
    mapping,
    launches,
    registry,
    runtime,
    setMappings: (value: NativeMapping[]) => {
      mappings = value;
    },
    advance: () => {
      now += 300001;
    },
  };
}

test('Windows registration quotes executable paths, preserves trailing root separators and never sets extension defaults', () => {
  const entries = nativeRegistration(
    '0123456789abcdef',
    settings,
    'C:\\Program Files\\node.exe',
    'D:\\项目\\native-open.mjs',
    7337,
  );
  assert.equal(entries.filter((e) => e.path.endsWith('command')).length, 4);
  assert.ok(entries.some((e) => e.value.endsWith('--shell-path "%V|"')));
  assert.ok(entries.every((e) => !e.path.includes('UserChoice')));
  assert.ok(
    entries.filter((e) => e.path.startsWith('.txt')).every((e) => e.name.startsWith('Sakura.Workspace.')),
  );
  assert.equal(
    entries.find((e) => e.path.endsWith('txt\\shell\\open\\command'))?.value,
    '"C:\\Program Files\\node.exe" "D:\\项目\\native-open.mjs" --port 7337 --extension .txt --shell-path "%1|"',
  );
  assert.throws(
    () => nativeRegistration('0123456789abcdef', settings, 'C:\\%1\\node.exe', 'D:\\helper.mjs', 7337),
    /百分号/,
  );
  assert.equal(
    nativeRequest.safeParse({
      action: 'configure',
      version: 1,
      settings: { ...settings, associations: [...settings.associations, ...settings.associations] },
    }).success,
    false,
  );
});

test('native settings persist a repair journal before registry changes and recover after restart', async (t) => {
  let fail = true;
  const f = await fixture(t, async () => {
    if (fail) throw new Error('registry failed');
  });
  await assert.rejects(f.service.action({ action: 'configure', version: 1, settings }), /registry failed/);
  const stored = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(stored.version, 2);
  assert.ok(stored.pending.entries.length > 0);
  assert.equal((await f.service.view()).pending, true);
  await assert.rejects(f.service.action({ action: 'configure', version: 1, settings }), /已改变/);
  await assert.rejects(f.service.action({ action: 'configure', version: 2, settings }), /先修复/);
  fail = false;
  const restarted = new NativeIntegration(
    async () => [f.mapping],
    f.file,
    async (previous, next) => {
      assert.equal(previous.length, 0);
      assert.deepEqual(next, stored.pending.entries);
    },
    undefined,
    f.runtime,
  );
  t.after(() => restarted.close());
  await restarted.init();
  await restarted.action({ action: 'repair', version: 2 });
  assert.equal((await restarted.view()).pending, false);
  assert.deepEqual((await restarted.view()).settings, settings);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).pending, undefined);
});

test('Explorer handoff maps nested paths and explicit file associations to the right project, with expiring revocable tickets', async (t) => {
  const f = await fixture(t);
  await f.service.action({ action: 'configure', version: 1, settings });
  const opened: any = await f.service.action({
    action: 'receive',
    path: join(f.host, 'hello & 中文.txt'),
    extension: '.txt',
  });
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:7337\/#native=/);
  assert.equal(opened.url.includes('中文'), false);
  assert.deepEqual(await f.service.action({ action: 'resolve', ticket: opened.ticket }), {
    vmId,
    projectId: 'default',
    path: '/workspace/中文/hello & 中文.txt',
    directory: false,
  });
  const directory: any = await f.service.action({ action: 'receive', path: f.host });
  assert.equal(
    ((await f.service.action({ action: 'resolve', ticket: directory.ticket })) as any).directory,
    true,
  );
  f.setMappings([{ ...f.mapping, guest: '/other' }]);
  await assert.rejects(f.service.action({ action: 'resolve', ticket: opened.ticket }), /已改变/);
  f.setMappings([f.mapping]);
  f.advance();
  await assert.rejects(f.service.action({ action: 'resolve', ticket: opened.ticket }), /已过期/);
  const other: any = await f.service.action({ action: 'receive', path: f.host });
  f.service.revoke();
  await assert.rejects(f.service.action({ action: 'resolve', ticket: other.ticket }), /已过期/);
});

test('unregistered entry points, ambiguous roots, wrong extensions and paths outside a workspace are rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host }), /未启用/);
  await f.service.action({ action: 'configure', version: 1, settings });
  await assert.rejects(f.service.action({ action: 'receive', path: f.dir }), /不在/);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host, extension: '.txt' }), /类型/);
  f.setMappings([f.mapping, { ...f.mapping, projectId: 'aaaaaaaaaaaaaaaa' }]);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host }), /多个项目/);
  const picked: any = await f.service.action({
    action: 'receive',
    path: join(f.host, 'hello & 中文.txt'),
    extension: '.txt',
  });
  assert.equal(
    ((await f.service.action({ action: 'resolve', ticket: picked.ticket })) as any).projectId,
    'default',
  );
  await f.service.action({
    action: 'configure',
    version: 2,
    settings: { ...settings, contextMenu: false, associations: [] },
  });
  assert.deepEqual(f.registry.at(-1)[1], []);
  await assert.rejects(f.service.action({ action: 'receive', path: f.host }), /未启用/);
});

test('host opens launch only fixed programs with separate literal arguments and revalidate path containment', async (t) => {
  const f = await fixture(t);
  const request = {
    action: 'open',
    vmId,
    projectId: 'default',
    path: '/workspace/中文/hello & 中文.txt',
    target: 'editor',
  };
  await f.service.action(request);
  assert.equal(f.launches[0].file, systemExecutable('notepad.exe'));
  assert.deepEqual(f.launches[0].args, [join(f.host, 'hello & 中文.txt')]);
  await f.service.action({ ...request, target: 'explorer' });
  assert.deepEqual(f.launches[1].args, ['/select,', join(f.host, 'hello & 中文.txt')]);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文/../secret.txt' }), /不在/);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文/hello:stream' }), /不在/);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文/missing.txt' }), /尚不存在/);
  await assert.rejects(f.service.action({ ...request, path: '/workspace/中文' }), /记事本只能/);
  assert.equal(f.launches.length, 2);
});

test('native file checking rejects junction escapes, hard links, ambiguous names and foreign roots', async (t) => {
  const f = await fixture(t);
  const outside = join(f.dir, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(outside, join(f.host, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(checkedHostPath(f.host, join(f.host, 'escape', 'secret.txt')), /联接/);
  await link(join(outside, 'secret.txt'), join(f.host, 'hard.txt'));
  await assert.rejects(checkedHostPath(f.host, join(f.host, 'hard.txt')), /链接/);
  await assert.rejects(checkedHostPath(f.host, join(outside, 'secret.txt')), /不在/);
  await assert.rejects(checkedHostPath(f.host, join(f.host, 'name.')), /不支持/);
});

test('revocation during async resolution and incident guards prevent native launches', async (t) => {
  const f = await fixture(t);
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const service = new NativeIntegration(
    async () => {
      await gate;
      return [f.mapping];
    },
    f.file,
    async () => {},
    async () => assert.fail('must not launch'),
    f.runtime,
  );
  const pending = service.action({
    action: 'open',
    vmId,
    projectId: 'default',
    path: '/workspace/中文/hello & 中文.txt',
    target: 'editor',
  });
  service.revoke();
  unblock();
  await assert.rejects(pending, /失效/);
  await service.close();
  const locked = new NativeIntegration(
    async () => [f.mapping],
    f.file,
    async () => {},
    async () => assert.fail('must not launch'),
    f.runtime,
    (id) => {
      if (id) throw new Error('incident locked');
    },
  );
  await assert.rejects(
    locked.action({
      action: 'open',
      vmId,
      projectId: 'default',
      path: '/workspace/中文/hello & 中文.txt',
      target: 'editor',
    }),
    /incident locked/,
  );
  await locked.close();
});

test('Explorer helper authenticates on the fixed loopback port and treats filenames as data', async () => {
  const path = resolve('scripts/native-open.mjs');
  assert.deepEqual(parseNativeArguments(['--port', '7337', '--shell-path', `${path}|`]), {
    port: 7337,
    path,
    extension: undefined,
    print: false,
  });
  assert.throws(() => parseNativeArguments(['--port', '80', '--', path]));
  assert.throws(() => parseNativeArguments(['--', path, '--evil']));
  const sent: any[] = [];
  const ticket = randomUUID();
  const url = await requestNativeOpen(
    { path, port: 7337, extension: '.txt' },
    async (url: string, init: any) => {
      sent.push({ url, init });
      return Response.json(
        sent.length === 1 ? { token: 'a'.repeat(64) } : { ticket, url: 'https://untrusted.example/' },
      );
    },
  );
  assert.equal(url, `http://127.0.0.1:7337/#native=${ticket}`);
  assert.equal(sent[1].init.headers['X-Sakura-Token'], 'a'.repeat(64));
  assert.deepEqual(JSON.parse(sent[1].init.body), { action: 'receive', path, extension: '.txt' });
  await assert.rejects(
    requestNativeOpen({ path, port: 7337 }, async () => Response.json({ error: 'locked' }, { status: 423 })),
    /locked/,
  );
});

test(
  'Windows registry adapter round-trips Unicode values, refuses foreign changes and preserves foreign keys',
  { skip: process.platform !== 'win32' },
  async () => {
    const root = `Software\\Sakura\\IntegrationTests\\${randomUUID()}`;
    const adapter = windowsRegistry(root);
    const execute = promisify(execFile);
    const ps = async (source: string) =>
      (
        await execute(
          systemExecutable('powershell.exe'),
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(source, 'utf16le').toString('base64'),
          ],
          { windowsHide: true },
        )
      ).stdout.trim();
    const key = `${root}\\Sakura.Workspace.test`,
      path = 'Sakura.Workspace.test';
    const initial = [{ path, name: '', value: '中文 & $() "literal"' }];
    try {
      await adapter([], initial);
      const data = await ps(
        `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); try { $k.GetValue('') | ConvertTo-Json -Compress } finally { $k.Dispose() }`,
      );
      assert.equal(JSON.parse(data), initial[0].value);
      await ps(
        `$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key}'); try { $k.SetValue('Foreign', 'keep'); $k.SetValue('', 'changed') } finally { $k.Dispose() }`,
      );
      await assert.rejects(adapter(initial, []), /其他程序修改/);
      await ps(
        `$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key}'); try { $k.SetValue('', 'owned') } finally { $k.Dispose() }`,
      );
      await adapter([{ ...initial[0], value: 'owned' }], []);
      assert.equal(
        await ps(
          `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); try { $k.GetValue('Foreign') } finally { $k.Dispose() }`,
        ),
        'keep',
      );
    } finally {
      assert.match(root, /^Software\\Sakura\\IntegrationTests\\[a-f0-9-]{36}$/);
      await ps(`[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree('${root}', $false)`);
    }
  },
);

test('the released Explorer helper performs an authenticated HTTP handoff as a real Windows process', async (t) => {
  const f = await fixture(t);
  await f.service.action({ action: 'configure', version: 1, settings });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/api/bootstrap') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ token: 'a'.repeat(64) }));
        return;
      }
      assert.equal(req.headers['x-sakura-token'], 'a'.repeat(64));
      let body = '';
      for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(await f.service.action(JSON.parse(body))));
    } catch (error: any) {
      res
        .writeHead(error.status || 400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const port = (server.address() as any).port;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      resolve('scripts/native-open.mjs'),
      '--port',
      String(port),
      '--print-url',
      '--extension',
      '.txt',
      '--shell-path',
      `${join(f.host, 'hello & 中文.txt')}|`,
    ],
    { windowsHide: true },
  );
  assert.match(stdout.trim(), new RegExp(`^http://127\\.0\\.0\\.1:${port}/#native=[a-f0-9-]{36}$`));
  const ticket = stdout.trim().split('=')[1];
  assert.equal(
    ((await f.service.action({ action: 'resolve', ticket })) as any).path,
    '/workspace/中文/hello & 中文.txt',
  );
});
