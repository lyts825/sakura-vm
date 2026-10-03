import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NativeClipboard, type NativeClipboardLaunch } from '../server/native-clipboard.ts';
import type { NativeClipboardProcess } from '../shared/native-clipboard.ts';
import type {
  NativeClipboardDescendantFactory,
  NativeClipboardDescendantRequest,
} from '../server/native-clipboard-descendants.ts';

const parent: NativeClipboardProcess = {
  pid: 1001,
  created: '134000000000000001',
  image: 'D:\\Apps\\Parent.exe',
  bits: 64,
};
const child: NativeClipboardProcess = {
  pid: 1002,
  created: '134000000000000002',
  image: 'D:\\Other\\Child.exe',
  bits: 32,
};
const grandchild: NativeClipboardProcess = {
  pid: 1003,
  created: '134000000000000003',
  image: 'D:\\More\\Grandchild.exe',
  bits: 64,
};
const rootHash = 'a'.repeat(64),
  childHash = 'c'.repeat(64),
  rule = { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 8192 };
const key = (value: NativeClipboardProcess) => `${value.pid}:${value.created}`;
const ready = {
  present: true as const,
  ready: true,
  active: true,
  compatible: true,
  flags: 8,
  maximum: 8192,
  blockedCopy: 0,
  blockedPaste: 0,
};
const request = (process = child, ancestor = parent): NativeClipboardDescendantRequest => ({
  stage: 'request',
  id: randomUUID(),
  parent: ancestor as any,
  process: process as any,
  sha256: childHash,
  suspended: false,
  handles: { process: '101', thread: '102', job: '103', file: '104' },
});
async function fixture(t: any, launch?: NativeClipboardLaunch) {
  const base = resolve(
    process.env.SAKURA_NATIVE_CLIPBOARD_TEST_BASE || '.data/native-clipboard-test-temp',
    'descendant-units',
  );
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'unit-'));
  const assets = join(directory, 'assets');
  await mkdir(assets);
  const files = [];
  for (const name of [
    'SakuraClipboardPolicy.dll',
    'sakura-clipboard-controller.exe',
    'SakuraClipboardPolicy-x86.dll',
    'sakura-clipboard-controller-x86.exe',
    'MinHook-LICENSE.txt',
    'Detours-LICENSE.md',
  ]) {
    const data = Buffer.from(name);
    await writeFile(join(assets, name), data);
    files.push({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  await writeFile(
    join(assets, 'native-clipboard.json'),
    JSON.stringify({ version: 7, architecture: 'x64', build: 'b'.repeat(64), files }),
  );
  const file = join(directory, 'native.json');
  let inventory: NativeClipboardProcess[] = [parent],
    receive: Parameters<NativeClipboardDescendantFactory>[2],
    maintenance = false,
    intercept: ((args: string[]) => Promise<unknown>) | undefined;
  const policies = new Map<string, any>(),
    commands: { file: string; args: string[] }[] = [],
    calls: string[][] = [];
  const descendants: NativeClipboardDescendantFactory = async (_file, _owner, handler) => {
    receive = handler;
    let alive = true;
    return {
      get alive() {
        return alive;
      },
      close: async () => {
        alive = false;
      },
    };
  };
  const options = {
    file,
    assets,
    supported: true,
    interval: 0,
    descendants,
    maintenance: () => maintenance,
    hashImage: async (image: string) => (image === parent.image ? rootHash : childHash),
    imageBits: async (image: string): Promise<32 | 64> => (image === child.image ? 32 : 64),
    run: async (_file: string, args: string[]) => {
      calls.push([...args]);
      if (intercept) {
        const result = await intercept(args);
        if (result !== undefined) return result;
      }
      if (args[0] === 'list') return { processes: inventory };
      const id = args[2] + ':' + args[3];
      if (args[0] === 'status') return policies.get(id) || { present: false };
      assert.equal(args[0], 'apply');
      const status = { ...ready, active: args[8] === '1', flags: Number(args[6]), maximum: Number(args[7]) };
      policies.set(id, status);
      return status;
    },
    launch: (async (file, args, hooks, signal) => {
      commands.push({ file, args });
      if (launch) return launch(file, args, hooks, signal);
      const actual = args[0] === 'adopt' ? (args[2] === child.image ? child : grandchild) : parent;
      await hooks.prepared(actual);
      const journal = JSON.parse(await readFile(options.file, 'utf8'));
      assert.ok(
        journal.managed.some((item: NativeClipboardProcess) => key(item) === key(actual)),
        'durable ownership precedes early attachment',
      );
      policies.set(key(actual), { ...ready });
      await hooks.attached(actual, { ...ready });
      return actual;
    }) as NativeClipboardLaunch,
  };
  const service = new NativeClipboard(options);
  t.after(() => service.close());
  await service.init();
  const configure = (enabled = true, applications = [{ image: parent.image, sha256: rootHash, rule }]) =>
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
    policies,
    commands,
    calls,
    configure,
    receive: (value = request()) => receive(value, { pid: 2000, created: '134000000000000009' }),
    inventory: (items: NativeClipboardProcess[]) => {
      inventory = items;
    },
    maintenance: (value: boolean) => {
      maintenance = value;
    },
    intercept: (handler?: typeof intercept) => {
      intercept = handler;
    },
  };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('CreateProcess descendant inherits cross-EXE rules and exact ancestry before matching x86 helper attachment', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.receive();
  const command = f.commands[0];
  assert.ok(command.file.endsWith('-x86.exe'));
  assert.equal(command.args[0], 'adopt');
  assert.equal(command.args[2], child.image);
  assert.equal(command.args[3], childHash);
  assert.equal(command.args[5], '8');
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  const inherited = journal.managed.find((item: any) => item.pid === child.pid);
  assert.equal(inherited.sha256, childHash);
  assert.deepEqual(inherited.inheritance, {
    application: { image: parent.image, sha256: rootHash },
    parent: { pid: parent.pid, created: parent.created },
  });
  f.inventory([parent, child]);
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
  assert.equal(f.policies.get(key(child)).active, true);
  await f.service.close();
  const restored = new NativeClipboard(f.options);
  t.after(() => restored.close());
  await restored.init();
  assert.equal(
    restored.view().processes.find((item) => item.pid === child.pid)?.inheritance?.parent.created,
    parent.created,
  );
  await restored.action({
    action: 'configure',
    version: restored.view().version,
    settings: { enabled: false, applications: [] },
  });
  assert.equal(f.policies.get(key(child)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

test('concurrent child journals and nested initializer descendants do not deadlock an ancestor controlled launch', async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, async (_file, args, hooks) => {
    const actual = args[0] === 'launch' ? parent : args[2] === child.image ? child : grandchild;
    await hooks.prepared(actual);
    f.policies.set(key(actual), { ...ready });
    if (actual === parent) await f.receive(request(child, parent));
    if (actual === child) await f.receive(request(grandchild, child));
    await hooks.attached(actual, { ...ready });
    return actual;
  });
  f.inventory([]);
  await f.configure();
  await f.service.action({
    action: 'launch',
    version: f.service.view().version,
    image: parent.image,
    sha256: rootHash,
    args: [],
  });
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.deepEqual(journal.managed.map((item: any) => item.pid).sort(), [1001, 1002, 1003]);
  const leaf = journal.managed.find((item: any) => item.pid === grandchild.pid);
  assert.deepEqual(leaf.inheritance.application, { image: parent.image, sha256: rootHash });
  assert.equal(leaf.inheritance.parent.pid, child.pid);
});

test('simultaneous child requests preserve both journals and caller CREATE_SUSPENDED argument', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const suspended = { ...request(), suspended: true };
  await Promise.all([f.receive(suspended), f.receive(request(grandchild))]);
  assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[14], '1');
  assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[15], String(parent.pid));
  assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[16], parent.created);
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(journal.managed.length, 3);
  assert.equal(new Set(journal.managed.map((item: any) => `${item.pid}:${item.created}`)).size, 3);
});

