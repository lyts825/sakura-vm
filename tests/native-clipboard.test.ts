import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rmdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  NativeClipboard,
  nativeClipboardRequest,
  clipboardExecutableBits,
  type NativeClipboardLaunch,
} from '../server/native-clipboard.ts';
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
async function fixture(t: any, extra: Record<string, unknown> = {}, dual = false, early = false) {
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
    ...(early ? ['Detours-LICENSE.md'] : []),
  ]) {
    const contents = Buffer.from(name);
    await writeFile(join(assets, name), contents);
    files.push({ name, size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
  }
  await writeFile(
    join(assets, 'native-clipboard.json'),
    JSON.stringify({ version: early ? 3 : dual ? 2 : 1, architecture: 'x64', build: 'b'.repeat(64), files }),
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
    imageBits: async (): Promise<32 | 64> => 64,
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

async function launchFixture(t: any, bits: 32 | 64 = 64, dual = true) {
  let f: Awaited<ReturnType<typeof fixture>>;
  const created: NativeClipboardProcess = { ...a, pid: 9876, created: '134000000000000123', bits };
  const calls: { file: string; args: string[] }[] = [];
  const controls: {
    beforePrepared?: () => Promise<void>;
    afterPrepared?: () => Promise<void>;
    beforeAttached?: () => Promise<void>;
    waitForClose?: boolean;
    reported?: NativeClipboardProcess;
    state?: Record<string, unknown>;
  } = {};
  let attached = false,
    resumed = false,
    killed = false;
  const launch: NativeClipboardLaunch = async (file, args, hooks, signal) => {
    calls.push({ file, args });
    const failIfClosed = () => {
      if (signal.aborted) throw new Error('launch aborted');
    };
    try {
      await controls.beforePrepared?.();
      await hooks.prepared(controls.reported || created);
      assert.ok(
        JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => id(item) === id(created)),
        'new process ownership is persisted before native DLL attachment',
      );
      await controls.afterPrepared?.();
      failIfClosed();
      attached = true;
      const state = {
        present: true as const,
        ready: true,
        active: true,
        compatible: true,
        flags: Number(args[5]),
        maximum: Number(args[6]),
        blockedCopy: 0,
        blockedPaste: 0,
        ...controls.state,
      };
      f.policies.set(id(created), state);
      await controls.beforeAttached?.();
      if (controls.waitForClose)
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('launch aborted')), { once: true });
          if (signal.aborted) reject(new Error('launch aborted'));
        });
      await hooks.attached(created, state as any);
      failIfClosed();
      resumed = true;
      return created;
    } catch (error) {
      killed = true;
      f.policies.delete(id(created));
      throw error;
    }
  };
  f = await fixture(t, { launch, imageBits: async () => bits }, dual, dual);
  f.setInventory([]);
  await f.configure();
  return {
    ...f,
    created,
    controls,
    launches: calls,
    launch: (args: string[] = []) =>
      f.service.action({
        action: 'launch',
        version: f.service.view().version,
        image: a.image,
        sha256: hash,
        args,
      }),
    result: () => ({ attached, resumed, killed }),
  };
}

test('controlled launch requests accept literal argv but reject shell options, nulls and excessive argument sizes', () => {
  const request = {
    action: 'launch',
    version: 1,
    image: a.image,
    sha256: hash,
    args: ['', '空 格', '"', '\\', '& $() %PATH%'],
  };
  assert.equal(nativeClipboardRequest.safeParse(request).success, true);
  for (const args of [['x\0y'], ['x'.repeat(2049)], Array(65).fill(''), Array(5).fill('x'.repeat(2048)), [7]])
    assert.equal(nativeClipboardRequest.safeParse({ ...request, args }).success, false);
  assert.equal(nativeClipboardRequest.safeParse({ ...request, shell: true }).success, false);
  assert.equal(nativeClipboardRequest.safeParse({ ...request, version: 0 }).success, false);
});

