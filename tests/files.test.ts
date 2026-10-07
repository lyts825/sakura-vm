/**
 * 模块职责：回归验证模块，围绕 `files` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `files`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: optimistic editing rejects stale saves without altering the remote file; editing detects external changes made while the replacement is uploading.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import type { SFTPWrapper } from 'ssh2';
import { Machines } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';
import { Files, textVersion } from '../server/files.ts';

const path = '/workspace/notes.txt';
const original = Buffer.from('原始内容\n');

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: optimistic editing rejects stale saves without altering the remote file
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `machines.writeGuestFile`, `textVersion`.
 * 检查边界 / Checked boundaries: `assert.rejects( machines.writeGuestFile('vm', path, 'replacement', true, textVersion('outdated')), /其他程序修改/, )`; `assert.deepEqual(files.get(path), original)`.
 */
test('optimistic editing rejects stale saves without altering the remote file', async () => {
  const { machines, files } = fixture();
  await assert.rejects(
    machines.writeGuestFile('vm', path, 'replacement', true, textVersion('outdated')),
    /其他程序修改/,
  );
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
  await machines.writeGuestFile('vm', path, 'replacement', true, textVersion(original.toString()));
  assert.equal(files.get(path)?.toString(), 'replacement');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: editing detects external changes made while the replacement is uploading
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `machines.writeGuestFile`, `textVersion`.
 * 检查边界 / Checked boundaries: `assert.rejects( machines.writeGuestFile('vm', path, 'replacement', true, textVersion(original.toString())), /其他程序修改/, )`; `assert.equal(files.get(path)?.toString(), 'external edit')`.
 */
test('editing detects external changes made while the replacement is uploading', async () => {
  const { machines, files } = fixture({ /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`files.set(path, Buffer.from('external edit'))`）。
   * Result: Return the branch-computed value (`files.set(path, Buffer.from('external edit'))`).
   * 验证场景 / Scenario: editing detects external changes made while the replacement is uploading
   * 协作入口 / Collaborators: `files.set`, `Buffer.from`.
   */
  onWrite: () => files.set(path, Buffer.from('external edit')) });
  await assert.rejects(
    machines.writeGuestFile('vm', path, 'replacement', true, textVersion(original.toString())),
    /其他程序修改/,
  );
  assert.equal(files.get(path)?.toString(), 'external edit');
  assert.equal(files.size, 1);
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: options: { failWrite?: boolean; failClose?: boolean; failMetadata?: boolea… = {}。
 * 结果：返回受控对象，公开字段包括 `machines, files, modes, owners`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, files, modes, owners`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.sftp`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 */
function fixture(
  options: {
    failWrite?: boolean;
    failClose?: boolean;
    failMetadata?: boolean;
    failRename?: boolean;
    collide?: boolean;
    onWrite?: /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
  } = {},
) {
  const files = new Map<string, Buffer>([[path, original]]);
  const modes = new Map<string, number>([[path, 0o100660]]);
  const owners = new Map([[path, { uid: 1000, gid: 1000 }]]);
  let connected = true;
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`Object.assign(new Error('No such file'), { code: 2 })`）。
   * Result: Return the branch-computed value (`Object.assign(new Error('No such file'), { code: 2 })`).
   * 协作入口 / Collaborators: `Object.assign`.
   */
  const missing = () => Object.assign(new Error('No such file'), { code: 2 });
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: from: string; to: string; replace: boolean; cb: (error?: Error) => void。
   * 结果：返回分支计算值（`cb(new Error('rename failed')) / cb(new Error('target exists'))`）。
   * Result: Return the branch-computed value (`cb(new Error('rename failed')) / cb(new Error('target exists'))`).
   * 协作入口 / Collaborators: `files.set`, `cb`, `files.has`, `missing`.
   */
  const rename = (from: string, to: string, replace: boolean, cb: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: error: Error。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (error?: Error) => void) => {
    if (options.collide) files.set(to, original);
    if (options.failRename) return cb(new Error('rename failed'));
    if (!replace && files.has(to)) return cb(new Error('target exists'));
    if (!files.has(from)) return cb(missing());
    files.set(to, files.get(from)!);
    modes.set(to, modes.get(from)!);
    owners.set(to, owners.get(from)!);
    files.delete(from);
    modes.delete(from);
    owners.delete(from);
    cb();
  };
  const ftp = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: target: string; cb: (error: Error | undefined, attrs?: unknown) => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `files.get`, `cb`, `missing`, `modes.get`.
     */
    lstat(target: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error | undefined; attrs: unknown。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error: Error | undefined, attrs?: unknown) => void) {
      const bytes = files.get(target);
      cb(bytes ? undefined : missing(), {
        size: bytes?.length,
        mode: modes.get(target),
        ...owners.get(target),
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回布尔判定，供用例选择路径或核对受控条件。
         * Result: Return a boolean decision for path selection or controlled-condition assertions.
         */
        isFile: () => true,
      });
    },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: target: string; settings: { flags?: string; mode?: number }。
     * 结果：返回分支计算值（`new Writable({ autoDestroy: false, emitClose: false, write(chunk: Buffer, _encod…`）。
     * Result: Return the branch-computed value (`new Writable({ autoDestroy: false, emitClose: false, write(chunk: Buffer, _encod…`).
     * 协作入口 / Collaborators: `assert.equal`, `files.has`, `files.set`, `Buffer.alloc`.
     * 检查边界 / Checked boundaries: `assert.equal(files.has(target), false)`.
     */
    createWriteStream(target: string, settings?: { flags?: string; mode?: number }) {
      if (settings?.flags === 'wx') assert.equal(files.has(target), false);
      files.set(target, Buffer.alloc(0));
      modes.set(target, (settings?.mode ?? modes.get(target) ?? 0o100644) & ~0o022);
      owners.set(target, { uid: 0, gid: 0 });
      return new Writable({
        autoDestroy: false,
        emitClose: false,
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: chunk: Buffer; _encoding; cb。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `files.set`, `Buffer.concat`, `files.get`, `options.onWrite`.
         */
        write(chunk: Buffer, _encoding, cb) {
          files.set(target, Buffer.concat([files.get(target)!, chunk]));
          options.onWrite?.();
          cb(options.failWrite ? new Error('connection lost during write') : undefined);
        },
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: cb。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `this.destroy`, `cb`.
         */
        final(cb) {
          this.destroy();
          cb();
        },
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: error; cb。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `setImmediate`.
         */
        destroy(error, cb) {
          setImmediate(() => {
            const failure = error || (options.failClose ? new Error('write handle close failed') : null);
            cb(failure);
            if (!failure) this.emit('close');
          });
        },
      });
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: target: string; uid: number; gid: number; cb: (error?: Error) => void。
     * 结果：返回分支计算值（`cb(new Error('metadata update failed'))`）。
     * Result: Return the branch-computed value (`cb(new Error('metadata update failed'))`).
     * 协作入口 / Collaborators: `cb`, `owners.set`.
     */
    chown(target: string, uid: number, gid: number, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error?: Error) => void) {
      if (options.failMetadata) return cb(new Error('metadata update failed'));
      owners.set(target, { uid, gid });
      cb();
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: target: string; mode: number; cb: () => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `modes.set`, `cb`.
     */
    chmod(target: string, mode: number, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) {
      modes.set(target, 0o100000 | mode);
      cb();
    },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: target: string。
     * 结果：返回分支计算值（`Readable.from([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)])`）。
     * Result: Return the branch-computed value (`Readable.from([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)])`).
     * 协作入口 / Collaborators: `files.get`, `Readable.from`, `bytes.subarray`.
     */
    createReadStream(target: string) {
      const bytes = files.get(target)!;
      // Include boundaries inside a UTF-8 character and before an incomplete suffix.
      return Readable.from([bytes.subarray(0, 1), bytes.subarray(1, 4), bytes.subarray(4)]);
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: from: string; to: string; cb: (error?: Error) => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `rename`.
     */
    rename(from: string, to: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error?: Error) => void) {
      rename(from, to, false, cb);
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: from: string; to: string; cb: (error?: Error) => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `rename`.
     */
    ext_openssh_rename(from: string, to: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error?: Error) => void) {
      rename(from, to, true, cb);
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: target: string; cb: (error?: Error) => void。
     * 结果：返回分支计算值（`cb(new Error('SFTP connection closed'))`）。
     * Result: Return the branch-computed value (`cb(new Error('SFTP connection closed'))`).
     * 协作入口 / Collaborators: `cb`, `files.delete`, `modes.delete`, `owners.delete`.
     */
    unlink(target: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error?: Error) => void) {
      if (!connected) return cb(new Error('SFTP connection closed'));
      files.delete(target);
      modes.delete(target);
      owners.delete(target);
      cb();
    },
  } as unknown as SFTPWrapper;
  const machines = new Machines({} as Engine, fakeVmNetwork);
  machines.sftp = /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: _id; work; signal。
   * 结果：返回分支计算值（`await work(ftp)`），以 Promise 交付。
   * Result: Return the branch-computed value (`await work(ftp)`) through a Promise.
   * 协作入口 / Collaborators: `signal?.addEventListener`, `work`, `signal?.removeEventListener`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  async (_id, work, signal) => {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `connected`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    const abort = () => {
      connected = false;
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      return await work(ftp);
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  };
  return { machines, files, modes, owners };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: creating a text file never overwrites an existing file
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `machines.writeGuestFile`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.writeGuestFile('vm', path, 'replacement', false), /已存在/)`; `assert.deepEqual(files.get(path), original)`.
 */
test('creating a text file never overwrites an existing file', async () => {
  const { machines, files } = fixture();
  await assert.rejects(machines.writeGuestFile('vm', path, 'replacement', false), /已存在/);
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a text file created by another writer during save is preserved
 * 协作入口 / Collaborators: `fixture`, `files.delete`, `assert.rejects`, `machines.writeGuestFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.writeGuestFile('vm', path, 'replacement', false), /exists/)`; `assert.deepEqual(files.get(path), original)`.
 */
test('a text file created by another writer during save is preserved', async () => {
  const { machines, files } = fixture({ collide: true });
  files.delete(path);
  await assert.rejects(machines.writeGuestFile('vm', path, 'replacement', false), /exists/);
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
});

for (const failure of ['failWrite', 'failClose', 'failMetadata', 'failRename'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `machines.writeGuestFile`, `assert.deepEqual`.
   * 检查边界 / Checked boundaries: `assert.rejects(machines.writeGuestFile('vm', path, 'replacement'), /lost|failed/)`; `assert.deepEqual(files.get(path), original)`.
   */
  test(`a failed text save preserves the original and removes partial files (${failure})`, async () => {
    const { machines, files } = fixture({ [failure]: true });
    await assert.rejects(machines.writeGuestFile('vm', path, 'replacement'), /lost|failed/);
    assert.deepEqual(files.get(path), original);
    assert.equal(files.size, 1);
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: successful text saves preserve ownership and permissions and support new empty files
 * 协作入口 / Collaborators: `fixture`, `machines.writeGuestFile`, `assert.equal`, `files.get(path)?.toString`.
 * 检查边界 / Checked boundaries: `assert.equal(files.get(path)?.toString(), '新内容\n')`; `assert.equal(modes.get(path), 0o100660)`.
 */
test('successful text saves preserve ownership and permissions and support new empty files', async () => {
  const { machines, files, modes, owners } = fixture();
  await machines.writeGuestFile('vm', path, '新内容\n');
  assert.equal(files.get(path)?.toString(), '新内容\n');
  assert.equal(modes.get(path), 0o100660);
  assert.deepEqual(owners.get(path), { uid: 1000, gid: 1000 });
  await machines.writeGuestFile('vm', '/workspace/empty.txt', '', false);
  assert.equal(files.get('/workspace/empty.txt')?.length, 0);
  assert.equal(files.size, 2);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: text save limits use UTF-8 bytes and reject oversized content before modifying files
 * 协作入口 / Collaborators: `fixture`, `'中'.repeat`, `Math.ceil`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(content.length < 1024 ** 2)`; `assert.rejects(machines.writeGuestFile('vm', path, content), /1 MiB/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('text save limits use UTF-8 bytes and reject oversized content before modifying files', async () => {
  const { machines, files } = fixture();
  const content = '中'.repeat(Math.ceil(1024 ** 2 / 3));
  assert.ok(content.length < 1024 ** 2);
  await assert.rejects(machines.writeGuestFile('vm', path, content), /1 MiB/);
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
  const limit = 'a'.repeat(1024 ** 2);
  await machines.writeGuestFile('vm', path, limit);
  assert.equal(await machines.readGuestFile('vm', path), limit);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: text previews reject invalid and incomplete UTF-8 instead of silently replacing bytes
 * 协作入口 / Collaborators: `fixture`, `Buffer.from`, `files.set`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.readGuestFile('vm', path), /UTF-8/)`; `assert.deepEqual(files.get(path), bytes)`.
 */
test('text previews reject invalid and incomplete UTF-8 instead of silently replacing bytes', async () => {
  const { machines, files } = fixture();
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x41]), Buffer.from([0xe4, 0xb8])]) {
    files.set(path, bytes);
    await assert.rejects(machines.readGuestFile('vm', path), /UTF-8/);
    assert.deepEqual(files.get(path), bytes);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: text previews preserve split UTF-8, a BOM and actual replacement characters
 * 协作入口 / Collaborators: `fixture`, `files.set`, `Buffer.from`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(await machines.readGuestFile('vm', path), content)`; `assert.rejects(machines.readGuestFile('vm', path), /二进制/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('text previews preserve split UTF-8, a BOM and actual replacement characters', async () => {
  const { machines, files } = fixture();
  for (const content of ['', '中文 🌸\n', '\uFEFF中文\r\n', 'a\uFFFDb']) {
    files.set(path, Buffer.from(content));
    assert.equal(await machines.readGuestFile('vm', path), content);
  }
  files.set(path, Buffer.from([0, 1, 2]));
  await assert.rejects(machines.readGuestFile('vm', path), /二进制/);
  files.set(path, Buffer.alloc(1024 ** 2 + 1, 65));
  await assert.rejects(machines.readGuestFile('vm', path), /1 MiB/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: text previews wait for SFTP handle closure and report delayed close failures
 * 状态影响 / State effects: `machines.sftp`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `machines.readGuestFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.readGuestFile('vm', path), /read handle close failed/)`.
 */
test('text previews wait for SFTP handle closure and report delayed close failures', async () => {
  const { machines } = fixture();
  machines.sftp = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _id; work。
   * 结果：返回分支计算值（`work({ createReadStream: () => stream } as unknown as SFTPWrapper)`），以 Promise 交付。
   * Result: Return the branch-computed value (`work({ createReadStream: () => stream } as unknown as SFTPWrapper)`) through a Promise.
   * 验证场景 / Scenario: text previews wait for SFTP handle closure and report delayed close failures
   * 协作入口 / Collaborators: `stream.on`, `work`.
   */
  async (_id, work) => {
    const stream = new Readable({
      autoDestroy: false,
      emitClose: false,
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: text previews wait for SFTP handle closure and report delayed close failures
       * 协作入口 / Collaborators: `this.push`.
       */
      read() {
        this.push(original);
        this.push(null);
      },
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _error; cb。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: text previews wait for SFTP handle closure and report delayed close failures
       * 协作入口 / Collaborators: `setImmediate`.
       */
      destroy(_error, cb) {
        setImmediate(() => cb(new Error('read handle close failed')));
      },
    });
    stream.on('end', () => stream.destroy());
    return work({ /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`stream`）。
     * Result: Return the branch-computed value (`stream`).
     * 验证场景 / Scenario: text previews wait for SFTP handle closure and report delayed close failures
     */
    createReadStream: () => stream } as unknown as SFTPWrapper);
  };
  await assert.rejects(machines.readGuestFile('vm', path), /read handle close failed/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled uploads never publish partial content and retain the original file
 * 协作入口 / Collaborators: `fixture`, `Readable.from`, `(async function* () { yield Buffer.from('partial'); abort.abort(); yield Bu…`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(new Files(machines).upload('vm', path, source, true, abort.signal), { name: 'AbortError', })`; `assert.deepEqual(files.get(path), original)`.
 */
test('cancelled uploads never publish partial content and retain the original file', async () => {
  const { machines, files } = fixture();
  const abort = new AbortController();
  const source = Readable.from(
    (async function* () {
      yield Buffer.from('partial');
      abort.abort();
      yield Buffer.from('more');
    })(),
  );
  await assert.rejects(new Files(machines).upload('vm', path, source, true, abort.signal), {
    name: 'AbortError',
  });
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: uploads can still cancel while establishing the SFTP connection
 * 状态影响 / State effects: `machines.sftp`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `new Files(machines).upload`, `Readable.from`, `abort.abort`.
 * 检查边界 / Checked boundaries: `assert.rejects(uploading, { name: 'AbortError' })`; `assert.equal(connectionSignal?.aborted, true)`.
 */
test('uploads can still cancel while establishing the SFTP connection', async () => {
  const { machines, files } = fixture();
  const abort = new AbortController();
  let connectionSignal: AbortSignal | undefined;
  machines.sftp = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _id; _work; signal。
   * 结果：返回分支计算值（`new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => reje…`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Promise((_resolve, reject) => { signal!.addEventListener('abort', () => reje…`) through a Promise.
   * 验证场景 / Scenario: uploads can still cancel while establishing the SFTP connection
   * 状态影响 / State effects: `connectionSignal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  async (_id, _work, signal) => {
    connectionSignal = signal;
    return new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    });
  };
  const uploading = new Files(machines).upload('vm', path, Readable.from(['content']), true, abort.signal);
  abort.abort();
  await assert.rejects(uploading, { name: 'AbortError' });
  assert.equal(connectionSignal?.aborted, true);
  assert.deepEqual(files.get(path), original);
  assert.equal(files.size, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an interrupted HTTP upload retains its SFTP connection long enough to remove partial files
 * 协作入口 / Collaborators: `fixture`, `createServer`, `t.after`, `http.listen`.
 * 检查边界 / Checked boundaries: `assert.match((error as Error).message, /aborted/i)`; `assert.deepEqual(files.get(path), original)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'an interrupted HTTP upload retains its SFTP connection long enough to remove partial files',
  { timeout: 5000 },
  async (t) => {
    let wrote!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    const written = new Promise<void>((resolve) => {
      wrote = resolve;
    });
    let finished!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: unknown。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error: unknown) => void;
    const completed = new Promise<unknown>((resolve) => {
      finished = resolve;
    });
    const { machines, files } = fixture({ onWrite: wrote });
    const http = createServer(/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: req; res。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: an interrupted HTTP upload retains its SFTP connection long enough to remove partial files
     * 协作入口 / Collaborators: `req.once`, `res.once`, `new Files(machines).upload('vm', path, req, true, abort.signal).then`, `new Files(machines).upload`.
     */
    (req, res) => {
      const abort = new AbortController();
      req.once('aborted', () => abort.abort());
      res.once('close', () => {
        if (!res.writableFinished) abort.abort();
      });
      void new Files(machines).upload('vm', path, req, true, abort.signal).then(
        () => {
          res.end();
          finished(undefined);
        },
        (error) => {
          res.destroy();
          finished(error);
        },
      );
    });
    t.after(async () => {
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    });
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    const upload = request({
      host: '127.0.0.1',
      port: (http.address() as { port: number }).port,
      method: 'PUT',
    });
    upload.on('error', () => {});
    upload.write('partial body');
    await written;
    upload.destroy();
    const error = await completed;
    assert.match((error as Error).message, /aborted/i);
    assert.deepEqual(files.get(path), original);
    assert.equal(files.size, 1);
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: downloads keep their declared length when the source grows after stat, including empty files
 * 状态影响 / State effects: `machines.sftp`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `Buffer.from`, `Buffer.alloc`, `fixture`, `new Files(machines).download`.
 * 检查边界 / Checked boundaries: `assert.equal(declaredSize, initial.length)`; `assert.deepEqual(Buffer.concat(chunks), initial)`.
 */
test('downloads keep their declared length when the source grows after stat, including empty files', async () => {
  for (const initial of [Buffer.from('original'), Buffer.alloc(0)]) {
    const { machines } = fixture();
    machines.sftp = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id; work。
     * 结果：返回分支计算值（`work({ lstat(_path: string, cb: (error: undefined, attrs: unknown) => void) { cb…`），以 Promise 交付。
     * Result: Return the branch-computed value (`work({ lstat(_path: string, cb: (error: undefined, attrs: unknown) => void) { cb…`) through a Promise.
     * 验证场景 / Scenario: downloads keep their declared length when the source grows after stat, including empty files
     * 协作入口 / Collaborators: `work`.
     */
    async (_id, work) =>
      work({
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: _path: string; cb: (error: undefined, attrs: unknown) => void。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 验证场景 / Scenario: downloads keep their declared length when the source grows after stat, including empty files
         * 协作入口 / Collaborators: `cb`.
         */
        lstat(_path: string, cb: /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: error: undefined; attrs: unknown。
         * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
         * Result: The declared return type defines the result; its test provider supplies the implementation.
         */
        (error: undefined, attrs: unknown) => void) {
          cb(undefined, { size: initial.length, /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：返回布尔判定，供用例选择路径或核对受控条件。
           * Result: Return a boolean decision for path selection or controlled-condition assertions.
           * 验证场景 / Scenario: downloads keep their declared length when the source grows after stat, including empty files
           */
          isFile: () => true });
        },
        /**
         * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
         * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
         * 输入 / Inputs: _path: string; options: { start?: number; end?: number }。
         * 结果：返回分支计算值（`Readable.from([ grown.subarray(options?.start ?? 0, options?.end === undefined ?…`）。
         * Result: Return the branch-computed value (`Readable.from([ grown.subarray(options?.start ?? 0, options?.end === undefined ?…`).
         * 验证场景 / Scenario: downloads keep their declared length when the source grows after stat, including empty files
         * 协作入口 / Collaborators: `Buffer.concat`, `Buffer.from`, `Readable.from`, `grown.subarray`.
         */
        createReadStream(_path: string, options?: { start?: number; end?: number }) {
          const grown = Buffer.concat([initial, Buffer.from('appended while downloading')]);
          return Readable.from([
            grown.subarray(options?.start ?? 0, options?.end === undefined ? undefined : options.end + 1),
          ]);
        },
      } as unknown as SFTPWrapper);
    const chunks: Buffer[] = [];
    const target = new Writable({
      /**
       * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
       * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
       * 输入 / Inputs: chunk: Buffer; _encoding; cb。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: downloads keep their declared length when the source grows after stat, including empty files
       * 协作入口 / Collaborators: `chunks.push`, `cb`.
       */
      write(chunk: Buffer, _encoding, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    let declaredSize: number | undefined;
    await new Files(machines).download('vm', path, target, (size) => {
      declaredSize = size;
    });
    assert.equal(declaredSize, initial.length);
    assert.deepEqual(Buffer.concat(chunks), initial);
  }
});