test('missing or reused parent identities, maintenance and disabled saved rules cannot authorize a child', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await assert.rejects(f.receive(request(child, { ...parent, created: '134000000000000010' })), /父进程归属/);
  await assert.rejects(f.receive(request(child, { ...parent, image: child.image })), /父进程归属/);
  f.maintenance(true);
  await assert.rejects(f.receive(), /迁移维护/);
  f.maintenance(false);
  await f.configure(false);
  await assert.rejects(f.receive(), /父进程归属/);
  assert.equal(f.commands.length, 0);
});

test('independent child policy mismatch fails before resume and retains precise failed ownership for recovery', async (t) => {
  const f = await fixture(t, async (_file, _args, hooks) => {
    await hooks.prepared(child);
    await hooks.attached(child, { ...ready });
    assert.fail('the child cannot resume without its actual ready mapping');
  });
  await f.configure();
  await assert.rejects(f.receive(), /真实共享策略复核失败/);
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(
    journal.managed.find((item: any) => item.pid === child.pid).inheritance.parent.created,
    parent.created,
  );
  assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'error');
});

test('service close aborts a journaled descendant before resume and waits for its adoption to settle', async (t) => {
  let entered!: () => void,
    settled = false,
    resumed = false;
  const prepared = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, async (_file, _args, hooks, signal) => {
    await hooks.prepared(child);
    entered();
    try {
      await new Promise<void>((_, reject) => {
        if (signal.aborted) reject(new Error('generation aborted'));
        else signal.addEventListener('abort', () => reject(new Error('generation aborted')), { once: true });
      });
      resumed = true;
      return child;
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 20));
      settled = true;
    }
  });
  await f.configure();
  const adopting = f.receive();
  void adopting.catch(() => {});
  await prepared;
  await f.service.close();
  await assert.rejects(adopting, /generation aborted/);
  assert.equal(settled, true);
  assert.equal(resumed, false);
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(
    journal.managed.find((item: any) => item.pid === child.pid).inheritance.parent.created,
    parent.created,
  );
});