test('controlled x86 launch persists ownership before attach, checks ready policy before resume and survives scan/restart/disable', async (t) => {
  const f = await launchFixture(t, 32);
  const args = ['', 'sp ace', 'with"quote', 'trailing\\', '\\"', '中文🪷', '& $() %PATH% ; >'];
  const value = (await f.launch(args)) as { process: NativeClipboardProcess; view: any };
  assert.deepEqual(value.process, f.created);
  assert.equal(value.view.processes[0].state, 'enforced');
  assert.deepEqual(f.result(), { attached: true, resumed: true, killed: false });
  assert.ok(f.launches[0].file.endsWith('sakura-clipboard-controller-x86.exe'));
  assert.ok(f.launches[0].args[4].endsWith('SakuraClipboardPolicy-x86.dll'));
  assert.deepEqual(f.launches[0].args.slice(8), args);
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  f.setInventory([f.created, b]);
  await f.service.action({ action: 'refresh' });
  assert.equal(
    f.calls.filter((args) => args[0] === 'apply').length,
    0,
    'scan reuses the already-ready policy',
  );
  await f.service.close();
  assert.equal(f.policies.get(id(f.created)).active, true);
  const resumed = new NativeClipboard(f.options);
  t.after(() => resumed.close());
  await resumed.init();
  assert.equal(resumed.view().processes[0].state, 'enforced');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  await resumed.action({
    action: 'configure',
    version: resumed.view().version,
    settings: { ...resumed.view().settings, enabled: false },
  });
  assert.equal(f.policies.get(id(f.created)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

test('controlled launch requires current saved enablement, exact binding, intact assets and architecture before creating a process', async (t) => {
  const f = await launchFixture(t);
  const valid = {
    action: 'launch',
    version: f.service.view().version,
    image: a.image,
    sha256: hash,
    args: [],
  };
  await assert.rejects(f.service.action({ ...valid, version: 1 }), /已改变/);
  await assert.rejects(f.service.action({ ...valid, image: b.image }), /已保存并启用/);
  await assert.rejects(f.service.action({ ...valid, sha256: 'f'.repeat(64) }), /已保存并启用/);
  f.lock(true);
  await assert.rejects(f.launch(), /locked/);
  f.lock(false);
  f.maintain(true);
  await assert.rejects(f.launch(), /维护中/);
  f.maintain(false);
  f.changeHash();
  await assert.rejects(f.launch(), /摘要已变化/);
  assert.equal(f.launches.length, 0);
  await f.configure(false);
  await assert.rejects(f.launch(), /已保存并启用/);
  const legacy = await launchFixture(t, 32, false);
  await assert.rejects(legacy.launch(), /未包含 32 位/);
  assert.equal(legacy.launches.length, 0);
  const corrupt = await launchFixture(t);
  await writeFile(join(corrupt.assets, 'SakuraClipboardPolicy.dll'), 'tampered');
  await assert.rejects(corrupt.launch(), /完整性失败/);
  assert.equal(corrupt.launches.length, 0);
  assert.equal(f.mutations(), 0);
});

test('controlled launch journal write failure cleans up only its pending child and never attaches or resumes', async (t) => {
  const f = await launchFixture(t);
  f.controls.beforePrepared = async () => {
    await rename(f.file, f.file + '.saved');
    await mkdir(f.file);
  };
  await assert.rejects(f.launch());
  assert.deepEqual(f.result(), { attached: false, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(f.file + '.saved', 'utf8')).managed.length, 0);
  assert.equal(f.service.view().processes.length, 0);
  assert.equal(f.mutations(), 0);
  await rmdir(f.file);
  await rename(f.file + '.saved', f.file);
});

test('controlled launch requires v3 early assets and the verified Detours license without disabling legacy owned policies', async (t) => {
  const f = await launchFixture(t);
  const existing = {
    present: true,
    ready: true,
    active: true,
    compatible: true,
    flags: 6,
    maximum: 1048576,
    blockedCopy: 2,
    blockedPaste: 3,
  };
  f.policies.set(id(b), existing);
  const path = join(f.assets, 'native-clipboard.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify({
      ...manifest,
      version: 2,
      files: manifest.files.filter((item: any) => item.name !== 'Detours-LICENSE.md'),
    }),
  );
  await assert.rejects(f.launch(), /DLL\/TLS 初始化前/);
  assert.equal(f.launches.length, 0);
  await writeFile(path, JSON.stringify(manifest));
  await writeFile(join(f.assets, 'Detours-LICENSE.md'), 'corrupted license');
  await assert.rejects(f.launch(), /完整性失败/);
  assert.equal(f.launches.length, 0);
  assert.equal(f.mutations(), 0);
  assert.equal(f.policies.get(id(b)), existing);
  assert.equal(existing.active, true);
});

test('controlled launch refuses mismatched process identities and policies without resuming, retaining failed ownership for later reconciliation', async (t) => {
  const wrong = await launchFixture(t);
  wrong.controls.reported = { ...wrong.created, image: b.image };
  await assert.rejects(wrong.launch(), /进程身份/);
  assert.deepEqual(wrong.result(), { attached: false, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(wrong.file, 'utf8')).managed.length, 0);
  const stale = await launchFixture(t);
  stale.controls.state = { ready: false };
  await assert.rejects(stale.launch(), /未加载完成/);
  assert.deepEqual(stale.result(), { attached: true, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(stale.file, 'utf8')).managed.length, 1);
  await stale.service.action({ action: 'refresh' });
  assert.equal(JSON.parse(await readFile(stale.file, 'utf8')).managed.length, 0);
  assert.equal(stale.mutations(), 0);
});

test('lock, migration maintenance, executable changes and independent mapping failure are rechecked before controlled resume', async (t) => {
  for (const [modify, pattern] of [
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.lock(true), /locked/],
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.maintain(true), /维护中/],
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.changeHash(), /摘要已变化/],
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.policies.delete(id(f.created)), /策略复核失败/],
  ] as const) {
    const f = await launchFixture(t);
    f.controls.beforeAttached = async () => {
      modify(f);
    };
    await assert.rejects(f.launch(), pattern);
    assert.deepEqual(f.result(), { attached: true, resumed: false, killed: true });
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
    assert.equal(f.mutations(), 0);
  }
});

