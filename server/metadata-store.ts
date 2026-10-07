/**
 * 模块职责：封装元数据快照、修订号与条件替换，在串行队列内实现冲突检查及原子发布。
 * Module purpose: Owns snapshots, content revisions and conditional replacement, enforcing conflicts and atomic publication within serialized queues.
 */
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { atomicMetadataWrite } from './metadata-io.ts';
import { serializedMetadata, flushMetadataFile } from './metadata-queue.ts';
export { metadataKey, flushMetadata } from './metadata-queue.ts';

export type MetadataRevision = string;
export type MetadataSnapshot<T> = { value: T; revision: MetadataRevision };
export type MetadataWriteOptions = {
  expectedRevision?: MetadataRevision;
  signal?: AbortSignal;
  /**
   * 签名 / Signature: MetadataWriteOptions.beforeCommit.
   * 功能：为封装元数据快照、修订号与条件替换声明 beforeCommit 的输入与结果契约，所属容器为 MetadataWriteOptions。
   * Purpose: Declares the input/result contract for beforeCommit in MetadataWriteOptions. Module responsibility: Owns snapshots, content revisions and conditional replacement, enforcing conflicts and atomic publication within serialized queues.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void | Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  beforeCommit?: () => void | Promise<void>;
};
/**
 * 入口 / Entry: revision.
 * 功能：对文件原始文本计算 SHA-256 修订号，使重启后的条件写入仍可检测字节变化。
 * Purpose: Hashes original file text with SHA-256 so conditional writes detect byte changes across restarts.
 * 输入 / Inputs: bytes: string
 * 输出 / Returns: `createHash('sha256').update(bytes).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const revision = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

/**
 * 入口 / Entry: capture.
 * 功能：通过 JSON 序列化复制调用时的值，避免排队期间调用者修改原对象。
 * Purpose: Copies the value through JSON serialization at call time so callers cannot mutate the queued snapshot.
 * 设计：不能序列化为 JSON 的顶层值立即拒绝；JSON 编解码也决定可保留的数据类型。
 * Design: Rejects top-level values that cannot serialize to JSON; JSON encoding/decoding also defines the retained data types.
 * 输入 / Inputs: value: T
 * 输出 / Returns: T；结果来自 / values from `JSON.parse(text) as T`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `text === undefined`; 异常 / errors `new TypeError('Metadata must be JSON serializable')`.
 */
function capture<T>(value: T): T {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('Metadata must be JSON serializable');
  return JSON.parse(text) as T;
}

/** Existing JSON files remain unchanged: revisions identify their exact bytes,
 * so stale revisions are detected after restart without adding a sidecar/envelope.
 * Revisions are content hashes, not monotonic counters. Domain recovery records
 * remain authoritative for external effects and multi-file transactions. */
export class MetadataStore<T> {
  readonly file: string;
  /**
   * 入口 / Entry: MetadataStore.constructor.
   * 功能：把存储文件规范化为绝对路径，并保存缺失默认值和领域解析器。
   * Purpose: Normalizes the storage file to an absolute path and retains the missing-value factory and domain parser.
   * 输入 / Inputs: file: string; options: { fallback: () => T; parse?: (value: unknown) => T }
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.file`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    file: string,
    private options: {
    /**
     * 签名 / Signature: MetadataStore.constructor.fallback.
     * 功能：为封装元数据快照、修订号与条件替换声明 fallback 的输入与结果契约，所属容器为 MetadataStore.constructor。
     * Purpose: Declares the input/result contract for fallback in MetadataStore.constructor. Module responsibility: Owns snapshots, content revisions and conditional replacement, enforcing conflicts and atomic publication within serialized queues.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: T.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    fallback: () => T;
    /**
     * 签名 / Signature: MetadataStore.constructor.parse.
     * 功能：为封装元数据快照、修订号与条件替换声明 parse 的输入与结果契约，所属容器为 MetadataStore.constructor。
     * Purpose: Declares the input/result contract for parse in MetadataStore.constructor. Module responsibility: Owns snapshots, content revisions and conditional replacement, enforcing conflicts and atomic publication within serialized queues.
     * 输入 / Inputs: value: unknown
     * 输出 / Returns: T.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    parse?: (value: unknown) => T },
  ) {
    this.file = resolve(file);
  }
  /**
   * 入口 / Entry: MetadataStore.parse.
   * 功能：应用可选领域解析器验证并恢复读取值，无解析器时沿用调用者的类型契约。
   * Purpose: Applies an optional domain parser to validate/recover loaded values, otherwise using the caller's type contract.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: T；结果来自 / values from `this.options.parse ? this.options.parse(value) : (value as T)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private parse(value: unknown): T {
    return this.options.parse ? this.options.parse(value) : (value as T);
  }
  /**
   * 入口 / Entry: MetadataStore.load.
   * 功能：读取并解析文件，返回值与精确文本修订；只有 ENOENT 使用缺失默认值。
   * Purpose: Loads/parses the file and returns its value with the exact-text revision; only ENOENT uses the missing-value fallback.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<MetadataSnapshot<T>>；结果来自 / values from `{ value: this.parse(capture(this.options.fallback())), revision: 'missing' }`; `{ value: this.parse(JSON.parse(text)), revision: revision(text) }`.
   * 副作用 / Effects: 更新 / updates `text`.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return { value: this.parse(capture(this.options.fallback())), revision: 'missing' };`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return { value: this.parse(capture(this.options.fallback())), revision: 'missing' };`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async load(): Promise<MetadataSnapshot<T>> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { value: this.parse(capture(this.options.fallback())), revision: 'missing' };
    }
    return { value: this.parse(JSON.parse(text)), revision: revision(text) };
  }
  /**
   * 入口 / Entry: MetadataStore.check.
   * 功能：在提交前拒绝取消或预期修订不匹配，防止旧快照覆盖新值。
   * Purpose: Rejects cancellation or an expected-revision mismatch before commit, preventing stale snapshots from replacing newer values.
   * 输入 / Inputs: current: MetadataRevision; options: MetadataWriteOptions
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `options.expectedRevision !== undefined && options.expectedRevision !== current`; 异常 / errors `new AppError('元数据已改变，请重新读取后重试', 409, 'METADATA_REVISION_CONFLICT')`.
   */
  private check(current: MetadataRevision, options: MetadataWriteOptions) {
    options.signal?.throwIfAborted();
    if (options.expectedRevision !== undefined && options.expectedRevision !== current)
      throw new AppError('元数据已改变，请重新读取后重试', 409, 'METADATA_REVISION_CONFLICT');
  }
  /**
   * 入口 / Entry: MetadataStore.read.
   * 功能：在同文件串行队列中取得元数据快照和内容修订号。
   * Purpose: Obtains a metadata snapshot and content revision inside the file's serialized queue.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: Promise<MetadataSnapshot<T>>；结果来自 / values from `serializedMetadata(this.file, false, async () => { signal?.throwIfAborted(); return this.load(); })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  read(signal?: AbortSignal): Promise<MetadataSnapshot<T>> {
    return serializedMetadata(this.file, false, async () => {
      signal?.throwIfAborted();
      return this.load();
    });
  }
  /**
   * 入口 / Entry: MetadataStore.replace.
   * 功能：立即捕获替换值，在串行队列中核对修订并原子发布解析后的完整快照。
   * Purpose: Captures the replacement immediately, checks revision in the serialized queue and atomically publishes the parsed full snapshot.
   * 设计：发布前执行 beforeCommit 并再查取消；修订根据实际发布文本计算，无独立修订文件。
   * Design: Runs beforeCommit and rechecks cancellation before publication; revision is computed from published text without a separate revision file.
   * 输入 / Inputs: value: T; options: MetadataWriteOptions default={}
   * 输出 / Returns: Promise<MetadataSnapshot<T>>；结果来自 / values from `serializedMetadata(this.file, true, async (mark) => { options.signal?.throwIfAborted(); if (options.expectedRevision !== unde…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  replace(value: T, options: MetadataWriteOptions = {}): Promise<MetadataSnapshot<T>> {
    // Capture immediately, not when an earlier queued write finishes.
    const snapshot = capture(value);
    /**
     * 入口 / Entry: MetadataStore.replace.callback@66.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serializedMetadata）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serializedMetadata).
     * 输入 / Inputs: mark
     * 输出 / Returns: `{ value: next, revision: revision(text) }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return serializedMetadata(this.file, true, async (mark) => {
      options.signal?.throwIfAborted();
      if (options.expectedRevision !== undefined) this.check((await this.load()).revision, options);
      const next = this.parse(snapshot);
      const text = JSON.stringify(next, null, 2);
      options.signal?.throwIfAborted();
      await atomicMetadataWrite(
        this.file,
        text,
        async () => {
          options.signal?.throwIfAborted();
          await options.beforeCommit?.();
        },
        mark,
        options.signal,
      );
      return { value: next, revision: revision(text) };
    });
  }
  /**
   * 入口 / Entry: MetadataStore.update.
   * 功能：锁定文件队列后加载最新值，执行可异步编辑器，再原子提交编辑后的快照及编辑器结果。
   * Purpose: Loads the latest value under the file queue, runs an optionally asynchronous editor, then atomically commits its snapshot and editor result.
   * 设计：编辑器与条件检查共享同一串行槽位，避免读改写丢失更新；提交检查不得重新进入这个文件队列。
   * Design: Editor and conditional checks share one serial slot to avoid lost updates; commit checks must not reenter this file queue.
   * 输入 / Inputs: edit: (value: T) => R | Promise<R>; options: MetadataWriteOptions default={}
   * 输出 / Returns: Promise<MetadataSnapshot<T> & { result: R }>；结果来自 / values from `serializedMetadata(this.file, true, async (mark) => { options.signal?.throwIfAborted(); const current = await this.load(); th…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  update<R>(
    edit: (value: T) => R | Promise<R>,
    options: MetadataWriteOptions = {},
  ): Promise<MetadataSnapshot<T> & { result: R }> {
    /**
     * 入口 / Entry: MetadataStore.update.callback@89.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serializedMetadata）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serializedMetadata).
     * 输入 / Inputs: mark
     * 输出 / Returns: `{ value: next, revision: revision(JSON.stringify(next, null, 2)), result }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return serializedMetadata(this.file, true, async (mark) => {
      options.signal?.throwIfAborted();
      const current = await this.load();
      this.check(current.revision, options);
      const result = await edit(current.value);
      const next = this.parse(capture(current.value));
      options.signal?.throwIfAborted();
      await atomicMetadataWrite(
        this.file,
        JSON.stringify(next, null, 2),
        async () => {
          options.signal?.throwIfAborted();
          await options.beforeCommit?.();
        },
        mark,
        options.signal,
      );
      return { value: next, revision: revision(JSON.stringify(next, null, 2)), result };
    });
  }
  /**
   * 入口 / Entry: MetadataStore.remove.
   * 功能：在同文件队列中核对条件修订和取消后删除元数据文件。
   * Purpose: Deletes the metadata file after checking conditional revision and cancellation in the same-file queue.
   * 设计：物理删除前 mark 表示发布阶段已开始，删除失败会被 flush 保留，而不是当作未执行的条件拒绝。
   * Design: Marks publication before physical deletion so flush retains deletion failures rather than treating them as pre-effect conditional refusals.
   * 输入 / Inputs: options: MetadataWriteOptions default={}
   * 输出 / Returns: `serializedMetadata(this.file, true, async (mark) => { options.signal?.throwIfAborted(); if (options.expectedRevision !== unde…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  remove(options: MetadataWriteOptions = {}) {
    /**
     * 入口 / Entry: MetadataStore.remove.callback@110.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（serializedMetadata）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (serializedMetadata).
     * 输入 / Inputs: mark
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `rm`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return serializedMetadata(this.file, true, async (mark) => {
      options.signal?.throwIfAborted();
      if (options.expectedRevision !== undefined) this.check((await this.load()).revision, options);
      options.signal?.throwIfAborted();
      mark();
      await rm(this.file, { force: true });
    });
  }
  /** Wait for already admitted work; report the last uncorrected write failure. */
  /**
   * 入口 / Entry: MetadataStore.flush.
   * 功能：等待当前文件已准入操作，并报告最近尚未纠正的物理写入失败。
   * Purpose: Waits for admitted operations on this file and reports the latest uncorrected physical-write failure.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async flush() {
    await flushMetadataFile(this.file);
  }
}

/**
 * 入口 / Entry: metadataFile.
 * 功能：构造带缺失默认值与可选领域解析器的元数据存储适配器。
 * Purpose: Constructs a metadata-store adapter with a missing-value factory and optional domain parser.
 * 输入 / Inputs: file: string; fallback: () => T; parse: (value: unknown) => T optional
 * 输出 / Returns: `new MetadataStore(file, { fallback, parse })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function metadataFile<T>(file: string, fallback: () => T, parse?: (value: unknown) => T) {
  return new MetadataStore(file, { fallback, parse });
}

/** Compatibility adapter for callers whose domain lock already captures a full snapshot. */
/**
 * 入口 / Entry: replaceMetadata.
 * 功能：为已有领域快照调用方提供兼容的条件替换入口。
 * Purpose: Provides a compatible conditional-replacement entry for callers already holding a domain snapshot.
 * 输入 / Inputs: file: string; value: T; options: MetadataWriteOptions optional
 * 输出 / Returns: `metadataFile(file, () => value).replace(value, options)`.
 * 副作用 / Effects: `metadataFile().replace`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function replaceMetadata<T>(file: string, value: T, options?: MetadataWriteOptions) {
  return metadataFile(file, () => value).replace(value, options);
}
