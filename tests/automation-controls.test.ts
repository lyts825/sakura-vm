/**
 * 模块职责：回归验证模块，围绕 `automation-controls` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `automation-controls`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: weekly windows handle overnight day boundaries, timezones and repeated DST hours; byte budgets constrain real stream throughput and cancel waiting transfers promptly.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withinWindow } from '../shared/time-windows.ts';
import { ByteRate } from '../server/byte-rate.ts';
import type { Engine } from '../server/runtime.ts';
import type { Bundles } from '../server/bundles.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-automation-controls-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { Backups, backupLocked } = await import('../server/backups.ts');
const { saveMaintenancePolicy, inMaintenance, timeWindowSchema } =
  await import('../server/automation-policy.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-automation-controls-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: weekly windows handle overnight day boundaries, timezones and repeated DST hours
 * 协作入口 / Collaborators: `assert.equal`, `withinWindow`, `Date.parse`, `timeWindowSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(withinWindow(overnight, Date.parse('2026-09-28T14:00:00Z')), true)`; `assert.equal(withinWindow(overnight, Date.parse('2026-09-28T17:59:00Z')), true)`.
 */
test('weekly windows handle overnight day boundaries, timezones and repeated DST hours', () => {
  const overnight = { days: [1], start: '22:00', end: '02:00', timeZone: 'Asia/Shanghai' };
  assert.equal(withinWindow(overnight, Date.parse('2026-09-28T14:00:00Z')), true);
  assert.equal(withinWindow(overnight, Date.parse('2026-09-28T17:59:00Z')), true);
  assert.equal(withinWindow(overnight, Date.parse('2026-09-28T18:00:00Z')), false);
  assert.equal(withinWindow(overnight, Date.parse('2026-09-27T17:00:00Z')), false);
  const dst = { days: [0], start: '01:00', end: '02:00', timeZone: 'America/New_York' };
  for (const at of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'])
    assert.equal(withinWindow(dst, Date.parse(at)), true);
  assert.equal(
    withinWindow({ ...overnight, start: '00:00', end: '00:00' }, Date.parse('2026-09-28T05:00:00Z')),
    true,
  );
  assert.equal(timeWindowSchema.safeParse({ ...overnight, days: [1, 1] }).success, false);
  assert.equal(timeWindowSchema.safeParse({ ...overnight, timeZone: 'not-a-zone' }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: byte budgets constrain real stream throughput and cancel waiting transfers promptly
 * 协作入口 / Collaborators: `performance.now`, `pipeline`, `Readable.from`, `Buffer.alloc`.
 * 检查边界 / Checked boundaries: `assert.equal(Buffer.concat(chunks).length, 512)`; `assert.ok(performance.now() - start >= 225, '512 bytes must consume at least their transmission budget')`.
 */
test('byte budgets constrain real stream throughput and cancel waiting transfers promptly', async () => {
  const rate = new ByteRate(2048),
    chunks: Buffer[] = [];
  const start = performance.now();
  await pipeline(
    Readable.from([Buffer.alloc(256), Buffer.alloc(256)]),
    rate.stream(new AbortController().signal),
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk; _encoding; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: byte budgets constrain real stream throughput and cancel waiting transfers promptly
       * 协作入口 / Collaborators: `chunks.push`, `callback`.
       */
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  assert.equal(Buffer.concat(chunks).length, 512);
  assert.ok(performance.now() - start >= 225, '512 bytes must consume at least their transmission budget');
  const controller = new AbortController();
  const interrupted = pipeline(
    Readable.from([Buffer.alloc(1024)]),
    new ByteRate(1).stream(controller.signal),
    new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: _chunk; _encoding; callback。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: byte budgets constrain real stream throughput and cancel waiting transfers promptly
       * 协作入口 / Collaborators: `callback`.
       */
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(interrupted, /abort/i);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: backup retention survives policy changes and restart, protects pruning, and expires
 * 状态影响 / State effects: `machines.get`, `saved.items[0].retainUntil`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `Buffer.from`, `JSON.stringify`, `createHash('sha256').update(payload).digest`.
 * 检查边界 / Checked boundaries: `assert.equal(backups.jobs.view(id)?.status, 'done')`; `assert.equal(locked.length, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('backup retention survives policy changes and restart, protects pruning, and expires', async (t) => {
  const id = randomUUID(),
    machines = new Machines({} as Engine, fakeVmNetwork);
  machines.get = /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id, name: 'backup-lock' }) as ReturnType<typeof machines.get>`）。
   * Result: Return the branch-computed value (`({ id, name: 'backup-lock' }) as ReturnType<typeof machines.get>`).
   * 验证场景 / Scenario: backup retention survives policy changes and restart, protects pruning, and expires
   */
  () => ({ id, name: 'backup-lock' }) as ReturnType<typeof machines.get>;
  const payload = Buffer.from('actual backup payload'),
    manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(payload).digest('hex') }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(manifest.length);
  const bytes = Buffer.concat([Buffer.from('SAKURA01'), length, manifest, payload]);
  const bundles = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: _id: string; _signal: AbortSignal; work: any。
     * 结果：返回分支计算值（`work(payload.length, (output: Writable) => pipeline(Readable.from([bytes]), outp…`），以 Promise 交付。
     * Result: Return the branch-computed value (`work(payload.length, (output: Writable) => pipeline(Readable.from([bytes]), outp…`) through a Promise.
     * 验证场景 / Scenario: backup retention survives policy changes and restart, protects pruning, and expires
     * 协作入口 / Collaborators: `work`.
     */
    withExportBudget: async (_id: string, _signal: AbortSignal, work: any) =>
      work(payload.length, (output: Writable) => pipeline(Readable.from([bytes]), output)),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; output: Writable。
     * 结果：返回分支计算值（`pipeline(Readable.from([bytes]), output)`），以 Promise 交付。
     * Result: Return the branch-computed value (`pipeline(Readable.from([bytes]), output)`) through a Promise.
     * 验证场景 / Scenario: backup retention survives policy changes and restart, protects pruning, and expires
     * 协作入口 / Collaborators: `pipeline`, `Readable.from`.
     */
    export: async (_id: string, output: Writable) => pipeline(Readable.from([bytes]), output),
  } as unknown as Bundles;
  const backups = new Backups(machines, bundles);
  t.after(() => backups.close());
  await backups.policy(id, { keep: 1, lockDays: 2 });
  for (let index = 0; index < 2; index++) {
    await backups.run(id);
    await backups.jobs.wait(id);
    assert.equal(backups.jobs.view(id)?.status, 'done');
  }
  const locked = (await backups.view(id)).items;
  assert.equal(locked.length, 2);
  assert.equal(backupLocked(locked[0]), true);
  await backups.policy(id, { keep: 1, lockDays: 0 });
  await backups.close();
  const reopened = new Backups(machines, bundles);
  t.after(() => reopened.close());
  await assert.rejects(reopened.operate(id, locked[0].id, 'delete'), { code: 'BACKUP_LOCKED' });
  assert.equal((await reopened.view(id)).items[0].retainUntil, locked[0].retainUntil);
  const file = join(root, 'backups', id, 'index.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  saved.items[0].retainUntil = new Date(Date.now() - 1000).toISOString();
  await writeFile(file, JSON.stringify(saved));
  await reopened.operate(id, locked[0].id, 'delete');
  assert.equal((await reopened.view(id)).items.length, 1);
  assert.equal(backupLocked({ retainUntil: 'corrupt-date' }), true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: maintenance policy is persisted and actually blocks scheduled backups
 * 状态影响 / State effects: `backups.run`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `machines.records.set`, `t.after`, `backups.policy`.
 * 检查边界 / Checked boundaries: `assert.equal(await inMaintenance(id, now), true)`; `assert.equal(calls, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('maintenance policy is persisted and actually blocks scheduled backups', async (t) => {
  const id = randomUUID(),
    machines = new Machines({} as Engine, fakeVmNetwork);
  machines.records.set(id, { id } as any);
  const backups = new Backups(machines, {} as Bundles);
  t.after(() => backups.close());
  let calls = 0;
  backups.run = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`{} as any`），以 Promise 交付。
   * Result: Return the branch-computed value (`{} as any`) through a Promise.
   * 验证场景 / Scenario: maintenance policy is persisted and actually blocks scheduled backups
   */
  async () => {
    calls++;
    return {} as any;
  };
  await backups.policy(id, { enabled: true });
  const now = Date.parse('2026-09-28T09:30:00Z');
  await saveMaintenancePolicy(id, {
    enabled: true,
    windows: [{ days: [1], start: '09:00', end: '10:00', timeZone: 'UTC' }],
  });
  assert.equal(await inMaintenance(id, now), true);
  await backups.tick(now);
  assert.equal(calls, 0);
  await backups.tick(now + 3600000);
  assert.equal(calls, 1);
});
