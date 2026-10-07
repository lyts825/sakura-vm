/**
 * 模块职责：回归验证模块，围绕 `sandbox-artifacts` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `sandbox-artifacts`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: binary artifacts survive VM destruction, verify checksums and expire with their execution record; artifact capture rejects symlink escapes and oversize files before reading or publishing.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { JobView } from '../server/jobs.ts';
import type { Machines } from '../server/machines.ts';
import { SandboxArtifacts } from '../server/sandbox-artifacts.ts';
import type { SandboxArtifact } from '../shared/sandbox.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: binary artifacts survive VM destruction, verify checksums and expire with their execution record
 * 状态影响 / State effects: `live`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(Buffer.from(result.base64, 'base64'), data)`; `assert.rejects(store.download(job, '../outside'))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('binary artifacts survive VM destruction, verify checksums and expire with their execution record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-artifacts-test-'));
  const run = randomUUID(),
    data = Buffer.from([0, 1, 255, 128, 10, 0]);
  let live = true;
  const machines = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; work: (ftp: unknown) => Promise<unknown>。
     * 结果：返回分支计算值（`work({ realpath: (path: string, callback: Function) => callback(null, path), lst…`），以 Promise 交付。
     * Result: Return the branch-computed value (`work({ realpath: (path: string, callback: Function) => callback(null, path), lst…`) through a Promise.
     * 验证场景 / Scenario: binary artifacts survive VM destruction, verify checksums and expire with their execution record
     * 协作入口 / Collaborators: `assert.equal`, `work`.
     * 检查边界 / Checked boundaries: `assert.equal(live, true)`.
     */
    sftp: async (_id: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: ftp: unknown。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (ftp: unknown) => Promise<unknown>) => {
      assert.equal(live, true);
      return work({
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: path: string; callback: Function。
         * 结果：返回分支计算值（`callback(null, path)`）。
         * Result: Return the branch-computed value (`callback(null, path)`).
         * 验证场景 / Scenario: binary artifacts survive VM destruction, verify checksums and expire with their execution record
         * 协作入口 / Collaborators: `callback`.
         */
        realpath: (path: string, callback: Function) => callback(null, path),
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: _path: string; callback: Function。
         * 结果：返回分支计算值（`callback(null, { size: data.length, isFile: () => true })`）。
         * Result: Return the branch-computed value (`callback(null, { size: data.length, isFile: () => true })`).
         * 验证场景 / Scenario: binary artifacts survive VM destruction, verify checksums and expire with their execution record
         * 协作入口 / Collaborators: `callback`.
         */
        lstat: (_path: string, callback: Function) =>
          callback(null, { size: data.length, /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：返回布尔判定，供用例选择路径或核对受控条件。
           * Result: Return a boolean decision for path selection or controlled-condition assertions.
           * 验证场景 / Scenario: binary artifacts survive VM destruction, verify checksums and expire with their execution record
           */
          isFile: () => true }),
        /**
         * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
         * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`Readable.from([data])`）。
         * Result: Return the branch-computed value (`Readable.from([data])`).
         * 验证场景 / Scenario: binary artifacts survive VM destruction, verify checksums and expire with their execution record
         * 协作入口 / Collaborators: `Readable.from`.
         */
        createReadStream: () => Readable.from([data]),
      });
    },
  } as unknown as Machines;
  const store = new SandboxArtifacts(machines, directory),
    artifacts: SandboxArtifact[] = [];
  try {
    await store.collect(
      'guest',
      run,
      '/workspace',
      ['output.bin'],
      (item) => artifacts.push(item),
      new AbortController().signal,
    );
    const job = { id: run, status: 'done', execution: { artifacts } } as JobView;
    live = false;
    const result = await store.download(job, artifacts[0].id);
    assert.deepEqual(Buffer.from(result.base64, 'base64'), data);
    await assert.rejects(store.download(job, '../outside'));
    await assert.rejects(store.download(undefined, artifacts[0].id), /记录不存在/);
    const pending = join(directory, `${run}.${randomUUID()}.bin.part`);
    const orphan = join(directory, `${run}.${randomUUID()}.bin`);
    await writeFile(pending, 'interrupted write');
    await writeFile(orphan, 'uncommitted artifact');
    await store.prune([{ ...job, status: 'running' }]);
    assert.equal((await readdir(directory)).length, 3);
    await store.prune([job]);
    assert.equal((await readdir(directory)).length, 1);
    await writeFile(join(directory, `${run}.${artifacts[0].id}.bin`), 'tampered');
    await assert.rejects(store.download(job, artifacts[0].id), /校验失败/);
    await store.prune([]);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-artifacts-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: artifact capture rejects symlink escapes and oversize files before reading or publishing
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects( new SandboxArtifacts(machines, directory).collect( 'vm', randomUUID(), '/workspace', ['output'], () => assert.fail…`; `assert.equal(reads, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('artifact capture rejects symlink escapes and oversize files before reading or publishing', async () => {
  for (const scenario of ['escape', 'size']) {
    let reads = 0;
    const directory = await mkdtemp(join(tmpdir(), 'sakura-artifacts-test-'));
    const machines = {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; work: (ftp: unknown) => Promise<unknown>。
       * 结果：返回分支计算值（`work({ realpath: (path: string, callback: Function) => callback(null, path === '…`），以 Promise 交付。
       * Result: Return the branch-computed value (`work({ realpath: (path: string, callback: Function) => callback(null, path === '…`) through a Promise.
       * 验证场景 / Scenario: artifact capture rejects symlink escapes and oversize files before reading or publishing
       * 协作入口 / Collaborators: `work`.
       */
      sftp: async (_id: string, work: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: ftp: unknown。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (ftp: unknown) => Promise<unknown>) =>
        work({
          /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: path: string; callback: Function。
           * 结果：返回分支计算值（`callback(null, path === '/workspace' || scenario === 'size' ? path : '/etc/shado…`）。
           * Result: Return the branch-computed value (`callback(null, path === '/workspace' || scenario === 'size' ? path : '/etc/shado…`).
           * 验证场景 / Scenario: artifact capture rejects symlink escapes and oversize files before reading or publishing
           * 协作入口 / Collaborators: `callback`.
           */
          realpath: (path: string, callback: Function) =>
            callback(null, path === '/workspace' || scenario === 'size' ? path : '/etc/shadow'),
          /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: _path: string; callback: Function。
           * 结果：返回分支计算值（`callback(null, { size: 9 * 1024 * 1024, isFile: () => true })`）。
           * Result: Return the branch-computed value (`callback(null, { size: 9 * 1024 * 1024, isFile: () => true })`).
           * 验证场景 / Scenario: artifact capture rejects symlink escapes and oversize files before reading or publishing
           * 协作入口 / Collaborators: `callback`.
           */
          lstat: (_path: string, callback: Function) =>
            callback(null, { size: 9 * 1024 * 1024, /**
             * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
             * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
             * 输入 / Inputs: 无 / none。
             * 结果：返回布尔判定，供用例选择路径或核对受控条件。
             * Result: Return a boolean decision for path selection or controlled-condition assertions.
             * 验证场景 / Scenario: artifact capture rejects symlink escapes and oversize files before reading or publishing
             */
            isFile: () => true }),
          /**
           * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
           * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
           * 输入 / Inputs: 无 / none。
           * 结果：返回分支计算值（`Readable.from([])`）。
           * Result: Return the branch-computed value (`Readable.from([])`).
           * 验证场景 / Scenario: artifact capture rejects symlink escapes and oversize files before reading or publishing
           * 协作入口 / Collaborators: `Readable.from`.
           */
          createReadStream: () => {
            reads++;
            return Readable.from([]);
          },
        }),
    } as unknown as Machines;
    try {
      await assert.rejects(
        new SandboxArtifacts(machines, directory).collect(
          'vm',
          randomUUID(),
          '/workspace',
          ['output'],
          () => assert.fail('must not publish'),
          new AbortController().signal,
        ),
        scenario === 'escape' ? /工作目录之外/ : /8 MiB/,
      );
      assert.equal(reads, 0);
      assert.deepEqual(await readdir(directory), []);
    } finally {
      assert.equal(dirname(directory), resolve(tmpdir()));
      assert.ok(basename(directory).startsWith('sakura-artifacts-test-'));
      await rm(directory, { recursive: true, force: true });
    }
  }
});
