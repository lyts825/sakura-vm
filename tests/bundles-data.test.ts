/**
 * 模块职责：回归验证模块，围绕 `bundles-data` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `bundles-data`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: bundle import requires a private controller identity before publishing a VM; bundle import accepts both PEM and modern OpenSSH private controller identities.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { hostRuntime } from '../server/host-runtime/index.ts';
import ssh2 from 'ssh2';
import type { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-bundle-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Bundles } = await import('../server/bundles.ts');
const { storageRuntime } = await import('../server/storage-runtime.ts');
const { Machines: MachineManager } = await import('../server/machines.ts');
const { vmDir, createSchema } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
const { TrustedBootService } = await import('../server/trusted-boot-service.ts');
const { verifyBackup } = await import('../server/backups.ts');
after(() => rm(root, { recursive: true, force: true }));
const key = createSshKey();
const seed = seedIso({ 'user-data': 'test' });
const disk = Buffer.alloc(104);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);

/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: privateKey = key.privateText。
 * 结果：返回分支计算值（`Readable.from([prefix, manifest, disk])`）。
 * Result: Return the branch-computed value (`Readable.from([prefix, manifest, disk])`).
 * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `createSchema.parse`, `seed.toString`.
 */
function bundle(privateKey = key.privateText) {
  const manifest = Buffer.from(
    JSON.stringify({
      version: 1,
      config: createSchema.parse({ name: 'original' }),
      key: privateKey,
      seed: seed.toString('base64'),
      sha256: createHash('sha256').update(disk).digest('hex'),
    }),
  );
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(manifest.length, 8);
  return Readable.from([prefix, manifest, disk]);
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bundle import requires a private controller identity before publishing a VM
 * 协作入口 / Collaborators: `assert.rejects`, `new Bundles(machines).import`, `bundle`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(new Bundles(machines).import('copy', bundle(key.publicText)), /身份/)`; `assert.equal(adopted, false)`.
 */
test('bundle import requires a private controller identity before publishing a VM', async () => {
  let adopted = false;
  const machines = {
    engine: { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'{}'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'{}'`) through a Promise.
     * 验证场景 / Scenario: bundle import requires a private controller identity before publishing a VM
     */
    run: async () => '{}' },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: bundle import requires a private controller identity before publishing a VM
     * 状态影响 / State effects: `adopted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    adopt: async () => {
      adopted = true;
    },
  } as unknown as Machines;
  await assert.rejects(new Bundles(machines).import('copy', bundle(key.publicText)), /身份/);
  assert.equal(adopted, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bundle import accepts both PEM and modern OpenSSH private controller identities
 * 协作入口 / Collaborators: `ssh2.utils.generateKeyPairSync`, `new Bundles(machines).import`, `bundle`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(adoptedKey, privateKey)`.
 */
