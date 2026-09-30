import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rmdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { NativeClipboard, nativeClipboardRequest } from '../server/native-clipboard.ts';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { NativeClipboardProcess } from '../shared/native-clipboard.ts';

const a: NativeClipboardProcess = {
  pid: 1234,
  created: '134000000000000001',
  image: 'D:\\Programs\\编辑器 & $().exe',
  bits: 64,
};
const b: NativeClipboardProcess = { ...a, pid: 2345, image: 'D:\\Other\\编辑器 & $().exe' };
const hash = 'a'.repeat(64);
const defaults = defaultClipboardRule();
const id = (item: { pid: number; created: string }) => `${item.pid}:${item.created}`;
async function fixture(t: any, extra: Record<string, unknown> = {}, dual = false) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-native-clipboard-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assets = join(directory, 'assets');
  await mkdir(assets);
  const files = [];
  for (const name of [
    'SakuraClipboardPolicy.dll',
    'sakura-clipboard-controller.exe',
    'MinHook-LICENSE.txt',
    ...(dual ? ['SakuraClipboardPolicy-x86.dll', 'sakura-clipboard-controller-x86.exe'] : []),
  ]) {
    const contents = Buffer.from(name);
    await writeFile(join(assets, name), contents);
    files.push({ name, size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
  }
  await writeFile(
    join(assets, 'native-clipboard.json'),
    JSON.stringify({ version: dual ? 2 : 1, architecture: 'x64', build: 'b'.repeat(64), files }),
  );
  const file = join(directory, 'native.json');
  let inventory = [a, b],
    currentHash = hash,
    fail = false,
    locked = false,
    maintenance = false,
    mutations = 0;
  const calls: string[][] = [],
    helpers: { file: string; args: string[] }[] = [],
    policies = new Map<string, any>();
  const options = {
    file,
    assets,
    interval: 0,
    supported: true,
    hashImage: async () => currentHash,
    guard: () => {
      if (locked) throw new Error('locked');
    },
    maintenance: () => maintenance,
    mutation: (delta: number) => {
      mutations += delta;
      assert.ok(mutations >= 0);
    },
    run: async (_file: string, args: string[]) => {
      helpers.push({ file: _file, args });
      calls.push(args);
      if (args[0] === 'list') return { processes: inventory };
      const key = args[2] + ':' + args[3];
      if (args[0] === 'status') return policies.get(key) || { present: false };
      assert.equal(args[0], 'apply');
      assert.ok(
        (JSON.parse(await readFile(file, 'utf8')).managed as any[]).some((item) => id(item) === key),
        'journal precedes native attachment',
      );
      if (fail) throw new Error('attachment failed');
      const state = {
        present: true,
        ready: true,
        compatible: true,
        active: args[8] === '1',
        flags: Number(args[6]),
        maximum: Number(args[7]),
        blockedCopy: 2,
        blockedPaste: 3,
      };
      policies.set(key, state);
      return state;
    },
    ...extra,
  };
  const service = new NativeClipboard(options);
  t.after(() => service.close());
  await service.init();
  const configure = (
    enabled = true,
    applications = [{ image: a.image, sha256: hash, rule: { ...defaults, copy: false } }],
  ) =>
    service.action({
      action: 'configure',
      version: service.view().version,
      settings: { enabled, applications },
    });
  return {
    service,
    options,
    file,
    assets,
    calls,
    helpers,
    policies,
    configure,
    setInventory: (value: NativeClipboardProcess[]) => {
      inventory = value;
    },
    changeHash: () => {
      currentHash = 'c'.repeat(64);
    },
    fail: (value: boolean) => {
      fail = value;
    },
    lock: (value: boolean) => {
      locked = value;
    },
    maintain: (value: boolean) => {
      maintenance = value;
    },
    mutations: () => mutations,
  };
}

test('native rules require exact local executable paths, unique images, bounded policies and strict requests', () => {
  const request = (image: string) => ({
    action: 'configure',
    version: 1,
    settings: { enabled: true, applications: [{ image, sha256: hash, rule: defaults }] },
  });
  assert.equal(nativeClipboardRequest.safeParse(request(a.image)).success, true);
  for (const path of [
    'editor.exe',
    '\\\\server\\share\\editor.exe',
    'D:\\a.exe:stream',
    'D:\\..\\a.exe',
    'D:\\a. \\b.exe',
  ])
    assert.equal(nativeClipboardRequest.safeParse(request(path)).success, false, path);
  const repeated = request(a.image);
  repeated.settings.applications.push({ ...repeated.settings.applications[0], image: a.image.toUpperCase() });
  assert.equal(nativeClipboardRequest.safeParse(repeated).success, false);
  assert.equal(nativeClipboardRequest.safeParse({ action: 'refresh', enabled: true }).success, false);
  assert.equal(
    nativeClipboardRequest.safeParse({ action: 'identify', pid: 1234, created: '1e5' }).success,
    false,
  );
});

test('default-off startup does not persist or attach and selection checks process identity and executable hash', async (t) => {
  const f = await fixture(t, { pid: b.pid });
  assert.equal(f.service.view().ready, true);
  assert.deepEqual(f.service.view().available, [a]);
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  f.setInventory([a, b, { ...a, pid: 3456, image: 'D:\\Programs\\application.com' }]);
  await f.service.action({ action: 'refresh' });
  assert.deepEqual(f.service.view().available, [a]);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  assert.deepEqual(await f.service.action({ action: 'identify', pid: a.pid, created: a.created }), {
    image: a.image,
    sha256: hash,
  });
  await assert.rejects(f.service.action({ action: 'identify', pid: a.pid, created: '123' }), /身份已变化/);
  await f.service.close();
  await assert.rejects(f.service.action({ action: 'refresh' }), /正在关闭/);
});

test('saved rules attach only matching paths, journal before native calls, watch new processes and refuse unknown architectures', async (t) => {
  const f = await fixture(t);
  await f.configure();
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 1);
  assert.equal(f.service.view().processes[0].state, 'enforced');
  assert.equal(f.service.view().processes[0].blockedPaste, 3);
  f.setInventory([a, b, { ...a, pid: 3456, created: '134000000000000002' }, { ...a, pid: 4567, bits: 0 }]);
  await f.service.action({ action: 'refresh' });
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 2);
  assert.equal(f.service.view().processes.find((item) => item.pid === 4567)?.state, 'error');
  assert.ok(!f.service.view().processes.some((item) => item.pid === b.pid));
  assert.equal(f.mutations(), 0);
});

