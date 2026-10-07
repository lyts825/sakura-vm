/**
 * 模块职责：回归验证模块，围绕 `signed-bundles` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `signed-bundles`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: strict policy signs exports, trusts local signer, rejects unsigned and tampered external packages before adoption; foreign signer requires explicit trust; policy survives restart and rejects stale edits or corrupt trust records.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-signed-bundles-'));
process.env.SAKURA_DATA_DIR = root;
const { Bundles } = await import('../server/bundles.ts');
const { SignedBundles } = await import('../server/signed-bundles.ts');
const { createSchema } = await import('../server/model.ts');
const { createSshKey, seedIso } = await import('../server/seed.ts');
const { encryptFile, importEncrypted } = await import('../server/encrypted-backups.ts');
after(() => rm(root, { recursive: true, force: true }));

const disk = Buffer.alloc(104);
disk.writeUInt32BE(0x514649fb);
disk.writeUInt32BE(3, 4);
disk.writeBigUInt64BE(8n * 1024n ** 3n, 24);
const identity = createSshKey();
const seed = seedIso({ 'user-data': 'signed-bundles' });
const sourceId = randomUUID();
let adopted = 0;
const machines = {
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _id: string; work: () => Promise<unknown>。
   * 结果：返回分支计算值（`work()`），以 Promise 交付。
   * Result: Return the branch-computed value (`work()`) through a Promise.
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
   */
  requireStopped: () => {},
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ ...createSchema.parse({ name: 'source' }), snapshots: [] })`）。
   * Result: Return the branch-computed value (`({ ...createSchema.parse({ name: 'source' }), snapshots: [] })`).
   * 协作入口 / Collaborators: `createSchema.parse`.
   */
  get: () => ({ ...createSchema.parse({ name: 'source' }), snapshots: [] }),
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ key: identity.privateText, seed })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ key: identity.privateText, seed })`) through a Promise.
   */
  snapshotIdentity: async () => ({ key: identity.privateText, seed }),
  engine: {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]。
     * 结果：返回分支计算值（`JSON.stringify({ required: disk.length }) / '{}'`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.stringify({ required: disk.length }) / '{}'`) through a Promise.
     * 协作入口 / Collaborators: `JSON.stringify`, `writeFile`, `args.at`.
     */
    run: async (_tool: string, args: string[]) => {
      if (args[0] === 'measure') return JSON.stringify({ required: disk.length });
      if (args[0] === 'convert') await writeFile(args.at(-1)!, disk);
      return '{}';
    },
  },
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id: 'adopted-' + ++adopted })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ id: 'adopted-' + ++adopted })`) through a Promise.
   */
  adopt: async () => ({ id: 'adopted-' + ++adopted }),
} as unknown as Machines;

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: bundles: InstanceType<typeof Bundles>。
 * 结果：返回分支计算值（`Buffer.concat(chunks)`），以 Promise 交付。
 * Result: Return the branch-computed value (`Buffer.concat(chunks)`) through a Promise.
 * 协作入口 / Collaborators: `bundles.export`, `Buffer.concat`.
 */
async function exported(bundles: InstanceType<typeof Bundles>) {
  const chunks: Buffer[] = [];
  await bundles.export(
    sourceId,
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _enc; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `chunks.push`, `Buffer.from`, `callback`.
       */
      write(chunk, _enc, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }),
    () => {},
  );
  return Buffer.concat(chunks);
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: value: Buffer。
 * 结果：返回受控对象，公开字段包括 `manifest, disk`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `manifest, disk`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `assert.equal`, `value.subarray(0, 8).toString`, `value.subarray`, `value.readUInt32BE`.
 * 检查边界 / Checked boundaries: `assert.equal(value.subarray(0, 8).toString(), 'SAKURA01')`.
 */