test('bundle import accepts both PEM and modern OpenSSH private controller identities', async () => {
  for (const privateKey of [key.privateText, ssh2.utils.generateKeyPairSync('ed25519').private]) {
    let adoptedKey: string | undefined;
    const machines = {
      engine: { /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'{}'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'{}'`) through a Promise.
       * 验证场景 / Scenario: bundle import accepts both PEM and modern OpenSSH private controller identities
       */
      run: async () => '{}' },
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: _config: unknown; _disk: string; identity: string。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: bundle import accepts both PEM and modern OpenSSH private controller identities
       * 状态影响 / State effects: `adoptedKey`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       */
      adopt: async (_config: unknown, _disk: string, identity: string) => {
        adoptedKey = identity;
      },
    } as unknown as Machines;
    await new Bundles(machines).import('copy', bundle(privateKey));
    assert.equal(adoptedKey, privateKey);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: import cancellation after disk inspection does not publish a VM
 * 协作入口 / Collaborators: `assert.rejects`, `new Bundles(machines).import`, `bundle`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(new Bundles(machines).import('copy', bundle(), abort.signal), { name: 'AbortError' })`; `assert.equal(signal?.aborted, true)`.
 */
test('import cancellation after disk inspection does not publish a VM', async () => {
  const abort = new AbortController();
  let adopted = false;
  let signal: AbortSignal | undefined;
  const machines = {
    engine: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _command: string; _args: string[]; options: { signal?: AbortSignal }。
       * 结果：返回分支计算值（`'{}'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'{}'`) through a Promise.
       * 验证场景 / Scenario: import cancellation after disk inspection does not publish a VM
       * 状态影响 / State effects: `signal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `abort.abort`.
       */
      run: async (_command: string, _args: string[], options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        abort.abort();
        return '{}';
      },
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: import cancellation after disk inspection does not publish a VM
     * 状态影响 / State effects: `adopted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    adopt: async () => {
      adopted = true;
    },
  } as unknown as Machines;
  await assert.rejects(new Bundles(machines).import('copy', bundle(), abort.signal), { name: 'AbortError' });
  assert.equal(signal?.aborted, true);
  assert.equal(adopted, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
 * 协作入口 / Collaborators: `randomUUID`, `mkdir`, `vmDir`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(new Bundles(machines).clone(id, 'copy', undefined, abort.signal), { name: 'AbortError', })`; `assert.equal(signal, abort.signal)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('clone cancellation after conversion does not publish a VM or remove its source', async () => {
  const id = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  const abort = new AbortController();
  let adopted = false;
  let signal: AbortSignal | undefined;
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_id: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
     */
    requireStopped: () => {},
    storagePools: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`join(root, 'machines', id)`）。
     * Result: Return the branch-computed value (`join(root, 'machines', id)`).
     * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
     * 协作入口 / Collaborators: `join`.
     */
    directory: (id: string) => join(root, 'machines', id) },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...createSchema.parse({ name: 'original' }), snapshots: [] })`）。
     * Result: Return the branch-computed value (`({ ...createSchema.parse({ name: 'original' }), snapshots: [] })`).
     * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
     * 协作入口 / Collaborators: `createSchema.parse`.
     */
    get: () => ({ ...createSchema.parse({ name: 'original' }), snapshots: [] }),
    engine: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _command: string; args: string[]; options: { signal?: AbortSignal }。
       * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / ''`），以 Promise 交付。
       * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / ''`) through a Promise.
       * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
       * 状态影响 / State effects: `signal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `JSON.stringify`, `writeFile`, `args.at`, `abort.abort`.
       */
      run: async (_command: string, args: string[], options?: { signal?: AbortSignal }) => {
        signal = options?.signal;
        if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
        await writeFile(args.at(-1)!, disk);
        abort.abort();
        return '';
      },
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ key: key.privateText, seed })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ key: key.privateText, seed })`) through a Promise.
     * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
     */
    snapshotIdentity: async () => ({ key: key.privateText, seed }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: clone cancellation after conversion does not publish a VM or remove its source
     * 状态影响 / State effects: `adopted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    adopt: async () => {
      adopted = true;
    },
  } as unknown as Machines;
  await assert.rejects(new Bundles(machines).clone(id, 'copy', undefined, abort.signal), {
    name: 'AbortError',
  });
  assert.equal(signal, abort.signal);
  assert.equal(adopted, false);
  assert.deepEqual(await readFile(join(vmDir(id), 'disk.qcow2')), disk);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
 * 协作入口 / Collaborators: `randomUUID`, `mkdir`, `vmDir`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.equal(adoptedKey, key.privateText)`; `assert.deepEqual(adoptedSeed, seed)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cloning an older snapshot uses its controller identity instead of the current disk key', async () => {
  const id = randomUUID();
  const snapshot = randomUUID();
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'id_rsa'), 'current key');
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  let adoptedKey: string | undefined;
  let adoptedSeed: Buffer | undefined;
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_id: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
     */
    requireStopped: () => {},
    storagePools: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`join(root, 'machines', id)`）。
     * Result: Return the branch-computed value (`join(root, 'machines', id)`).
     * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
     * 协作入口 / Collaborators: `join`.
     */
    directory: (id: string) => join(root, 'machines', id) },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ ...createSchema.parse({ name: 'original' }), snapshots: [{ id: snapshot }] })`）。
     * Result: Return the branch-computed value (`({ ...createSchema.parse({ name: 'original' }), snapshots: [{ id: snapshot }] })`).
     * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
     * 协作入口 / Collaborators: `createSchema.parse`.
     */
    get: () => ({ ...createSchema.parse({ name: 'original' }), snapshots: [{ id: snapshot }] }),
    engine: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _command: string; args: string[]。
       * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / ''`），以 Promise 交付。
       * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / ''`) through a Promise.
       * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
       * 协作入口 / Collaborators: `assert.equal`, `args.indexOf`, `JSON.stringify`, `assert.deepEqual`.
       * 检查边界 / Checked boundaries: `assert.equal(args[args.indexOf('-l') + 1], snapshot)`; `assert.deepEqual(args.slice(5, 7), ['-l', snapshot])`.
       */
      run: async (_command: string, args: string[]) => {
        if (args[0] === 'measure') {
          assert.equal(args[args.indexOf('-l') + 1], snapshot);
          return JSON.stringify({ required: disk.length });
        }
        assert.deepEqual(args.slice(5, 7), ['-l', snapshot]);
        await writeFile(args.at(-1)!, disk);
        return '';
      },
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: machineId: string; snapshotId: string。
     * 结果：返回受控对象，公开字段包括 `key, seed`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `key, seed`; the actual branch determines its shape.
     * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(machineId, id)`; `assert.equal(snapshotId, snapshot)`.
     */
    snapshotIdentity: async (machineId: string, snapshotId?: string) => {
      assert.equal(machineId, id);
      assert.equal(snapshotId, snapshot);
      return { key: key.privateText, seed };
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: _config: unknown; _disk: string; identity: string; initialSeed: Buffer。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: cloning an older snapshot uses its controller identity instead of the current disk key
     * 状态影响 / State effects: `adoptedKey`, `adoptedSeed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    adopt: async (_config: unknown, _disk: string, identity: string, initialSeed: Buffer) => {
      adoptedKey = identity;
      adoptedSeed = initialSeed;
    },
  } as unknown as Machines;
  await new Bundles(machines).clone(id, 'copy', snapshot);
  assert.equal(adoptedKey, key.privateText);
  assert.deepEqual(adoptedSeed, seed);
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `machines, id, bundles`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, id, bundles`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `machines.init`, `t.after`, `randomUUID`, `machines.records.set`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function resizeFixture(t: TestContext) {
  const machines = new MachineManager({
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool; args。
     * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / '{}'`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / '{}'`) through a Promise.
     * 协作入口 / Collaborators: `JSON.stringify`, `writeFile`, `args.at`.
     */
    run: async (_tool, args) => {
      if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
      if (args[0] === 'convert') await writeFile(args.at(-1)!, disk);
      return '{}';
    },
  } as Engine);
  await machines.init();
  t.after(() => machines.close());
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: `original-${id.slice(0, 8)}` }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id), { recursive: true });
  await writeFile(join(vmDir(id), 'disk.qcow2'), disk);
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  await writeFile(join(vmDir(id), 'seed.iso'), seed);
  return { machines, id, bundles: new Bundles(machines) };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: clones use the filesystem resize state of their source disk or selected snapshot
 * 协作入口 / Collaborators: `resizeFixture`, `machines.resize`, `machines.get`, `machines.snapshot`.
 * 检查边界 / Checked boundaries: `assert.equal(current.pendingResize, true)`; `assert.equal(historical.diskGiB, 16)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('clones use the filesystem resize state of their source disk or selected snapshot', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  await machines.resize(id, 16);
  const before = machines.get(id).snapshots[0];
  const pending = await machines.snapshot(id, 'pending');
  const current = await bundles.clone(id, 'pending-current');
  assert.equal(current.pendingResize, true);

  await machines.completeResize(id);
  const historical = await bundles.clone(id, 'pending-snapshot', pending.id);
  assert.equal(historical.diskGiB, 16);
  assert.equal(historical.pendingResize, true);
  const original = await bundles.clone(id, 'before-resize', before.id);
  assert.equal(original.diskGiB, 8);
  assert.equal(original.pendingResize, false);
  const completed = await bundles.clone(id, 'completed-current');
  assert.equal(completed.pendingResize, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: portable backup round trips persist pending filesystem growth across service restarts
 * 协作入口 / Collaborators: `resizeFixture`, `machines.resize`, `bundles.export`, `bundles.import`.
 * 检查边界 / Checked boundaries: `assert.equal(restored.diskGiB, 16)`; `assert.equal(restored.pendingResize, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('portable backup round trips persist pending filesystem growth across service restarts', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  await machines.resize(id, 16);
  const chunks: Buffer[] = [];
  await bundles.export(
    id,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: portable backup round trips persist pending filesystem growth across service restarts
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `callback`.
       */
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
  );
  const restored = await bundles.import('pending-backup', Readable.from([Buffer.concat(chunks)]));
  assert.equal(restored.diskGiB, 16);
  assert.equal(restored.pendingResize, true);

  const reopened = new MachineManager(machines.engine);
  await reopened.init();
  t.after(() => reopened.close());
  assert.equal(reopened.get(restored.id).pendingResize, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: portable backups and clones retain the KDE recovery project without exporting its environment
 * 协作入口 / Collaborators: `resizeFixture`, `'a'.repeat`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).desktopBinding, binding)`; `assert.deepEqual( JSON.parse(await readFile(join(vmDir(copy.id), 'desktop-binding.json'), 'utf8')), binding, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('portable backups and clones retain the KDE recovery project without exporting its environment', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  const binding = {
    version: 1,
    projectId: 'default',
    directory: '/workspace',
    networkIsolation: 'private',
    launcherSha256: 'a'.repeat(64),
    enabled: true,
  };
  await writeFile(join(vmDir(id), 'desktop-binding.json'), JSON.stringify(binding));
  const chunks: Buffer[] = [];
  await bundles.export(
    id,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; done。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: portable backups and clones retain the KDE recovery project without exporting its environment
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `done`.
       */
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    }),
    () => {},
  );
  const payload = Buffer.concat(chunks);
  const length = payload.readUInt32BE(8);
  assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).desktopBinding, binding);
  const restored = await bundles.import('desktop-import', Readable.from([payload]));
  const cloned = await bundles.clone(id, 'desktop-clone');
  for (const copy of [restored, cloned])
    assert.deepEqual(
      JSON.parse(await readFile(join(vmDir(copy.id), 'desktop-binding.json'), 'utf8')),
      binding,
    );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: peer bundle imports persist an origin that prevents duplicate transfer adoption
 * 协作入口 / Collaborators: `resizeFixture`, `randomUUID`, `bundles.import`, `bundle`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(imported.migrationOrigin, persistedOrigin)`; `assert.rejects( bundles.import('duplicate', bundle(), undefined, undefined, migrationOrigin), /已经导入/, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('peer bundle imports persist an origin that prevents duplicate transfer adoption', async (t) => {
  const { machines, bundles } = await resizeFixture(t);
  const migrationOrigin = { sourceHostId: randomUUID(), transferId: randomUUID(), targetName: 'migrated' };
  const imported = await bundles.import('migrated', bundle(), undefined, undefined, migrationOrigin);
  const persistedOrigin = { ...migrationOrigin, diskSha256: createHash('sha256').update(disk).digest('hex') };
  assert.deepEqual(imported.migrationOrigin, persistedOrigin);
  await assert.rejects(
    bundles.import('duplicate', bundle(), undefined, undefined, migrationOrigin),
    /已经导入/,
  );
  const reopened = new MachineManager(machines.engine);
  await reopened.init();
  t.after(() => reopened.close());
  assert.deepEqual(reopened.get(imported.id).migrationOrigin, persistedOrigin);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: portable backups and clones retain X11/Wayland application identities, rules and controller ownership
 * 协作入口 / Collaborators: `resizeFixture`, `randomUUID`, `'c'.repeat`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).x11Clipboard, settings)`; `assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).waylandClipboard, wayland)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('portable backups and clones retain X11/Wayland application identities, rules and controller ownership', async (t) => {
  const { id, bundles } = await resizeFixture(t);
  const settings = {
    schemaVersion: 1,
    version: 4,
    owner: randomUUID(),
    applications: [
      {
        image: '/usr/bin/konsole',
        sha256: 'c'.repeat(64),
        rule: { copy: false, paste: true, files: false, sensitive: true, maxTextBytes: 4096 },
      },
    ],
  };
  await writeFile(join(vmDir(id), 'x11-clipboard.json'), JSON.stringify(settings));
  const wayland = { ...settings, owner: randomUUID(), version: 6 };
  await writeFile(join(vmDir(id), 'wayland-clipboard.json'), JSON.stringify(wayland));
  const chunks: Buffer[] = [];
  await bundles.export(
    id,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; done。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: portable backups and clones retain X11/Wayland application identities, rules and controller ownership
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `done`.
       */
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    }),
    () => {},
  );
  const payload = Buffer.concat(chunks),
    length = payload.readUInt32BE(8);
  assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).x11Clipboard, settings);
  assert.deepEqual(JSON.parse(payload.subarray(12, 12 + length).toString()).waylandClipboard, wayland);
  const imported = await bundles.import('clipboard-import', Readable.from([payload]));
  const cloned = await bundles.clone(id, 'clipboard-clone');
  for (const copy of [imported, cloned]) {
    assert.deepEqual(
      JSON.parse(await readFile(join(vmDir(copy.id), 'x11-clipboard.json'), 'utf8')),
      settings,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(vmDir(copy.id), 'wayland-clipboard.json'), 'utf8')),
      wayland,
    );
  }
  await writeFile(
    join(vmDir(id), 'wayland-clipboard.json'),
    JSON.stringify({ ...wayland, owner: 'invalid' }),
  );
  await assert.rejects(bundles.clone(id, 'wayland-clipboard-invalid'));
  await writeFile(join(vmDir(id), 'wayland-clipboard.json'), JSON.stringify(wayland));
  await writeFile(join(vmDir(id), 'x11-clipboard.json'), JSON.stringify({ ...settings, owner: 'invalid' }));
  await assert.rejects(bundles.clone(id, 'clipboard-invalid'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bundle export selects historical snapshot disk, identity, and resize state
 * 状态影响 / State effects: `historicalDisk[103]`, `vm.diskGiB`, `vm.pendingResize`, `machines.engine.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `resizeFixture`, `randomUUID`, `Buffer.from`, `ssh2.utils.generateKeyPairSync`.
 * 检查边界 / Checked boundaries: `assert.equal(calls.find((call) => call[0] === 'measure')![7], snapshot)`; `assert.deepEqual(calls.find((call) => call[0] === 'convert')!.slice(5, 7), ['-l', snapshot])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('bundle export selects historical snapshot disk, identity, and resize state', async (t) => {
  const { machines, id, bundles } = await resizeFixture(t);
  const snapshot = randomUUID();
  const historicalDisk = Buffer.from(disk);
  historicalDisk[103] = 0x5a;
  const olderKey = ssh2.utils.generateKeyPairSync('ed25519').private;
  const olderSeed = seedIso({ 'user-data': 'historical' });
  const vm = machines.get(id);
  vm.snapshots.push({
    id: snapshot,
    name: 'historical',
    createdAt: new Date().toISOString(),
    diskGiB: 8,
    pendingResize: false,
  });
  vm.diskGiB = 16;
  vm.pendingResize = true;
  await writeFile(
    join(vmDir(id), `.snapshot-${snapshot}.json`),
    JSON.stringify({
      key: olderKey,
      seed: olderSeed.toString('base64'),
    }),
  );
  const calls: string[][] = [];
  machines.engine.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _tool; args。
   * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / '{}'`），以 Promise 交付。
   * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / '{}'`) through a Promise.
   * 验证场景 / Scenario: bundle export selects historical snapshot disk, identity, and resize state
   * 协作入口 / Collaborators: `calls.push`, `JSON.stringify`, `writeFile`, `args.at`.
   */
  async (_tool, args) => {
    calls.push(args);
    if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
    if (args[0] === 'convert') await writeFile(args.at(-1)!, args.includes('-l') ? historicalDisk : disk);
    return '{}';
  };
  const chunks: Buffer[] = [];
  const sha256 = await bundles.export(
    id,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: bundle export selects historical snapshot disk, identity, and resize state
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `callback`.
       */
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
    undefined,
    0,
    snapshot,
  );
  assert.equal(calls.find((call) => call[0] === 'measure')![7], snapshot);
  assert.deepEqual(calls.find((call) => call[0] === 'convert')!.slice(5, 7), ['-l', snapshot]);
  assert.equal(sha256, createHash('sha256').update(historicalDisk).digest('hex'));
  const contents = Buffer.concat(chunks);
  const length = contents.readUInt32BE(8);
  const manifest = JSON.parse(contents.subarray(12, 12 + length).toString('utf8'));
  assert.equal(manifest.config.diskGiB, 8);
  assert.equal(manifest.pendingResize, false);
  assert.equal(manifest.key, olderKey);
  assert.equal(manifest.seed, olderSeed.toString('base64'));
  assert.deepEqual(contents.subarray(12 + length), historicalDisk);
  assert.deepEqual(await readFile(join(vmDir(id), 'disk.qcow2')), disk);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cold migration deletion rechecks the source disk under its machine lock
 * 协作入口 / Collaborators: `resizeFixture`, `machines.migrationFingerprint`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.delete(id, expected), /源实例在迁移后已变化/)`; `assert.ok(machines.records.has(id))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cold migration deletion rechecks the source disk under its machine lock', async (t) => {
  const { machines, id } = await resizeFixture(t);
  const expected = await machines.migrationFingerprint(id);
  await writeFile(join(vmDir(id), 'disk.qcow2'), Buffer.concat([disk, Buffer.from('changed')]));
  await assert.rejects(machines.delete(id, expected), /源实例在迁移后已变化/);
  assert.ok(machines.records.has(id));
  const afterDiskChange = await machines.migrationFingerprint(id);
  await writeFile(join(vmDir(id), 'project.json'), '{"changed":true}');
  await assert.rejects(machines.delete(id, afterDiskChange), /源实例在迁移后已变化/);
  const current = await machines.migrationFingerprint(id);
  await machines.delete(id, current);
  assert.equal(machines.records.has(id), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy portable backups without resize metadata remain importable
 * 协作入口 / Collaborators: `resizeFixture`, `bundles.import`, `bundle`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(!!restored.pendingResize, false)`.
 */
test('legacy portable backups without resize metadata remain importable', async (t) => {
  const { bundles } = await resizeFixture(t);
  const restored = await bundles.import('legacy-backup', bundle());
  assert.equal(!!restored.pendingResize, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
 * 协作入口 / Collaborators: `randomUUID`, `createSchema.parse`, `new Date().toISOString`, `bundles.export`.
 * 检查边界 / Checked boundaries: `assert.equal(manifest.config.firmware, 'uefi')`; `assert.equal((adopted[0] as any).firmware, 'uefi')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('UEFI firmware choice survives portable export, import, and clone', async () => {
  const id = randomUUID();
  const vm = {
    ...createSchema.parse({ name: 'firmware-source', firmware: 'uefi' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  };
  const adopted: unknown[] = [];
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_id: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
     */
    requireStopped: () => {},
    storagePools: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: id: string。
     * 结果：返回分支计算值（`join(root, 'machines', id)`）。
     * Result: Return the branch-computed value (`join(root, 'machines', id)`).
     * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
     * 协作入口 / Collaborators: `join`.
     */
    directory: (id: string) => join(root, 'machines', id) },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
     */
    get: () => vm,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ key: key.privateText, seed })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ key: key.privateText, seed })`) through a Promise.
     * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
     */
    snapshotIdentity: async () => ({ key: key.privateText, seed }),
    engine: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _tool: string; args: string[]。
       * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / '{}'`），以 Promise 交付。
       * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / '{}'`) through a Promise.
       * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
       * 协作入口 / Collaborators: `JSON.stringify`, `writeFile`, `args.at`.
       */
      run: async (_tool: string, args: string[]) => {
        if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
        if (args[0] === 'convert') await writeFile(args.at(-1)!, disk);
        return '{}';
      },
    },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: config: unknown。
     * 结果：返回受控对象，公开字段包括 `id`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `id`; the actual branch determines its shape.
     * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
     * 协作入口 / Collaborators: `adopted.push`, `randomUUID`.
     */
    adopt: async (config: unknown) => {
      adopted.push(config);
      return { id: randomUUID() };
    },
  } as unknown as Machines;
  const bundles = new Bundles(machines);
  const chunks: Buffer[] = [];
  await bundles.export(
    id,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: UEFI firmware choice survives portable export, import, and clone
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `callback`.
       */
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
  );
  const contents = Buffer.concat(chunks);
  const length = contents.readUInt32BE(8);
  const manifest = JSON.parse(contents.subarray(12, 12 + length).toString('utf8'));
  assert.equal(manifest.config.firmware, 'uefi');
  await bundles.import('firmware-copy', Readable.from([contents]));
  await bundles.clone(id, 'firmware-clone');
  assert.equal((adopted[0] as any).firmware, 'uefi');
  assert.equal((adopted[1] as any).firmware, 'uefi');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: portable backup, import, and clone retain TPM identity and secure NVRAM
 * 协作入口 / Collaborators: `resizeFixture`, `service.init`, `t.after`, `randomBytes`.
 * 检查边界 / Checked boundaries: `assert.ok(manifestLength > 300_000)`; `assert.equal((await service.view(target.id)).policy.enabled, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('portable backup, import, and clone retain TPM identity and secure NVRAM', async (t) => {
  const { machines, id } = await resizeFixture(t);
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(() => service.close());
  const bundles = new Bundles(machines, undefined, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id。
   * 结果：返回分支计算值（`(id === 'trustedBoot' ? service : undefined) as never`）。
   * Result: Return the branch-computed value (`(id === 'trustedBoot' ? service : undefined) as never`).
   * 验证场景 / Scenario: portable backup, import, and clone retain TPM identity and secure NVRAM
   */
  optional: id => (id === 'trustedBoot' ? service : undefined) as never });
  const vars = randomBytes(340_000);
  const permanent = Buffer.from('persistent-tpm-identity');
  await service.restore(id, {
    enabled: true,
    files: [
      { name: 'uefi-secure-vars.fd', data: vars },
      { name: 'tpm2/tpm2-00.permall', data: permanent },
    ],
  });
  await writeFile(join(vmDir(id), 'tpm2', '.lock'), 'transient');
  const firstFingerprint = await machines.migrationFingerprint(id);
  const chunks: Buffer[] = [];
  await bundles.export(
    id,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: portable backup, import, and clone retain TPM identity and secure NVRAM
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `callback`.
       */
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
  );
  const contents = Buffer.concat(chunks);
  const manifestLength = contents.readUInt32BE(8);
  assert.ok(manifestLength > 300_000);
  const file = join(root, `${id}.sakura`);
  await writeFile(file, contents);
  await verifyBackup(file, new AbortController().signal);
  const imported = await bundles.import('trusted-import', Readable.from([contents]));
  const cloned = await bundles.clone(id, 'trusted-clone');
  for (const target of [imported, cloned]) {
    assert.equal((await service.view(target.id)).policy.enabled, true);
    assert.deepEqual(await readFile(join(vmDir(target.id), 'uefi-secure-vars.fd')), vars);
    assert.deepEqual(await readFile(join(vmDir(target.id), 'tpm2', 'tpm2-00.permall')), permanent);
    await assert.rejects(readFile(join(vmDir(target.id), 'tpm2', '.lock')), { code: 'ENOENT' });
  }
  await writeFile(join(vmDir(id), 'tpm2', 'tpm2-00.permall'), 'changed');
  assert.notDeepEqual(await machines.migrationFingerprint(id), firstFingerprint);
  const snapshot = randomUUID();
  machines.get(id).snapshots.push({ id: snapshot, name: 'older', createdAt: new Date().toISOString() });
  await assert.rejects(
    bundles.export(
      id,
      new Writable({
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: _chunk; _encoding; callback。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: portable backup, import, and clone retain TPM identity and secure NVRAM
         * 协作入口 / Collaborators: `callback`.
         */
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      () => {},
      undefined,
      0,
      snapshot,
    ),
    /没有对应的 TPM\/NVRAM 状态/,
  );
  await assert.rejects(bundles.clone(id, 'trusted-history', snapshot), /没有对应的 TPM\/NVRAM 状态/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: tampered TPM state is rejected before import and backup verification
 * 状态影响 / State effects: `manifest.trustedBoot.files[0].sha256`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `resizeFixture`, `service.init`, `t.after`, `service.restore`.
 * 检查边界 / Checked boundaries: `assert.rejects(bundles.import('tampered-tpm', Readable.from([tampered])), /TPM 状态校验失败/)`; `assert.equal(machines.records.size, count)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('tampered TPM state is rejected before import and backup verification', async (t) => {
  const { machines, id } = await resizeFixture(t);
  const service = new TrustedBootService(machines);
  await service.init();
  t.after(() => service.close());
  const bundles = new Bundles(machines, undefined, { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: id。
   * 结果：返回分支计算值（`(id === 'trustedBoot' ? service : undefined) as never`）。
   * Result: Return the branch-computed value (`(id === 'trustedBoot' ? service : undefined) as never`).
   * 验证场景 / Scenario: tampered TPM state is rejected before import and backup verification
   */
  optional: id => (id === 'trustedBoot' ? service : undefined) as never });
  await service.restore(id, {
    enabled: true,
    files: [{ name: 'tpm2/tpm2-00.permall', data: Buffer.from('secret') }],
  });
  const chunks: Buffer[] = [];
  await bundles.export(
    id,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: tampered TPM state is rejected before import and backup verification
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `callback`.
       */
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
  );
  const contents = Buffer.concat(chunks);
  const length = contents.readUInt32BE(8);
  const manifest = JSON.parse(contents.subarray(12, 12 + length).toString('utf8'));
  manifest.trustedBoot.files[0].sha256 = '0'.repeat(64);
  const tamperedManifest = Buffer.from(JSON.stringify(manifest));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(tamperedManifest.length, 8);
  const tampered = Buffer.concat([prefix, tamperedManifest, contents.subarray(12 + length)]);
  const count = machines.records.size;
  await assert.rejects(bundles.import('tampered-tpm', Readable.from([tampered])), /TPM 状态校验失败/);
  assert.equal(machines.records.size, count);
  const file = join(root, `${id}-tampered.sakura`);
  await writeFile(file, tampered);
  await assert.rejects(verifyBackup(file, new AbortController().signal), /TPM 状态校验失败/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: idle, ended, failed and cancelled bundle sources never occupy a device writer or leave a staging directory
 * 协作入口 / Collaborators: `import`, `directories.readdir(join(root, 'transfers')).catch`, `directories.readdir`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects(task, /transport failed/)`; `assert.rejects(task)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('idle, ended, failed and cancelled bundle sources never occupy a device writer or leave a staging directory', async () => {
  const directories = await import('node:fs/promises');
  const before = await directories.readdir(join(root, 'transfers')).catch(() => []);
  const bundles = new Bundles({
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: idle, ended, failed and cancelled bundle sources never occupy a device writer or leave a staging directory
     * 失败 / Failure: `new Error('must not adopt')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    adopt: () => {
      throw new Error('must not adopt');
    },
  } as unknown as Machines);
  for (const mode of ['abort', 'close', 'error', 'empty']) {
    const input = new PassThrough(),
      controller = new AbortController();
    const task = bundles.import('idle', input, controller.signal);
    const rejected = mode === 'error' ? assert.rejects(task, /transport failed/) : assert.rejects(task);
    assert.equal(hostRuntime.snapshot().resources.filter((item) => item.kind === 'storage').length, 0);
    if (mode === 'abort') controller.abort();
    else if (mode === 'close') input.destroy();
    else if (mode === 'error') input.destroy(new Error('transport failed'));
    else input.end();
    await rejected;
    assert.equal(input.destroyed, true);
    assert.equal(hostRuntime.snapshot().resources.filter((item) => item.kind === 'storage').length, 0);
  }
  assert.deepEqual(await directories.readdir(join(root, 'transfers')).catch(() => []), before);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: two opposite bundle transfers sharing one host runtime leave admission for their inbound writes
 * 状态影响 / State effects: `fixture.machines.engine.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `resizeFixture`, `Buffer.alloc`, `disk.copy`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.equal(receives, 0)`; `assert.equal(receives, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(
  'two opposite bundle transfers sharing one host runtime leave admission for their inbound writes',
  { timeout: 10_000 },
  async (t) => {
    const a = await resizeFixture(t),
      b = await resizeFixture(t);
    const payload = Buffer.alloc(2 * 1024 ** 2);
    disk.copy(payload);
    let converted = 0,
      firstConversion!: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => void;
    const entered = new Promise<void>((done) => {
      firstConversion = done;
    });
    for (const fixture of [a, b]) {
      await writeFile(join(vmDir(fixture.id), 'disk.qcow2'), payload);
      fixture.machines.engine.run = /**
       * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
       * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
       * 输入 / Inputs: _tool; args。
       * 结果：返回分支计算值（`JSON.stringify({ required: payload.length }) / '{}'`），以 Promise 交付。
       * Result: Return the branch-computed value (`JSON.stringify({ required: payload.length }) / '{}'`) through a Promise.
       * 验证场景 / Scenario: two opposite bundle transfers sharing one host runtime leave admission for their inbound writes
       * 协作入口 / Collaborators: `JSON.stringify`, `hostRuntime .snapshot() .budgets.find`, `hostRuntime .snapshot`, `assert.equal`.
       * 检查边界 / Checked boundaries: `assert.equal(slots?.used, 1, 'Only one network export can consume the host outbound allowance')`.
       */
      async (_tool, args) => {
        if (args[0] === 'measure') return JSON.stringify({ required: payload.length });
        if (args[0] === 'convert') {
          converted++;
          const slots = hostRuntime
            .snapshot()
            .budgets.find((item) => item.key === 'partition:storage.outbound');
          assert.equal(slots?.used, 1, 'Only one network export can consume the host outbound allowance');
          firstConversion();
          await writeFile(args.at(-1)!, payload);
        }
        return '{}';
      };
    }
    const acquire = storageRuntime.acquire.bind(storageRuntime);
    let receives = 0;
    t.mock.method(storageRuntime, 'acquire', (request: Parameters<typeof acquire>[0]) => {
      if (request.owner === 'core:bundle-import') receives++;
      return acquire(request);
    });
    const ab = new PassThrough({ highWaterMark: 16 * 1024 }),
      ba = new PassThrough({ highWaterMark: 16 * 1024 });
    const controller = new AbortController();
    const abort = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
    const operations: Promise<unknown>[] = [];
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: task: Promise<T>。
     * 结果：返回分支计算值（`task`）。
     * Result: Return the branch-computed value (`task`).
     * 验证场景 / Scenario: two opposite bundle transfers sharing one host runtime leave admission for their inbound writes
     * 协作入口 / Collaborators: `operations.push`, `task.catch`.
     */
    const track = <T>(task: Promise<T>) => {
      operations.push(task);
      void task.catch(() => {});
      return task;
    };
    try {
      // Force the formerly deadlocking order: A waits for B before A's exporter
      // owns the outbound channel. Neither empty receiver may reserve the writer.
      const receivedA = track(a.bundles.import('received-b', ba, abort));
      const receivedB = track(b.bundles.import('received-a', ab, abort));
      assert.equal(receives, 0);
      const sentA = track(a.bundles.export(a.id, ab, () => {}, abort));
      await Promise.race([entered, sentA]);
      const sentB = track(b.bundles.export(b.id, ba, () => {}, abort));
      const [copyA, copyB] = await Promise.all([receivedA, receivedB, sentA, sentB]);
      assert.equal(receives, 2);
      assert.equal(converted, 2);
      assert.deepEqual(await readFile(join(vmDir(copyA.id), 'disk.qcow2')), payload);
      assert.deepEqual(await readFile(join(vmDir(copyB.id), 'disk.qcow2')), payload);
      assert.equal(hostRuntime.snapshot().resources.filter((item) => item.kind === 'storage').length, 0);
    } finally {
      controller.abort();
      ab.destroy();
      ba.destroy();
      await Promise.allSettled(operations);
    }
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: readable bundle sources failing or cancelling while queued release their admission without staging
 * 协作入口 / Collaborators: `hostRuntime.acquire.bind`, `t.mock.method`, `storageRuntime.acquire`, `source.write`.
 * 检查边界 / Checked boundaries: `assert.rejects(task, /queued transport failed/)`; `assert.ok( hostRuntime .snapshot() .resources.some((item) => item.owner === 'core:bundle-import' && item.state === 'queued'), )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test(
  'readable bundle sources failing or cancelling while queued release their admission without staging',
  { timeout: 5000 },
  async (t) => {
    const acquire = hostRuntime.acquire.bind(hostRuntime);
    let queued!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    t.mock.method(hostRuntime, 'acquire', (request: Parameters<typeof acquire>[0]) =>
      acquire(request.owner === 'core:bundle-import' ? { ...request, /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`queued()`）。
       * Result: Return the branch-computed value (`queued()`).
       * 验证场景 / Scenario: readable bundle sources failing or cancelling while queued release their admission without staging
       * 协作入口 / Collaborators: `queued`.
       */
      onQueued: () => queued() } : request),
    );
    const bundles = new Bundles({
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: readable bundle sources failing or cancelling while queued release their admission without staging
       * 失败 / Failure: `new Error('must not adopt')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      adopt: () => {
        throw new Error('must not adopt');
      },
    } as unknown as Machines);
    for (const mode of ['error', 'abort']) {
      const blocker = await storageRuntime.acquire({
        owner: 'test:bundle-blocker',
        taskId: 'bundle-blocker',
        label: 'Hold destination writer',
        mode: 'write',
        paths: [root],
        buffers: 1,
        files: 1,
      });
      const source = new PassThrough(),
        controller = new AbortController();
      const waiting = new Promise<void>((done) => {
        queued = done;
      });
      source.write('SAKURA01');
      const task = bundles.import('queued', source, controller.signal);
      const rejected = assert.rejects(task, /queued transport failed/);
      try {
        await waiting;
        assert.ok(
          hostRuntime
            .snapshot()
            .resources.some((item) => item.owner === 'core:bundle-import' && item.state === 'queued'),
        );
        const reason = new Error('queued transport failed');
        if (mode === 'error') source.destroy(reason);
        else controller.abort(reason);
        await rejected;
        assert.equal(source.destroyed, true);
        assert.equal(
          hostRuntime.snapshot().resources.filter((item) => item.owner === 'core:bundle-import').length,
          0,
        );
        const directories = await import('node:fs/promises');
        assert.deepEqual(await directories.readdir(join(root, 'transfers')), []);
      } finally {
        controller.abort();
        source.destroy();
        await task.catch(() => {});
        blocker.release();
      }
    }
  },
);