test('service close cancels an in-progress controlled launch and preserves persisted ownership without relaxing other processes', async (t) => {
  const f = await launchFixture(t);
  const otherPolicy = {
    present: true,
    ready: true,
    active: true,
    compatible: true,
    flags: 6,
    maximum: 1048576,
    blockedCopy: 2,
    blockedPaste: 3,
  };
  f.policies.set(id(b), otherPolicy);
  f.controls.waitForClose = true;
  let prepared!: () => void;
  const started = new Promise<void>((resolve) => {
    prepared = resolve;
  });
  f.controls.beforeAttached = async () => {
    prepared();
  };
  const pending = f.launch();
  const rejection = assert.rejects(pending, /aborted/);
  await started;
  await f.service.close();
  await rejection;
  assert.deepEqual(f.result(), { attached: true, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
  assert.equal(f.policies.get(id(b)), otherPolicy);
  assert.equal(otherPolicy.active, true);
  assert.equal(f.mutations(), 0);
});

test('controlled launch architecture preflight checks PE signature, executable flags and matching optional header', async (t) => {
  const f = await fixture(t);
  for (const bits of [32, 64] as const) {
    const header = Buffer.alloc(512);
    header.writeUInt16LE(0x5a4d, 0);
    header.writeUInt32LE(64, 60);
    header.writeUInt32LE(0x4550, 64);
    header.writeUInt16LE(bits === 32 ? 0x14c : 0x8664, 68);
    header.writeUInt16LE(2, 86);
    header.writeUInt16LE(bits === 32 ? 224 : 240, 84);
    header.writeUInt16LE(bits === 32 ? 0x10b : 0x20b, 88);
    header.writeUInt16LE(3, 88 + 68);
    header.writeUInt32LE(16, 88 + (bits === 32 ? 92 : 108));
    const path = join(f.assets, `test-${bits}.exe`);
    await writeFile(path, header);
    assert.equal(await clipboardExecutableBits(path), bits);
    header.writeUInt16LE(0x2002, 86);
    await writeFile(path, header);
    await assert.rejects(clipboardExecutableBits(path), /不是 Windows EXE/);
    header.writeUInt16LE(2, 86);
    header.writeUInt16LE(0xaa64, 68);
    await writeFile(path, header);
    await assert.rejects(clipboardExecutableBits(path), /仅支持 x64 或 x86/);
  }
});

test('CLR preflight selects the actual startup width for fixed and AnyCPU executables', async (t) => {
  const f = await fixture(t);
  function clr(width: 32 | 64, flags: number) {
    const bytes = Buffer.alloc(1024), optional = 88, optionalSize = width === 32 ? 224 : 240;
    bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x4550, 64);
    bytes.writeUInt16LE(width === 32 ? 0x14c : 0x8664, 68); bytes.writeUInt16LE(1, 70);
    bytes.writeUInt16LE(optionalSize, 84); bytes.writeUInt16LE(2, 86);
    bytes.writeUInt16LE(width === 32 ? 0x10b : 0x20b, optional);
    bytes.writeUInt16LE(3, optional + 68); bytes.writeUInt32LE(0x4000, optional + 56);
    const directories = width === 32 ? 96 : 112;
    bytes.writeUInt32LE(16, optional + directories - 4);
    bytes.writeUInt32LE(0x2000, optional + directories + 112);
    bytes.writeUInt32LE(72, optional + directories + 116);
    const section = optional + optionalSize;
    bytes.writeUInt32LE(0x2000, section + 12); bytes.writeUInt32LE(512, section + 16);
    bytes.writeUInt32LE(512, section + 20);
    bytes.writeUInt32LE(72, 512); bytes.writeUInt32LE(0x2100, 520); bytes.writeUInt32LE(32, 524);
    bytes.writeUInt32LE(flags, 528); bytes.writeUInt32LE(0x06000001, 532);
    return bytes;
  }
  const path = join(f.assets, 'clr.exe');
  for (const [width, flags, expected] of [[64, 1, 64], [32, 3, 32], [32, 0x20003, 32],
    [32, 1, process.arch === 'x64' ? 64 : 32], [32, 9, process.arch === 'x64' ? 64 : 32]] as const) {
    await writeFile(path, clr(width, flags)); assert.equal(await clipboardExecutableBits(path), expected);
  }
  for (const [name, mutate] of [
    ['mixed mode', (b: Buffer) => b.writeUInt32LE(0, 528)],
    ['native entry', (b: Buffer) => b.writeUInt32LE(0x11, 528)],
    ['ReadyToRun', (b: Buffer) => b.writeUInt32LE(0x2200, 576)],
    ['unknown flags', (b: Buffer) => b.writeUInt32LE(0x40000001, 528)],
    ['missing entry', (b: Buffer) => b.writeUInt32LE(0, 532)],
    ['missing metadata', (b: Buffer) => b.writeUInt32LE(0, 520)],
    ['bad CLR size', (b: Buffer) => b.writeUInt32LE(71, 512)],
    ['ambiguous RVA', (b: Buffer) => { b.writeUInt16LE(2, 70); b.copy(b, 352, 312, 352); }],
    ['outside file', (b: Buffer) => b.writeUInt32LE(1024, 332)],
    ['bad directory', (b: Buffer) => b.writeUInt32LE(0, 296)],
  ] as const) {
    const bytes = clr(32, 1); mutate(bytes); await writeFile(path, bytes);
    await assert.rejects(clipboardExecutableBits(path), /CLR|启动头/, name);
  }
  await writeFile(path, clr(64, 3)); await assert.rejects(clipboardExecutableBits(path), /位数标记/);
});