test('saving a new rule retires all prepared descendant helpers before the durable rule generation changes', async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>,
    entered!: () => void,
    settled = false;
  const prepared = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f = await fixture(t, async (_file, _args, hooks, signal) => {
    await hooks.prepared(child);
    entered();
    await new Promise<void>((_, reject) =>
      signal.addEventListener(
        'abort',
        () => {
          void readFile(f.file, 'utf8').then((text) => {
            assert.equal(
              JSON.parse(text).settings.applications[0].rule.copy,
              false,
              'old rules remain saved until adoption is cancelled',
            );
            settled = true;
            reject(new Error('generation retired'));
          });
        },
        { once: true },
      ),
    );
    assert.fail('a retired helper cannot resume');
  });
  await f.configure();
  const adopting = f.receive();
  void adopting.catch(() => {});
  await prepared;
  await f.service.action({
    action: 'configure',
    version: f.service.view().version,
    settings: {
      enabled: true,
      applications: [{ image: parent.image, sha256: rootHash, rule: { ...rule, copy: true } }],
    },
  });
  await assert.rejects(adopting, /generation retired/);
  assert.equal(settled, true);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).settings.applications[0].rule.copy, true);
});

test(
  'a list snapshot predating prepared ownership cannot retire that exact in-flight child',
  { timeout: 10000 },
  async (t) => {
    const listEntered = deferred(),
      listRelease = deferred(),
      prepared = deferred(),
      attach = deferred();
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(child);
      prepared.resolve();
      await attach.promise;
      f.policies.set(key(child), { ...ready });
      await hooks.attached(child, { ...ready });
      return child;
    });
    await f.configure();
    f.intercept(async (args) => {
      if (args[0] !== 'list') return;
      listEntered.resolve();
      await listRelease.promise;
      return { processes: [parent] };
    });
    const scanning = f.service.action({ action: 'refresh' });
    await listEntered.promise;
    const adopting = f.receive();
    await prepared.promise;
    listRelease.resolve();
    await scanning;
    assert.ok(
      JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => key(item) === key(child)),
    );
    assert.equal(f.calls.filter((args) => args[0] === 'status' && args[2] === String(child.pid)).length, 0);
    f.intercept();
    attach.resolve();
    await adopting;
    assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
  },
);

