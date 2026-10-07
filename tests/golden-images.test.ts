/**
 * 模块职责：回归验证模块，围绕 `golden-images` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `golden-images`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: golden images persist a standalone template and create independent rekeying instances even after source deletion; golden image hash and incomplete metadata failures never adopt a VM, and incomplete folders can be removed.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-golden-test-'));
assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Bundles } = await import('../server/bundles.ts');
const { GoldenImages } = await import('../server/golden-images.ts');
const { Jobs } = await import('../server/jobs.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
after(() => rm(root, { recursive: true, force: true }));
const key = createSshKey(),
  seed = seedIso({ 'user-data': 'fixture' });
const disk = Buffer.alloc(4096, 0);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(2n * 1024n ** 3n, 24);
disk.write('golden content', 256);

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `id, folder, machines, engine, service, bundles, make`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, folder, machines, engine, service, bundles, make`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `createSchema.parse`, `new Date().toISOString`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: TestContext) {
  const id = randomUUID(),
    folder = join(root, 'library-' + id);
  const engine = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]。
     * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / '{}'`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / '{}'`) through a Promise.
     * 协作入口 / Collaborators: `JSON.stringify`, `copyFile`, `args.at`.
     */
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
      if (args[0] === 'convert') await copyFile(args.at(-2)!, args.at(-1)!);
      return '{}';
    },
  } as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  const source = {
    ...createSchema.parse({ name: 'gold-source', diskGiB: 2, forwards: [{ host: 22111, guest: 8080 }] }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
    bootstrapped: true,
  };
  machines.records.set(id, source);
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  await writeFile(
    join(vmDir(id), 'project.json'),
    JSON.stringify({ directory: '/workspace', environment: {} }),
  );
  const bundles = new Bundles(machines);
  const service = new GoldenImages(machines, bundles, folder, new Jobs('golden', join(folder, 'jobs')));
  t.after(() => service.close());
  /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`service.action({ action: 'create', vmId: id, name: '干净环境', note: 'fixture', sour…`）。
   * Result: Return the branch-computed value (`service.action({ action: 'create', vmId: id, name: '干净环境', note: 'fixture', sour…`).
   * 协作入口 / Collaborators: `service.action`.
   */
  const make = () =>
    service.action({ action: 'create', vmId: id, name: '干净环境', note: 'fixture', sourceReviewed: true });
  return { id, folder, machines, engine, service, bundles, make };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: golden images persist a standalone template and create independent rekeying instances even after source deletion
 * 协作入口 / Collaborators: `fixture`, `f.make`, `f.service.view`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(saved.kind, 'template')`; `assert.equal(view.templates.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('golden images persist a standalone template and create independent rekeying instances even after source deletion', async (t) => {
  const f = await fixture(t);
  const saved = await f.make();
  let view = await f.service.view();
  assert.equal(saved.kind, 'template');
  assert.equal(view.templates.length, 1);
  assert.equal(view.issues.length, 0);
  assert.equal(view.templates[0].sourceId, f.id);
  assert.ok(!JSON.stringify(view).includes(key.privateText));
  assert.equal((await f.service.action({ action: 'verify', id: saved.id })).kind, 'verified');
  f.machines.records.delete(f.id);
  const restored = new GoldenImages(f.machines, f.bundles, f.folder, new Jobs());
  t.after(() => restored.close());
  assert.equal((await restored.view()).templates[0].sha256, view.templates[0].sha256);
  const created = await restored.action({ action: 'instantiate', id: saved.id, name: 'from-golden' });
  assert.equal(created.kind, 'vm');
  assert.deepEqual(await readFile(join(vmDir(created.id), 'disk.qcow2')), disk);
  assert.deepEqual(f.machines.get(created.id).forwards, []);
  assert.notEqual(
    JSON.parse(await readFile(join(vmDir(created.id), 'identity.json'), 'utf8')).privateText,
    key.privateText,
  );
  assert.equal(f.machines.state(created.id), 'stopped');
  await restored.action({ action: 'delete', id: saved.id });
  assert.equal((await restored.view()).templates.length, 0);
  assert.deepEqual(await readFile(join(vmDir(created.id), 'disk.qcow2')), disk);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: golden image hash and incomplete metadata failures never adopt a VM, and incomplete folders can be removed
 * 状态影响 / State effects: `bytes[bytes.length - 1]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.make`, `join`, `readFile`.
 * 检查边界 / Checked boundaries: `assert.rejects( f.service.action({ action: 'instantiate', id: saved.id, name: 'corrupted' }), /SHA-256/, )`; `assert.equal(f.machines.records.size, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('golden image hash and incomplete metadata failures never adopt a VM, and incomplete folders can be removed', async (t) => {
  const f = await fixture(t),
    saved = await f.make();
  const bundle = join(f.folder, saved.id, 'template.sakura');
  const bytes = await readFile(bundle);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(bundle, bytes);
  await assert.rejects(
    f.service.action({ action: 'instantiate', id: saved.id, name: 'corrupted' }),
    /SHA-256/,
  );
  assert.equal(f.machines.records.size, 1);
  await writeFile(join(f.folder, saved.id, 'manifest.json'), 'broken');
  assert.equal((await f.service.view()).issues.length, 1);
  await assert.rejects(f.make(), /损坏/);
  await f.service.action({ action: 'delete', id: saved.id });
  assert.equal((await f.service.view()).issues.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: golden image operations reject running and sandbox sources, require review, serialize work, and cancel incomplete output
 * 状态影响 / State effects: `f.machines.get(f.id).sandbox`, `f.bundles.withExportBudget`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.service.action`, `f.machines.live.set`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action({ action: 'create', vmId: f.id, name: 'x', sourceReviewed: false }))`; `assert.rejects(f.make(), /停止/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('golden image operations reject running and sandbox sources, require review, serialize work, and cancel incomplete output', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.action({ action: 'create', vmId: f.id, name: 'x', sourceReviewed: false }));
  f.machines.live.set(f.id, {} as any);
  await assert.rejects(f.make(), /停止/);
  f.machines.live.delete(f.id);
  f.machines.get(f.id).sandbox = {} as any;
  await assert.rejects(f.make(), /沙箱/);
  delete f.machines.get(f.id).sandbox;
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const running = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.bundles.withExportBudget = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: _id; signal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: golden image operations reject running and sandbox sources, require review, serialize work, and cancel incomplete output
   * 失败 / Failure: `new Error('Cancelled operation cannot publish')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `entered`.
   */
  async (_id, signal) => {
    entered();
    await new Promise<void>((_resolve, reject) =>
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
    );
    throw new Error('Cancelled operation cannot publish');
  };
  const abort = new AbortController();
  const pending = f.service.action(
    { action: 'create', vmId: f.id, name: 'cancel', sourceReviewed: true },
    abort.signal,
  );
  await running;
  await assert.rejects(f.service.action({ action: 'delete', id: randomUUID() }), /进行/);
  abort.abort();
  await assert.rejects(pending, /取消/);
  assert.equal((await f.service.view()).templates.length, 0);
  assert.equal((await f.service.view()).issues.length, 0);
  assert.equal(f.service.jobs.view('library')?.status, 'cancelled');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: golden images preserve unrelated and linked files and recheck source lockdown immediately before publishing a derived VM
 * 状态影响 / State effects: `f.machines.requireUnlocked`, `f.engine.run`, `block`, `f.machines.maintenance`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.make`, `join`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action({ action: 'delete', id: saved.id }), /其他文件/)`; `assert.equal(await readFile(join(folder, 'user-notes.txt'), 'utf8'), 'preserve')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('golden images preserve unrelated and linked files and recheck source lockdown immediately before publishing a derived VM', async (t) => {
  const f = await fixture(t),
    saved = await f.make();
  const folder = join(f.folder, saved.id);
  await writeFile(join(folder, 'user-notes.txt'), 'preserve');
  await assert.rejects(f.service.action({ action: 'delete', id: saved.id }), /其他文件/);
  assert.equal(await readFile(join(folder, 'user-notes.txt'), 'utf8'), 'preserve');
  await rm(join(folder, 'user-notes.txt'));
  const linked = join(f.folder, 'saved-copy');
  await link(join(folder, 'template.sakura'), linked);
  await assert.rejects(f.service.action({ action: 'verify', id: saved.id }), /链接/);
  await assert.rejects(f.service.action({ action: 'delete', id: saved.id }), /链接/);
  await rm(linked);
  let block = false;
  f.machines.requireUnlocked = /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: golden images preserve unrelated and linked files and recheck source lockdown immediately before publishing a derived VM
   * 失败 / Failure: `new Error('应急锁定')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  () => {
    if (block) throw new Error('应急锁定');
  };
  const original = f.engine.run;
  f.engine.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: tool; args; options。
   * 结果：返回分支计算值（`result`），以 Promise 交付。
   * Result: Return the branch-computed value (`result`) through a Promise.
   * 验证场景 / Scenario: golden images preserve unrelated and linked files and recheck source lockdown immediately before publishing a derived VM
   * 状态影响 / State effects: `block`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `original`.
   */
  async (tool, args, options) => {
    const result = await original(tool, args, options);
    if (args[0] === 'info') block = true;
    return result;
  };
  await assert.rejects(
    f.service.action({ action: 'instantiate', id: saved.id, name: 'blocked' }),
    /应急锁定/,
  );
  assert.equal(f.machines.records.size, 1);
  block = false;
  f.engine.run = original;
  f.machines.maintenance = true;
  await assert.rejects(
    f.service.action({ action: 'instantiate', id: saved.id, name: 'maintenance' }),
    /维护/,
  );
  assert.equal(f.machines.records.size, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: golden library limits count before conversion and closed services cannot admit new work
 * 协作入口 / Collaborators: `fixture`, `f.make`, `f.service.view`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.make(), /16/)`; `assert.equal((await f.service.view()).templates.length, 16)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('golden library limits count before conversion and closed services cannot admit new work', async (t) => {
  const f = await fixture(t),
    saved = await f.make();
  const original = (await f.service.view()).templates[0];
  for (let count = 1; count < 16; count++) {
    const id = randomUUID(),
      directory = join(f.folder, id);
    await mkdir(directory);
    await copyFile(join(f.folder, saved.id, 'template.sakura'), join(directory, 'template.sakura'));
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...original, id }));
  }
  await assert.rejects(f.make(), /16/);
  assert.equal((await f.service.view()).templates.length, 16);
  await assert.rejects(f.service.action({ action: 'delete', id: '../' }));
  await f.service.close();
  await assert.rejects(f.service.action({ action: 'delete', id: saved.id }), /关闭/);
});
