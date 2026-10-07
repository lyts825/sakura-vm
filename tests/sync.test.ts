/**
 * 模块职责：回归验证模块，围绕 `sync` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `sync`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: deletion decisions remove exactly the selected peer and default to keeping the survivor; path policies constrain forced sync, conflict resolution and Linux permissions.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { SFTPWrapper } from 'ssh2';
import type { Machines } from '../server/machines.ts';
import { mergeDriver } from '../shared/sync-policy.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-sync-test-'));
process.env.SAKURA_DATA_DIR = join(root, 'data');
const { vmDir } = await import('../server/model.ts');
const { FolderSync } = await import('../server/sync.ts');
after(() => rm(root, { recursive: true, force: true }));

type RemoteFile = { bytes: Buffer; mode: number; uid: number; gid: number };
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext; options: { failMetadata?: boolean; failReadClose?: boolean; disconnectAfte… = {}。
 * 结果：返回受控对象，公开字段包括 `id, host, remote, machines, sync, closedBeforeReadHandles`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, host, remote, machines, sync, closedBeforeReadHandles`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `randomUUID`, `join`, `mkdir`, `vmDir`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(
  t: TestContext,
  options: {
    failMetadata?: boolean;
    failReadClose?: boolean;
    disconnectAfterRead?: number;
    cancelOnWrite?: boolean;
    onRead?: /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: path: string; number: number; remote: Map<string, RemoteFile>。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (path: string, number: number, remote: Map<string, RemoteFile>) => void;
  } = {},
) {
  const id = randomUUID();
  const host = join(root, id);
  await mkdir(host);
  await mkdir(vmDir(id), { recursive: true });
  const remote = new Map<string, RemoteFile>([
    ['/workspace/notes.txt', { bytes: Buffer.from('original'), mode: 0o100660, uid: 1000, gid: 1001 }],
  ]);
  const directories = new Set(['/workspace']);
  let openReadHandles = 0;
  let reads = 0;
  let closedBeforeReadHandles = false;
  const transport = new AbortController();
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
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: path: string。
   * 结果：返回分支计算值（`({ size: remote.get(path)?.bytes.length || 0, ...remote.get(path), mode: remote.…`）。
   * Result: Return the branch-computed value (`({ size: remote.get(path)?.bytes.length || 0, ...remote.get(path), mode: remote.…`).
   * 协作入口 / Collaborators: `remote.get`.
   */
  const attrs = (path: string) => ({
    size: remote.get(path)?.bytes.length || 0,
    ...remote.get(path),
    mode: remote.get(path)?.mode || 0o40755,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`remote.has(path)`）。
     * Result: Return the branch-computed value (`remote.has(path)`).
     * 协作入口 / Collaborators: `remote.has`.
     */
    isFile: () => remote.has(path),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`directories.has(path)`）。
     * Result: Return the branch-computed value (`directories.has(path)`).
     * 协作入口 / Collaborators: `directories.has`.
     */
    isDirectory: () => directories.has(path),
  });
  const ftp = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: path: string; cb: (error: Error | undefined, attrs?: unknown) => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `cb`, `remote.has`, `directories.has`, `missing`.
     */
    lstat(path: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error | undefined; attrs: unknown。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error: Error | undefined, attrs?: unknown) => void) {
      cb(remote.has(path) || directories.has(path) ? undefined : missing(), attrs(path));
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: path: string; cb: (error: Error | undefined, entries: unknown[]) => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `cb`, `[...remote.keys(), ...directories] .filter((name) => name.startsWith(path +…`, `[...remote.keys(), ...directories] .filter`, `remote.keys`.
     */
    readdir(path: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error | undefined; entries: unknown[]。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error: Error | undefined, entries: unknown[]) => void) {
      cb(
        undefined,
        [...remote.keys(), ...directories]
          .filter((name) => name.startsWith(path + '/') && !name.slice(path.length + 1).includes('/'))
          .map((name) => ({
            filename: name.slice(path.length + 1),
            attrs: attrs(name),
          })),
      );
    },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: path: string。
     * 结果：返回分支计算值（`stream`）。
     * Result: Return the branch-computed value (`stream`).
     * 协作入口 / Collaborators: `options.onRead`, `stream.on`.
     */
    createReadStream(path: string) {
      openReadHandles++;
      const readNumber = ++reads;
      options.onRead?.(path, readNumber, remote);
      const stream = new Readable({
        autoDestroy: false,
        emitClose: false,
        /**
         * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
         * English: Read or resolve observable fixture state for business calls or subsequent assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `this.push`, `remote.get`.
         */
        read() {
          this.push(remote.get(path)!.bytes);
          this.push(null);
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
            openReadHandles--;
            const failure = error || (options.failReadClose ? new Error('read handle close failed') : null);
            cb(failure);
            if (!failure) {
              this.emit('close');
              if (readNumber === options.disconnectAfterRead)
                transport.abort(new Error('SFTP connection closed'));
            }
          });
        },
      });
      stream.on('end', () => stream.destroy());
      return stream;
    },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: path: string; settings: { flags: string; mode: number }。
     * 结果：返回分支计算值（`new Writable({ write(chunk: Buffer, _encoding, cb) { const file = remote.get(pat…`）。
     * Result: Return the branch-computed value (`new Writable({ write(chunk: Buffer, _encoding, cb) { const file = remote.get(pat…`).
     * 协作入口 / Collaborators: `assert.equal`, `remote.has`, `remote.set`, `Buffer.alloc`.
     * 检查边界 / Checked boundaries: `assert.equal(settings.flags, 'wx')`; `assert.equal(remote.has(path), false)`.
     */
    createWriteStream(path: string, settings: { flags: string; mode: number }) {
      assert.equal(settings.flags, 'wx');
      assert.equal(remote.has(path), false);
      remote.set(path, { bytes: Buffer.alloc(0), mode: settings.mode & ~0o022, uid: 0, gid: 0 });
      return new Writable({
        /**
         * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
         * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
         * 输入 / Inputs: chunk: Buffer; _encoding; cb。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 状态影响 / State effects: `file.bytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         * 协作入口 / Collaborators: `remote.get`, `Buffer.concat`, `sync.jobs.cancel`, `cb`.
         */
        write(chunk: Buffer, _encoding, cb) {
          const file = remote.get(path)!;
          file.bytes = Buffer.concat([file.bytes, chunk]);
          if (options.cancelOnWrite) sync.jobs.cancel(id);
          cb();
        },
      });
    },
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: path: string; uid: number; gid: number; cb: (error?: Error) => void。
     * 结果：返回分支计算值（`cb(new Error('metadata failed'))`）。
     * Result: Return the branch-computed value (`cb(new Error('metadata failed'))`).
     * 协作入口 / Collaborators: `cb`, `Object.assign`, `remote.get`.
     */
    chown(path: string, uid: number, gid: number, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error?: Error) => void) {
      if (options.failMetadata) return cb(new Error('metadata failed'));
      Object.assign(remote.get(path)!, { uid, gid });
      cb();
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: path: string; mode: number; cb: () => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `remote.get(path)!.mode`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `remote.get`, `cb`.
     */
    chmod(path: string, mode: number, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) {
      remote.get(path)!.mode = 0o100000 | mode;
      cb();
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: from: string; to: string; cb: () => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `remote.set`, `remote.get`, `remote.delete`, `cb`.
     */
    ext_openssh_rename(from: string, to: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) {
      remote.set(to, remote.get(from)!);
      remote.delete(from);
      cb();
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: from: string; to: string; cb: (error?: Error) => void。
     * 结果：返回分支计算值（`cb(new Error('File exists')) / cb(missing())`）。
     * Result: Return the branch-computed value (`cb(new Error('File exists')) / cb(missing())`).
     * 协作入口 / Collaborators: `remote.has`, `cb`, `missing`, `remote.set`.
     */
    rename(from: string, to: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: error: Error。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (error?: Error) => void) {
      if (remote.has(to)) return cb(new Error('File exists'));
      if (!remote.has(from)) return cb(missing());
      remote.set(to, remote.get(from)!);
      remote.delete(from);
      cb();
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: path: string; cb: () => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `directories.add`, `cb`.
     */
    mkdir(path: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) {
      directories.add(path);
      cb();
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: path: string; cb: () => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `remote.delete`, `cb`.
     */
    unlink(path: string, cb: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) {
      if (!transport.signal.aborted) remote.delete(path);
      cb();
    },
  } as unknown as SFTPWrapper;
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, {}]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({})`）。
     * Result: Return the branch-computed value (`({})`).
     */
    get: () => ({}),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 协作入口 / Collaborators: `work`.
     */
    locked: async (_key: string, work: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => work(),
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _id: string; work: (ftp: SFTPWrapper, signal?: AbortSignal) => Promise<unknown>; signal: AbortSignal。
     * 结果：返回分支计算值（`await work(ftp, transport.signal)`），以 Promise 交付。
     * Result: Return the branch-computed value (`await work(ftp, transport.signal)`) through a Promise.
     * 状态影响 / State effects: `closedBeforeReadHandles`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `signal?.addEventListener`, `work`, `signal?.removeEventListener`.
     * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
     * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
     */
    sftp: async (
      _id: string,
      work: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: ftp: SFTPWrapper; signal: AbortSignal。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (ftp: SFTPWrapper, signal?: AbortSignal) => Promise<unknown>,
      signal?: AbortSignal,
    ) => {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`transport.abort(signal?.reason)`）。
       * Result: Return the branch-computed value (`transport.abort(signal?.reason)`).
       * 协作入口 / Collaborators: `transport.abort`.
       */
      const abort = () => transport.abort(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        return await work(ftp, transport.signal);
      } finally {
        signal?.removeEventListener('abort', abort);
        closedBeforeReadHandles ||= openReadHandles > 0;
      }
    },
  }) as unknown as Machines;
  const sync = new FolderSync(machines);
  t.after(() => sync.close());
  await sync.save(id, { host, guest: '/workspace' });
  return { id, host, remote, machines, sync, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`closedBeforeReadHandles`）。
   * Result: Return the branch-computed value (`closedBeforeReadHandles`).
   */
  closedBeforeReadHandles: () => closedBeforeReadHandles };
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: sync: InstanceType<typeof FolderSync>; id: string。
 * 结果：返回分支计算值（`sync.jobs.view(id)!`），以 Promise 交付。
 * Result: Return the branch-computed value (`sync.jobs.view(id)!`) through a Promise.
 * 协作入口 / Collaborators: `Date.now`, `sync.jobs.view`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < deadline, 'sync job did not finish')`.
 */
async function finished(sync: InstanceType<typeof FolderSync>, id: string) {
  const deadline = Date.now() + 5000;
  while (sync.jobs.view(id)?.status === 'running') {
    assert.ok(Date.now() < deadline, 'sync job did not finish');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return sync.jobs.view(id)!;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: deletion decisions remove exactly the selected peer and default to keeping the survivor
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.run`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'done')`; `assert.deepEqual(preview.changes, [{ path: 'notes.txt', action }])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('deletion decisions remove exactly the selected peer and default to keeping the survivor', async (t) => {
  for (const side of ['host', 'guest'] as const) {
    const { id, host, remote, sync } = await fixture(t);
    await writeFile(join(host, 'notes.txt'), 'original');
    await sync.run(id, 'both');
    assert.equal((await finished(sync, id)).status, 'done');
    if (side === 'host') await rm(join(host, 'notes.txt'));
    else remote.delete('/workspace/notes.txt');
    const preview = await sync.preview(id);
    const action = side === 'host' ? 'delete-guest' : 'delete-host';
    assert.deepEqual(preview.changes, [{ path: 'notes.txt', action }]);
    await sync.run(id, 'both');
    assert.equal((await finished(sync, id)).status, 'done');
    if (side === 'host') assert.equal(remote.has('/workspace/notes.txt'), true);
    else assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'original');
    await sync.run(id, 'both', preview.token, { 'notes.txt': action });
    assert.equal((await finished(sync, id)).status, 'done');
    assert.equal(remote.has('/workspace/notes.txt'), false);
    await assert.rejects(readFile(join(host, 'notes.txt')), { code: 'ENOENT' });
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: path policies constrain forced sync, conflict resolution and Linux permissions
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.save`.
 * 检查边界 / Checked boundaries: `assert.deepEqual((await sync.preview(id)).changes, [{ path: 'notes.txt', action: 'skip' }])`; `assert.equal((await finished(sync, id)).status, 'done')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('path policies constrain forced sync, conflict resolution and Linux permissions', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'private host');
  await sync.save(id, { host, guest: '/workspace', policies: [{ pattern: '*.txt', direction: 'readonly' }] });
  assert.deepEqual((await sync.preview(id)).changes, [{ path: 'notes.txt', action: 'skip' }]);
  await sync.run(id, 'push');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await sync.save(id, {
    host,
    guest: '/workspace',
    policies: [{ pattern: '*.txt', direction: 'push', guestMode: '600' }],
  });
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'pull' });
  assert.match((await finished(sync, id)).error!, /路径策略/);
  await sync.run(id, 'push');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'private host');
  assert.equal(remote.get('/workspace/notes.txt')!.mode & 0o777, 0o600);
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sync rollback restores originals, metadata, conflict copies and the shared baseline
 * 状态影响 / State effects: `remote.get('/workspace/notes.txt')!.bytes`, `result`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'done')`; `assert.equal(result.status, 'done', result.error)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('sync rollback restores originals, metadata, conflict copies and the shared baseline', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', rollback: true, mergeText: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  const baseline = await readFile(join(vmDir(id), 'sync-state.json'), 'utf8');
  await writeFile(join(host, 'notes.txt'), 'host edit');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest edit');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'both' });
  let result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  const point = (await sync.view(id)).history[0];
  assert.equal(point.changes, 3);
  assert.equal(point.status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'host edit');
  await sync.rollback(id, point.id);
  result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest edit');
  assert.equal(remote.get('/workspace/notes.txt')!.mode & 0o777, 0o660);
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host edit');
  assert.equal(
    [...remote.keys()].some((key) => key.includes('.linux-conflict-')),
    false,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(vmDir(id), 'sync-state.json'), 'utf8')),
    JSON.parse(baseline),
  );
  assert.equal((await sync.view(id)).history[0].status, 'rolled-back');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rollback refuses newer edits before any restoration and checks stored file hashes
 * 状态影响 / State effects: `remote.get('/workspace/notes.txt')!.bytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'done')`; `assert.match((await finished(sync, id)).error!, /同步后文件已被修改/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('rollback refuses newer edits before any restoration and checks stored file hashes', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', rollback: true });
  await writeFile(join(host, 'notes.txt'), 'new host');
  await sync.run(id, 'push');
  assert.equal((await finished(sync, id)).status, 'done');
  const point = (await sync.view(id)).history[0];
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('edited after sync');
  await sync.rollback(id, point.id);
  assert.match((await finished(sync, id)).error!, /同步后文件已被修改/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'edited after sync');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('new host');
  const directory = join(vmDir(id), 'sync-history.json.d', point.id);
  const record = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8'));
  await writeFile(join(directory, record.entries[0].before.sha), 'tampered');
  await sync.rollback(id, point.id);
  assert.match((await finished(sync, id)).error!, /回滚文件校验失败/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'new host');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rollback can undo detected renames and explicit deletion without touching the originating side
 * 状态影响 / State effects: `job`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'done')`; `assert.equal(job.status, 'done', job.error)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('rollback can undo detected renames and explicit deletion without touching the originating side', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', rollback: true, detectRenames: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  await finished(sync, id);
  await rename(join(host, 'notes.txt'), join(host, 'moved.txt'));
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  await sync.rollback(id, (await sync.view(id)).history[0].id);
  let job = await finished(sync, id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(remote.has('/workspace/notes.txt'), true);
  assert.equal(remote.has('/workspace/moved.txt'), false);
  assert.equal(await readFile(join(host, 'moved.txt'), 'utf8'), 'original');
  await sync.save(id, { host, guest: '/workspace', rollback: true });
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'delete-guest' });
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.has('/workspace/notes.txt'), false);
  await sync.rollback(id, (await sync.view(id)).history[0].id);
  job = await finished(sync, id);
  assert.equal(job.status, 'done', job.error);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  assert.equal(remote.has('/workspace/moved.txt'), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unique unchanged renames move the peer in either direction and ambiguous matches remain decisions
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'done')`; `assert.deepEqual(preview.changes, [ { from: 'notes.txt', path: 'renamed.txt', action: side === 'host' ? 'rename-guest' : 'rename-h…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('unique unchanged renames move the peer in either direction and ambiguous matches remain decisions', async (t) => {
  for (const side of ['host', 'guest'] as const) {
    const { id, host, remote, sync } = await fixture(t);
    await sync.save(id, { host, guest: '/workspace', detectRenames: true });
    await writeFile(join(host, 'notes.txt'), 'original');
    await sync.run(id, 'both');
    assert.equal((await finished(sync, id)).status, 'done');
    if (side === 'host') await rename(join(host, 'notes.txt'), join(host, 'renamed.txt'));
    else {
      remote.set('/workspace/renamed.txt', remote.get('/workspace/notes.txt')!);
      remote.delete('/workspace/notes.txt');
    }
    const preview = await sync.preview(id);
    assert.deepEqual(preview.changes, [
      { from: 'notes.txt', path: 'renamed.txt', action: side === 'host' ? 'rename-guest' : 'rename-host' },
    ]);
    await sync.run(id, 'both', preview.token);
    const result = await finished(sync, id);
    assert.equal(result.status, 'done', result.error);
    assert.equal(remote.has('/workspace/notes.txt'), false);
    await assert.rejects(readFile(join(host, 'notes.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(join(host, 'renamed.txt'), 'utf8'), 'original');
    assert.equal(remote.get('/workspace/renamed.txt')!.mode & 0o777, 0o660);
    assert.equal((await sync.preview(id)).changes.length, 0);
  }
  const { detectSyncRenames } = await import('../shared/sync-policy.ts');
  assert.deepEqual(
    detectSyncRenames(
      new Map([['new', 'x']]),
      new Map([
        ['a', 'x'],
        ['b', 'x'],
      ]),
      { a: 'x', b: 'x' },
    ),
    [],
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sync preview is read-only and stale previews cannot overwrite subsequent changes
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.preview`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(preview.changes, [{ path: 'notes.txt', action: 'conflict' }])`; `assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('sync preview is read-only and stale previews cannot overwrite subsequent changes', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'host edit');
  const preview = await sync.preview(id);
  assert.deepEqual(preview.changes, [{ path: 'notes.txt', action: 'conflict' }]);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
  await writeFile(join(host, 'notes.txt'), 'newer host edit');
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'pull' });
  assert.match((await finished(sync, id)).error!, /重新预览/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'newer host edit');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: offline sync requests survive restart, obey windows, retry failures and can be cancelled
 * 状态影响 / State effects: `machines.state`, `online`, `machines.sftp`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sync.queue`, `sync.tick`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await sync.view(id)).queue?.attempts, 0)`; `assert.ok((await restarted.view(id)).queue)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('offline sync requests survive restart, obey windows, retry failures and can be cancelled', async (t) => {
  const { id, host, remote, machines, sync } = await fixture(t);
  let online = false;
  machines.state = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`(online ? 'running' : 'stopped')`）。
   * Result: Return the branch-computed value (`(online ? 'running' : 'stopped')`).
   * 验证场景 / Scenario: offline sync requests survive restart, obey windows, retry failures and can be cancelled
   */
  () => (online ? 'running' : 'stopped');
  await sync.queue(id);
  await sync.tick();
  assert.equal((await sync.view(id)).queue?.attempts, 0);
  await sync.close();
  const restarted = new FolderSync(machines);
  t.after(() => restarted.close());
  assert.ok((await restarted.view(id)).queue);
  online = true;
  await restarted.save(id, {
    host,
    guest: '/workspace',
    window: { days: [1], start: '09:00', end: '10:00', timeZone: 'UTC' },
  });
  const monday = Date.parse('2026-09-28T09:30:00Z');
  await restarted.tick(Date.parse('2026-09-28T11:00:00Z'));
  assert.equal(restarted.jobs.view(id), null);
  const originalSftp = machines.sftp;
  machines.sftp = /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: offline sync requests survive restart, obey windows, retry failures and can be cancelled
   * 失败 / Failure: `new Error('temporary network failure')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   */
  async () => {
    throw new Error('temporary network failure');
  };
  await restarted.tick(monday);
  assert.equal((await finished(restarted, id)).status, 'error');
  await restarted.tick(monday + 1000);
  assert.match((await restarted.view(id)).queue!.lastError!, /temporary network failure/);
  assert.equal((await restarted.view(id)).queue?.attempts, 1);
  machines.sftp = originalSftp;
  await restarted.tick(monday + 40000);
  assert.equal((await finished(restarted, id)).status, 'done');
  await restarted.tick(monday + 50000);
  assert.equal((await restarted.view(id)).queue, null);
  assert.equal(
    await readFile(join(host, 'notes.txt'), 'utf8'),
    remote.get('/workspace/notes.txt')!.bytes.toString(),
  );
  await restarted.queue(id);
  await restarted.queue(id, true);
  assert.equal((await restarted.view(id)).queue, null);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: maintenance windows prevent new automatic sync without cancelling manual work
 * 协作入口 / Collaborators: `fixture`, `import`, `sync.save`, `saveMaintenancePolicy`.
 * 检查边界 / Checked boundaries: `assert.equal(sync.jobs.view(id), null)`; `assert.equal((await finished(sync, id)).status, 'done')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('maintenance windows prevent new automatic sync without cancelling manual work', async (t) => {
  const { id, host, sync } = await fixture(t);
  const { saveMaintenancePolicy } = await import('../server/automation-policy.ts');
  await sync.save(id, { host, guest: '/workspace', auto: true });
  await saveMaintenancePolicy(id, {
    enabled: true,
    windows: [{ days: [1], start: '00:00', end: '00:00', timeZone: 'UTC' }],
  });
  await sync.tick(Date.parse('2026-09-28T10:00:00Z'));
  assert.equal(sync.jobs.view(id), null);
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: per-file conflict resolution keeps both versions on both sides
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.preview`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'done', result.error)`; `assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'host edit')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('per-file conflict resolution keeps both versions on both sides', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'host edit');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'both' });
  const result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'host edit');
  const backup = [...remote.keys()].find((v) => v.includes('.linux-conflict-'))!;
  assert.equal(remote.get(backup)!.bytes.toString(), 'original');
  assert.equal(await readFile(join(host, backup.split('/').at(-1)!), 'utf8'), 'original');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: merge drivers apply the first matching rule to binary conflicts and allow preview overrides
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `mergeDriver`, `sync.save`.
 * 检查边界 / Checked boundaries: `assert.equal(mergeDriver('notes.txt', [ { pattern: '*.txt', mode: 'manual' }, { pattern: 'notes.txt', mode: 'prefer-host' }, ])?.m…`; `assert.deepEqual(preview.changes, [{ path: 'notes.txt', action: 'conflict', driver: 'prefer-host', suggestedDecision: 'push', }])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('merge drivers apply the first matching rule to binary conflicts and allow preview overrides', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  assert.equal(mergeDriver('notes.txt', [
    { pattern: '*.txt', mode: 'manual' },
    { pattern: 'notes.txt', mode: 'prefer-host' },
  ])?.mode, 'manual');
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'prefer-host' },
  ] });
  const hostBytes = Buffer.from([0, 1, 2, 3]);
  await writeFile(join(host, 'notes.txt'), hostBytes);
  const preview = await sync.preview(id);
  assert.deepEqual(preview.changes, [{
    path: 'notes.txt', action: 'conflict', driver: 'prefer-host', suggestedDecision: 'push',
  }]);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'skip' });
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.deepEqual(remote.get('/workspace/notes.txt')!.bytes, hostBytes);
  assert.deepEqual((await sync.config(id))?.drivers, [{ pattern: '*.txt', mode: 'prefer-host' }]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: keep-both driver preserves binary versions and stale driver previews cannot be applied
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(preview.changes[0].suggestedDecision, 'both')`; `assert.match((await finished(sync, id)).error || '', /重新预览/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('keep-both driver preserves binary versions and stale driver previews cannot be applied', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'keep-both' },
  ] });
  await writeFile(join(host, 'notes.txt'), Buffer.from([0, 10, 20]));
  const preview = await sync.preview(id);
  assert.equal(preview.changes[0].suggestedDecision, 'both');
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'prefer-guest' },
  ] });
  await sync.run(id, 'both', preview.token);
  assert.match((await finished(sync, id)).error || '', /重新预览/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  await sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'keep-both' },
  ] });
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.deepEqual(remote.get('/workspace/notes.txt')!.bytes, Buffer.from([0, 10, 20]));
  const backup = [...remote.keys()].find((path) => path.includes('.linux-conflict-'))!;
  assert.equal(remote.get(backup)!.bytes.toString(), 'original');
  assert.equal(await readFile(join(host, backup.split('/').at(-1)!), 'utf8'), 'original');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: automatic text merge combines independent edits and retains overlapping or binary changes
 * 状态影响 / State effects: `remote.get('/workspace/notes.txt')!.bytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `sync.save`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.rejects(sync.save(id, { host, guest: '/workspace', drivers: [ { pattern: '*.txt', mode: 'merge-text' }, ] }), /需要启用共同文本版本/)`; `assert.equal((await finished(sync, id)).status, 'done')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('automatic text merge combines independent edits and retains overlapping or binary changes', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await assert.rejects(sync.save(id, { host, guest: '/workspace', drivers: [
    { pattern: '*.txt', mode: 'merge-text' },
  ] }), /需要启用共同文本版本/);
  await sync.save(id, { host, guest: '/workspace', mergeText: true, drivers: [
    { pattern: '*.txt', mode: 'merge-text' },
  ] });
  const base = 'one\ntwo\nthree\n';
  await writeFile(join(host, 'notes.txt'), base);
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from(base);
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  await writeFile(join(host, 'notes.txt'), 'ONE\ntwo\nthree\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('one\ntwo\nTHREE\n');
  assert.equal((await sync.preview(id)).changes[0].suggestedDecision, 'merge');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'ONE\ntwo\nTHREE\n');
  await writeFile(join(host, 'notes.txt'), 'host\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest\n');
  await sync.run(id, 'both');
  assert.match((await finished(sync, id)).log, /重叠修改/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest\n');
  await writeFile(join(host, 'notes.txt'), Buffer.from([0, 4, 5]));
  await sync.run(id, 'both');
  assert.match((await finished(sync, id)).log, /二进制文件/);
  assert.deepEqual(await readFile(join(host, 'notes.txt')), Buffer.from([0, 4, 5]));
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest\n');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: three-way sync uses a persisted common version and preserves overlapping changes
 * 状态影响 / State effects: `remote.get('/workspace/notes.txt')!.bytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'done')`; `assert.equal(saved['notes.txt'], base)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('three-way sync uses a persisted common version and preserves overlapping changes', async (t) => {
  const { id, host, remote, sync, closedBeforeReadHandles } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', mergeText: true });
  const base = '\ufeffone\ntwo\nthree\n';
  await writeFile(join(host, 'notes.txt'), base);
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from(base);
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  const saved = JSON.parse(await readFile(join(vmDir(id), 'sync-base.json'), 'utf8'));
  assert.equal(saved['notes.txt'], base);
  await writeFile(join(host, 'notes.txt'), '\ufeffONE\ntwo\nthree\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('\ufeffone\ntwo\nTHREE\n');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'merge' });
  const merged = await finished(sync, id);
  assert.equal(merged.status, 'done', merged.error);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), '\ufeffONE\ntwo\nTHREE\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), '\ufeffONE\ntwo\nTHREE\n');
  assert.equal(remote.get('/workspace/notes.txt')!.mode, 0o100660);
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
  await writeFile(join(host, 'notes.txt'), 'host\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest\n');
  const conflicted = await sync.preview(id);
  await sync.run(id, 'both', conflicted.token, { 'notes.txt': 'merge' });
  assert.match((await finished(sync, id)).log, /重叠修改/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest\n');
  assert.equal(closedBeforeReadHandles(), false);
  await sync.save(id, { host, guest: '/workspace', mergeText: false });
  await assert.rejects(readFile(join(vmDir(id), 'sync-base.json')), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: manual sync merge reads reviewed sides and commits only against the current preview
 * 状态影响 / State effects: `remote.get('/workspace/notes.txt')!.bytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'done')`; `assert.deepEqual(preview.changes, [{ path: 'notes.txt', action: 'conflict' }])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('manual sync merge reads reviewed sides and commits only against the current preview', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', mergeText: true, rollback: true });
  await writeFile(join(host, 'notes.txt'), 'one\ntwo\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('one\ntwo\n');
  await sync.run(id, 'both');
  assert.equal((await finished(sync, id)).status, 'done');
  await writeFile(join(host, 'notes.txt'), 'ONE\ntwo\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('UNO\ntwo\n');
  const preview = await sync.preview(id);
  assert.deepEqual(preview.changes, [{ path: 'notes.txt', action: 'conflict' }]);
  const context = await sync.mergePreview(id, 'notes.txt', preview.token);
  assert.deepEqual(context, {
    path: 'notes.txt', token: preview.token,
    base: 'one\ntwo\n', ours: 'ONE\ntwo\n', theirs: 'UNO\ntwo\n',
  });
  await assert.rejects(sync.run(id, 'both', preview.token, { 'notes.txt': 'manual' }),
    /缺少已审阅的文本内容/);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'manual' },
    { 'notes.txt': 'ONE + UNO\ntwo\n' });
  const merged = await finished(sync, id);
  assert.equal(merged.status, 'done', merged.error);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'ONE + UNO\ntwo\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'ONE + UNO\ntwo\n');
  assert.equal(remote.get('/workspace/notes.txt')!.uid, 1000);
  await writeFile(join(host, 'notes.txt'), 'new host\n');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('new guest\n');
  const stale = await sync.preview(id);
  await sync.mergePreview(id, 'notes.txt', stale.token);
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('changed again\n');
  await assert.rejects(sync.mergePreview(id, 'notes.txt', stale.token), /重新预览/);
  await sync.run(id, 'both', stale.token, { 'notes.txt': 'manual' },
    { 'notes.txt': 'stale result\n' });
  assert.match((await finished(sync, id)).error!, /重新预览/);
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'new host\n');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'changed again\n');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: three-way sync rejects a tampered baseline without replacing either side
 * 状态影响 / State effects: `remote.get('/workspace/notes.txt')!.bytes`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `sync.save`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal((await finished(sync, id)).status, 'error')`; `assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('three-way sync rejects a tampered baseline without replacing either side', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await sync.save(id, { host, guest: '/workspace', mergeText: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  await finished(sync, id);
  await writeFile(join(vmDir(id), 'sync-base.json'), JSON.stringify({ 'notes.txt': 'tampered' }));
  await writeFile(join(host, 'notes.txt'), 'host');
  remote.get('/workspace/notes.txt')!.bytes = Buffer.from('guest');
  const preview = await sync.preview(id);
  await sync.run(id, 'both', preview.token, { 'notes.txt': 'merge' });
  assert.equal((await finished(sync, id)).status, 'error');
  assert.equal(await readFile(join(host, 'notes.txt'), 'utf8'), 'host');
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'guest');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync preserves guest ownership and full permissions when replacing an existing file
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.run`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'done', result.error)`; `assert.deepEqual(remote.get('/workspace/notes.txt'), { bytes: Buffer.from('updated'), mode: 0o100660, uid: 1000, gid: 1001, })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('folder sync preserves guest ownership and full permissions when replacing an existing file', async (t) => {
  const { id, host, remote, sync } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'updated');
  await sync.run(id, 'push');
  const result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.deepEqual(remote.get('/workspace/notes.txt'), {
    bytes: Buffer.from('updated'),
    mode: 0o100660,
    uid: 1000,
    gid: 1001,
  });
  assert.equal(remote.size, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync leaves the original intact when replacement metadata cannot be preserved
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.run`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'error')`; `assert.match(result.error!, /metadata failed/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('folder sync leaves the original intact when replacement metadata cannot be preserved', async (t) => {
  const { id, host, remote, sync } = await fixture(t, { failMetadata: true });
  await writeFile(join(host, 'notes.txt'), 'updated');
  await sync.run(id, 'push');
  const result = await finished(sync, id);
  assert.equal(result.status, 'error');
  assert.match(result.error!, /metadata failed/);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
  assert.equal(remote.size, 1);
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync releases the machine lifecycle observer on shutdown
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `machines.listenerCount`, `sync.close`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.listenerCount('change'), 1)`; `assert.equal(machines.listenerCount('change'), 0)`.
 */
test('folder sync releases the machine lifecycle observer on shutdown', async (t) => {
  const { machines, sync } = await fixture(t);
  assert.equal(machines.listenerCount('change'), 1);
  await sync.close();
  assert.equal(machines.listenerCount('change'), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync waits for the final read handle to close before releasing SSH
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.run`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'done', result.error)`; `assert.equal(closedBeforeReadHandles(), false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('folder sync waits for the final read handle to close before releasing SSH', async (t) => {
  const { id, host, sync, closedBeforeReadHandles } = await fixture(t);
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  const result = await finished(sync, id);
  assert.equal(result.status, 'done', result.error);
  assert.equal(closedBeforeReadHandles(), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync reports delayed read handle closure failures without publishing comparison state
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.run`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'error')`; `assert.match(result.error!, /read handle close failed/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('folder sync reports delayed read handle closure failures without publishing comparison state', async (t) => {
  const { id, host, sync } = await fixture(t, { failReadClose: true });
  await writeFile(join(host, 'notes.txt'), 'original');
  await sync.run(id, 'both');
  const result = await finished(sync, id);
  assert.equal(result.status, 'error');
  assert.match(result.error!, /read handle close failed/);
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: folder sync does not publish a downloaded host file after the SFTP connection closes
 * 协作入口 / Collaborators: `fixture`, `sync.run`, `finished`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'error')`; `assert.match(result.error!, /connection closed|aborted/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('folder sync does not publish a downloaded host file after the SFTP connection closes', async (t) => {
  const { id, host, sync } = await fixture(t, { disconnectAfterRead: 2 });
  await sync.run(id, 'pull');
  const result = await finished(sync, id);
  assert.equal(result.status, 'error');
  assert.match(result.error!, /connection closed|aborted/);
  await assert.rejects(readFile(join(host, 'notes.txt')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(vmDir(id), 'sync-state.json')), { code: 'ENOENT' });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelled folder uploads clean their temporary file through the live SFTP connection
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `sync.run`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 'cancelled')`; `assert.equal(remote.size, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancelled folder uploads clean their temporary file through the live SFTP connection', async (t) => {
  const { id, host, remote, sync } = await fixture(t, { cancelOnWrite: true });
  await writeFile(join(host, 'notes.txt'), 'updated');
  await sync.run(id, 'push');
  const result = await finished(sync, id);
  assert.equal(result.status, 'cancelled');
  assert.equal(remote.size, 1);
  assert.equal(remote.get('/workspace/notes.txt')!.bytes.toString(), 'original');
});