for (const phase of ['prepared', 'attached'])
  test(
    `inventory containing a child at ${phase} cannot start ordinary apply before adoption closes`,
    { timeout: 10000 },
    async (t) => {
      const entered = deferred(),
        release = deferred();
      let f: Awaited<ReturnType<typeof fixture>>;
      f = await fixture(t, async (_file, _args, hooks) => {
        await hooks.prepared(child);
        if (phase === 'prepared') {
          entered.resolve();
          await release.promise;
        }
        f.policies.set(key(child), { ...ready });
        await hooks.attached(child, { ...ready });
        if (phase === 'attached') {
          entered.resolve();
          await release.promise;
        }
        return child;
      });
      await f.configure();
      const adopting = f.receive();
      await entered.promise;
      f.inventory([parent, child]);
      await f.service.action({ action: 'refresh' });
      assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0);
      assert.equal(
        JSON.parse(await readFile(f.file, 'utf8')).managed.find((item: any) => item.pid === child.pid)
          .inheritance.parent.created,
        parent.created,
      );
      release.resolve();
      await adopting;
      await f.service.action({ action: 'refresh' });
      assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
    },
  );

test(
  'native creation reservation skips even a selected same-EXE child before any broker request',
  { timeout: 10000 },
  async (t) => {
    const sameExe = { ...child, image: parent.image, bits: 64 as const };
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(sameExe);
      f.policies.set(key(sameExe), { ...ready });
      await hooks.attached(sameExe, { ...ready });
      return sameExe;
    });
    await f.configure();
    f.inventory([parent, sameExe]);
    f.intercept(async (args) =>
      args[0] === 'status' && args[2] === String(sameExe.pid)
        ? { present: false, reserved: true }
        : undefined,
    );
    await f.service.action({ action: 'refresh' });
    assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(sameExe.pid)).length, 0);
    assert.equal(
      JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => item.pid === sameExe.pid),
      false,
    );
    f.intercept();
    await f.receive({ ...request(sameExe), sha256: rootHash });
    assert.equal(
      JSON.parse(await readFile(f.file, 'utf8')).managed.find((item: any) => item.pid === sameExe.pid)
        .inheritance.parent.created,
      parent.created,
    );
  },
);

test(
  'broker adoption preempts a scan already awaiting this child status without waiting for the global queue',
  { timeout: 10000 },
  async (t) => {
    const statusEntered = deferred(),
      statusRelease = deferred(),
      prepared = deferred(),
      attach = deferred();
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(child);
      prepared.resolve();
      await attach.promise;
      f.policies.set(key(child), { ...ready });
      await hooks.attached(child, { ...ready });
      return child;
    });
    await f.configure(true, [
      { image: parent.image, sha256: rootHash, rule },
      { image: child.image, sha256: childHash, rule },
    ]);
    f.inventory([parent, child]);
    f.intercept(async (args) => {
      if (args[0] !== 'status' || args[2] !== String(child.pid)) return;
      statusEntered.resolve();
      await statusRelease.promise;
      return { present: false };
    });
    const scanning = f.service.action({ action: 'refresh' });
    await statusEntered.promise;
    const adopting = f.receive();
    await prepared.promise;
    statusRelease.resolve();
    await scanning;
    assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0);
    f.intercept();
    attach.resolve();
    await adopting;
  },
);

test(
  'already-issued ordinary apply must close before adoption and its journal cannot become inherited ownership',
  { timeout: 10000 },
  async (t) => {
    const applyEntered = deferred(),
      applyRelease = deferred();
    const f = await fixture(t);
    await f.configure(true, [
      { image: parent.image, sha256: rootHash, rule },
      { image: child.image, sha256: childHash, rule },
    ]);
    f.inventory([parent, child]);
    f.intercept(async (args) => {
      if (args[0] !== 'apply' || args[2] !== String(child.pid)) return;
      applyEntered.resolve();
      await applyRelease.promise;
      throw new Error('controlled child creation is pending; ordinary attachment refused');
    });
    const scanning = f.service.action({ action: 'refresh' });
    await applyEntered.promise;
    const adopting = f.receive();
    void adopting.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.commands.length, 0);
    applyRelease.resolve();
    await scanning;
    await assert.rejects(adopting, /独立持久归属/);
    assert.equal(f.commands.length, 0);
    const journal = JSON.parse(await readFile(f.file, 'utf8')).managed.find(
      (item: any) => item.pid === child.pid,
    );
    assert.equal(journal.sha256, childHash);
    assert.equal(journal.inheritance, undefined);
  },
);