test('dual architecture assets route x86 attachment and retain shared ownership across restart and disable', async (t) => {
  const f = await fixture(t, {}, true);
  const x86: NativeClipboardProcess = { ...a, pid: 4568, image: 'D:\\Apps\\LegacyEditor.exe', bits: 32 };
  f.setInventory([a, b, x86]);
  const selected = await f.service.action({ action: 'identify', pid: x86.pid, created: x86.created });
  assert.deepEqual(selected, { image: x86.image, sha256: hash });
  await f.configure(
    true,
    [a, x86].map((item) => ({ image: item.image, sha256: hash, rule: { ...defaults, copy: false } })),
  );
  assert.equal(f.service.view().processes.filter((item) => item.state === 'enforced').length, 2);
  const attached = f.helpers.find((item) => item.args[0] === 'apply' && item.args[2] === String(x86.pid))!;
  assert.ok(attached.file.endsWith('sakura-clipboard-controller-x86.exe'));
  assert.ok(attached.args[5].endsWith('SakuraClipboardPolicy-x86.dll'));
  assert.equal(
    JSON.parse(await readFile(f.file, 'utf8')).managed.find(
      (item: NativeClipboardProcess) => item.pid === x86.pid,
    ).bits,
    32,
  );
  await f.service.close();
  const resumed = new NativeClipboard(f.options);
  t.after(() => resumed.close());
  await resumed.init();
  assert.equal(resumed.view().processes.filter((item) => item.state === 'enforced').length, 2);
  assert.equal(
    f.calls.filter((args) => args[0] === 'apply').length,
    2,
    'ready x86 and x64 mappings do not reattach',
  );
  await resumed.action({
    action: 'configure',
    version: resumed.view().version,
    settings: { ...resumed.view().settings, enabled: false },
  });
  assert.equal(f.policies.get(id(x86)).active, false);
  assert.ok(
    f.helpers
      .filter((item) => item.args[0] === 'apply' && item.args[8] === '0')
      .every((item) => item.file.endsWith('sakura-clipboard-controller.exe')),
  );
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

test('legacy x64 assets refuse x86 identities instead of invoking an unverified controller', async (t) => {
  const f = await fixture(t);
  const x86: NativeClipboardProcess = { ...a, bits: 32 };
  f.setInventory([x86]);
  await assert.rejects(
    f.service.action({ action: 'identify', pid: x86.pid, created: x86.created }),
    /架构不受支持/,
  );
  await f.configure();
  assert.equal(f.service.view().processes[0].state, 'error');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  assert.ok(!f.helpers.some((item) => item.file.endsWith('sakura-clipboard-controller-x86.exe')));
});

test('x86 binary corruption blocks new attachments while a verified x64 controller still disables owned x86 mappings', async (t) => {
  const f = await fixture(t, {}, true);
  const x86: NativeClipboardProcess = { ...a, bits: 32 };
  f.setInventory([x86]);
  await f.configure();
  await writeFile(join(f.assets, 'sakura-clipboard-controller-x86.exe'), 'tampered');
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().ready, false);
  assert.match(f.service.view().processes[0].error!, /完整性失败/);
  assert.equal(f.policies.get(id(x86)).active, true);
  await f.configure(false);
  assert.equal(f.policies.get(id(x86)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

test('restart retains ownership, cached readiness avoids duplicate attach, and explicit stop clears old maps even after image changes', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.close();
  assert.equal(f.policies.get(id(a)).active, true, 'shutdown preserves the rule');
  const resumed = new NativeClipboard(f.options);
  t.after(() => resumed.close());
  await resumed.init();
  assert.equal(resumed.view().processes[0].state, 'enforced');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 1);
  f.changeHash();
  await resumed.action({ action: 'refresh' });
  assert.match(resumed.view().processes[0].error!, /文件已变化/);
  assert.equal(f.policies.get(id(a)).active, true);
  f.policies.get(id(a)).compatible = false;
  await resumed.action({
    action: 'configure',
    version: resumed.view().version,
    settings: { ...resumed.view().settings, enabled: false },
  });
  assert.equal(f.policies.get(id(a)).active, false);
  assert.equal(resumed.view().processes[0].state, 'disabled');
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

test('failed and invisible native processes remain journaled until a verified disable or mapping disappearance', async (t) => {
  const f = await fixture(t);
  f.fail(true);
  await f.configure();
  assert.match(f.service.view().processes[0].error!, /attachment failed/);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
  f.fail(false);
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().processes[0].state, 'enforced');
  f.setInventory([b]);
  await f.service.action({ action: 'refresh' });
  assert.match(f.service.view().processes[0].error!, /无法核对身份/);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
  f.policies.delete(id(a));
  await f.service.action({ action: 'refresh' });
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

test('PID reuse never inherits an old policy and stale/locked/maintenance writes cannot change saved settings', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.policies.delete(id(a));
  const replacement = { ...a, created: '134000000000000099' };
  f.setInventory([replacement]);
  await f.service.action({ action: 'refresh' });
  assert.ok(f.policies.get(id(replacement)).active);
  assert.deepEqual(
    JSON.parse(await readFile(f.file, 'utf8')).managed.map((item: any) => item.created),
    [replacement.created],
  );
  await assert.rejects(
    f.service.action({ action: 'configure', version: 1, settings: { enabled: false, applications: [] } }),
    /已改变/,
  );
  f.lock(true);
  await assert.rejects(f.configure(false), /locked/);
  f.lock(false);
  f.maintain(true);
  await assert.rejects(f.configure(false), /维护中/);
  f.maintain(false);
  assert.equal(f.service.view().settings.enabled, true);
  assert.equal(f.mutations(), 0);
});

test('DLL integrity failure refuses attachment but verified controller still permits disabling owned processes', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await writeFile(join(f.assets, 'SakuraClipboardPolicy.dll'), 'tampered');
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().ready, false);
  assert.match(f.service.view().processes[0].error!, /完整性失败/);
  assert.equal(f.policies.get(id(a)).active, true);
  await f.configure(false);
  assert.equal(f.policies.get(id(a)).active, false);
  const before = f.calls.length;
  await writeFile(join(f.assets, 'sakura-clipboard-controller.exe'), 'tampered');
  await f.service.action({ action: 'refresh' });
  assert.equal(f.calls.length, before);
});

test('invalid native lists and incompatible agents are reported without granting enforcement', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.policies.get(id(a)).compatible = false;
  await f.service.action({ action: 'refresh' });
  assert.match(f.service.view().processes[0].error!, /重新启动/);
  const broken = new NativeClipboard({
    ...f.options,
    run: async () => ({ processes: [{ ...a, bits: 128 }] }),
  });
  t.after(() => broken.close());
  await broken.init();
  assert.equal(broken.view().ready, false);
  assert.equal(broken.view().processes[0].state, 'error');
});

test('journal write failure cannot attach or leave an unpersisted in-memory ownership shortcut', async (t) => {
  const f = await fixture(t);
  let interrupted = false;
  const service = new NativeClipboard({
    ...f.options,
    run: async (file, args) => {
      const value = await f.options.run(file, args);
      if (args[0] === 'status' && !interrupted) {
        interrupted = true;
        await rename(f.file, f.file + '.saved');
        await mkdir(f.file);
      }
      return value;
    },
  });
  t.after(() => service.close());
  await service.init();
  await service.action({
    action: 'configure',
    version: 1,
    settings: { enabled: true, applications: [{ image: a.image, sha256: hash, rule: defaults }] },
  });
  assert.equal(service.view().processes[0].state, 'error');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  assert.equal(JSON.parse(await readFile(f.file + '.saved', 'utf8')).managed.length, 0);
  await rmdir(f.file);
  await rename(f.file + '.saved', f.file);
  await service.action({ action: 'refresh' });
  assert.equal(service.view().processes[0].state, 'enforced');
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
});