function parts(value: Buffer) {
  assert.equal(value.subarray(0, 8).toString(), 'SAKURA01');
  const length = value.readUInt32BE(8);
  return {
    manifest: JSON.parse(value.subarray(12, 12 + length).toString('utf8')),
    disk: value.subarray(12 + length),
  };
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: manifest: unknown; data: Buffer。
 * 结果：返回分支计算值（`Buffer.concat([header, json, data])`）。
 * Result: Return the branch-computed value (`Buffer.concat([header, json, data])`).
 * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `Buffer.alloc`, `header.write`.
 */
function repack(manifest: unknown, data: Buffer) {
  const json = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(12);
  header.write('SAKURA01');
  header.writeUInt32BE(json.length, 8);
  return Buffer.concat([header, json, data]);
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: strict policy signs exports, trusts local signer, rejects unsigned and tampered external packages before adoption
 * 状态影响 / State effects: `changedDisk[100]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `policy.init`, `exported`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(parts(legacy).manifest.signature, undefined)`; `assert.equal(view.trustedKeys[0].fingerprint, view.localKey?.fingerprint)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('strict policy signs exports, trusts local signer, rejects unsigned and tampered external packages before adoption', async () => {
  const policy = new SignedBundles(join(root, 'policy.json'));
  await policy.init();
  const bundles = new Bundles(machines, policy);
  const legacy = await exported(bundles);
  assert.equal(parts(legacy).manifest.signature, undefined);
  await bundles.importExternal('old-allowed', Readable.from([legacy]));
  const before = adopted;
  await policy.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const view = policy.view();
  assert.equal(view.trustedKeys[0].fingerprint, view.localKey?.fingerprint);
  assert.equal(JSON.stringify(view).includes('PRIVATE KEY'), false);
  const signed = await exported(bundles);
  assert.equal(parts(signed).manifest.signature.algorithm, 'Ed25519');
  assert.equal(parts(signed).manifest.signature.publicKey.includes('PRIVATE KEY'), false);
  await assert.rejects(bundles.importExternal('old-rejected', Readable.from([legacy])), /受信任签名/);
  assert.equal(adopted, before);
  await bundles.import('local-legacy-backup', Readable.from([legacy]));
  await bundles.importExternal('signed-accepted', Readable.from([signed]));
  const { manifest, disk: content } = parts(signed);
  await assert.rejects(
    bundles.importExternal(
      'changed-manifest',
      Readable.from([repack({ ...manifest, config: { ...manifest.config, name: 'forged' } }, content)]),
    ),
    /签名无效/,
  );
  const changedDisk = Buffer.from(content);
  changedDisk[100] ^= 1;
  await assert.rejects(
    bundles.importExternal('changed-disk', Readable.from([repack(manifest, changedDisk)])),
    /磁盘校验失败/,
  );
  assert.equal(adopted, before + 2);
  await policy.action({ action: 'configure', revision: 1, requireTrustedOnImport: false });
  await assert.rejects(
    bundles.importExternal(
      'bad-signature-even-when-off',
      Readable.from([repack({ ...manifest, config: { ...manifest.config, name: 'forged' } }, content)]),
    ),
    /签名无效/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: foreign signer requires explicit trust; policy survives restart and rejects stale edits or corrupt trust records
 * 状态影响 / State effects: `state.trustedKeys[0].fingerprint`, `state.trustedKeys`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `join`, `local.init`, `foreign.init`, `local.action`.
 * 检查边界 / Checked boundaries: `assert.rejects(bundles.importExternal('foreign-rejected', Readable.from([signed])), /不受信任/)`; `assert.equal(adopted, before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('foreign signer requires explicit trust; policy survives restart and rejects stale edits or corrupt trust records', async () => {
  const local = new SignedBundles(join(root, 'local-policy.json'));
  const foreign = new SignedBundles(join(root, 'foreign-policy.json'));
  await local.init();
  await foreign.init();
  await local.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  await foreign.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const signed = await exported(new Bundles(machines, foreign));
  const bundles = new Bundles(machines, local);
  const before = adopted;
  await assert.rejects(bundles.importExternal('foreign-rejected', Readable.from([signed])), /不受信任/);
  assert.equal(adopted, before);
  const publicKey = foreign.view().localKey!.publicKey;
  await local.action({ action: 'trust', revision: 1, name: 'other host', publicKey });
  await assert.rejects(
    local.action({ action: 'configure', revision: 1, requireTrustedOnImport: false }),
    /已变化/,
  );
  await bundles.importExternal('foreign-accepted', Readable.from([signed]));
  const restored = new SignedBundles(join(root, 'local-policy.json'));
  await restored.init();
  assert.equal(restored.view().requireTrustedOnImport, true);
  assert.equal(restored.view().trustedKeys.length, 2);
  const foreignKey = restored.view().trustedKeys.find((item) => item.name === 'other host')!;
  await restored.action({ action: 'forget', revision: 2, fingerprint: foreignKey.fingerprint });
  await assert.rejects(
    new Bundles(machines, restored).importExternal('foreign-removed', Readable.from([signed])),
    /不受信任/,
  );
  await assert.rejects(
    restored.action({ action: 'forget', revision: 3, fingerprint: restored.view().localKey!.fingerprint }),
    /本机公钥/,
  );
  const state = JSON.parse(await readFile(join(root, 'local-policy.json'), 'utf8'));
  state.trustedKeys[0].fingerprint = '0'.repeat(64);
  await writeFile(join(root, 'local-policy.json'), JSON.stringify(state));
  await assert.rejects(new SignedBundles(join(root, 'local-policy.json')).init(), /记录损坏/);
  state.trustedKeys = [];
  await writeFile(join(root, 'local-policy.json'), JSON.stringify(state));
  await assert.rejects(new SignedBundles(join(root, 'local-policy.json')).init(), /本机密钥/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: encrypted external upload enforces signed policy after authenticated decryption
 * 协作入口 / Collaborators: `join`, `policy.init`, `exported`, `policy.action`.
 * 检查边界 / Checked boundaries: `assert.rejects( importEncrypted( bundles, 'encrypted-legacy', Readable.from([await readFile(encrypted)]), password, new AbortContr…`; `assert.equal(adopted, before)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('encrypted external upload enforces signed policy after authenticated decryption', async () => {
  const policy = new SignedBundles(join(root, 'encrypted-policy.json'));
  await policy.init();
  const bundles = new Bundles(machines, policy);
  const legacy = await exported(bundles);
  await policy.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const signed = await exported(bundles);
  const password = 'correct-bundle-password';
  const plain = join(root, 'plain.sakura');
  const encrypted = join(root, 'encrypted.sakura.enc');
  await writeFile(plain, legacy);
  await encryptFile(plain, encrypted, password);
  const before = adopted;
  await assert.rejects(
    importEncrypted(
      bundles,
      'encrypted-legacy',
      Readable.from([await readFile(encrypted)]),
      password,
      new AbortController().signal,
    ),
    /受信任签名/,
  );
  assert.equal(adopted, before);
  await writeFile(plain, signed);
  await rm(encrypted);
  await encryptFile(plain, encrypted, password);
  await importEncrypted(
    bundles,
    'encrypted-signed',
    Readable.from([await readFile(encrypted)]),
    password,
    new AbortController().signal,
  );
  assert.equal(adopted, before + 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: policy edits wait for an authorized publication to finish
 * 协作入口 / Collaborators: `join`, `policy.init`, `policy.action`, `parts`.
 * 检查边界 / Checked boundaries: `assert.equal(changed, false)`; `assert.equal(policy.view().requireTrustedOnImport, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('policy edits wait for an authorized publication to finish', async () => {
  const policy = new SignedBundles(join(root, 'serialized-policy.json'));
  await policy.init();
  await policy.action({ action: 'configure', revision: 0, requireTrustedOnImport: true });
  const signature = parts(await exported(new Bundles(machines, policy))).manifest.signature;
  let finish!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finishPromise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const publishing = policy.withAuthorizedExternal(signature, async () => {
    started();
    await finishPromise;
  });
  await startedPromise;
  let changed = false;
  const edit = policy.action({ action: 'configure', revision: 1, requireTrustedOnImport: false }).then(() => {
    changed = true;
  });
  await Promise.resolve();
  assert.equal(changed, false);
  assert.equal(policy.view().requireTrustedOnImport, true);
  finish();
  await Promise.all([publishing, edit]);
  assert.equal(policy.view().requireTrustedOnImport, false);
});