test(
  'a duplicate adoption cannot release the first exact identity reservation during prepared scanning',
  { timeout: 10000 },
  async (t) => {
    const prepared = deferred(),
      release = deferred();
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(child);
      prepared.resolve();
      await release.promise;
      f.policies.set(key(child), { ...ready });
      await hooks.attached(child, { ...ready });
      return child;
    });
    await f.configure();
    const adopting = f.receive();
    await prepared.promise;
    await assert.rejects(f.receive(), /已有受控接入/);
    f.inventory([parent, child]);
    await f.service.action({ action: 'refresh' });
    assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0);
    assert.equal(f.commands.length, 1);
    release.resolve();
    await adopting;
  },
);

test(
  'a generation retired while waiting for the same child native operation cannot start adoption',
  { timeout: 10000 },
  async (t) => {
    const applyEntered = deferred(),
      applyRelease = deferred();
    const f = await fixture(t);
    await f.configure(true, [
      { image: parent.image, sha256: rootHash, rule },
      { image: child.image, sha256: childHash, rule },
    ]);
    f.inventory([parent, child]);
    f.intercept(async (args) => {
      if (args[0] !== 'apply' || args[2] !== String(child.pid)) return;
      applyEntered.resolve();
      await applyRelease.promise;
      throw new Error('reserved child remains suspended');
    });
    const scanning = f.service.action({ action: 'refresh' });
    await applyEntered.promise;
    const adopting = f.receive();
    void adopting.catch(() => {});
    const closing = f.service.close();
    applyRelease.resolve();
    await scanning;
    await closing;
    await assert.rejects(adopting, /代际已改变/);
    assert.equal(f.commands.length, 0);
  },
);

test('legacy v4 assets recover and disable owned policies but cannot authorize reservation-free descendants', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.close();
  const manifestPath = join(f.assets, 'native-clipboard.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, version: 4 }));
  let brokers = 0;
  const restored = new NativeClipboard({
    ...f.options,
    descendants: async () => {
      brokers++;
      throw new Error('v4 cannot start a reservation-free broker');
    },
  });
  t.after(() => restored.close());
  await restored.init();
  assert.equal(restored.view().processes.find((item) => item.pid === parent.pid)?.state, 'enforced');
  assert.equal(brokers, 0);
  await assert.rejects(
    (restored as any).descendantLaunch(request(), { pid: 2000, created: '134000000000000009' }),
    /第 5 版/,
  );
  assert.equal(f.commands.length, 0);
  assert.equal(
    JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => item.pid === child.pid),
    false,
  );
  await restored.action({
    action: 'configure',
    version: restored.view().version,
    settings: { enabled: false, applications: [] },
  });
  assert.equal(f.policies.get(key(parent)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

for (const version of [5, 6]) test(`legacy v${version} assets keep reservation-based descendant adoption, recovery and disable with the v7 service`, async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.close();
  const manifestPath = join(f.assets, 'native-clipboard.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, version }));
  const restored = new NativeClipboard(f.options);
  t.after(() => restored.close());
  await restored.init();
  assert.equal(restored.view().processes.find((item) => item.pid === parent.pid)?.state, 'enforced');
  await f.receive();
  assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0].args[0], 'adopt');
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(
    journal.managed.find((item: any) => item.pid === child.pid)?.inheritance.parent.pid,
    parent.pid,
  );
  f.inventory([parent, child]);
  await restored.action({ action: 'refresh' });
  assert.equal(restored.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
  await restored.action({
    action: 'configure',
    version: restored.view().version,
    settings: { enabled: false, applications: [] },
  });
  assert.equal(f.policies.get(key(parent)).active, false);
  assert.equal(f.policies.get(key(child)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});
