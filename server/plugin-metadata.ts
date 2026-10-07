/**
 * 模块职责：保存插件元数据回执，校验回执结构后供插件管理及恢复流程使用。
 * Module purpose: Persists validated plugin metadata receipts for management and recovery workflows.
 */
import type { MetadataSnapshot, MetadataWriteOptions } from './metadata-store.ts';
import { MetadataStore } from './metadata-store.ts';
import { pluginDataFile } from './plugin-data.ts';
import type { PluginScope } from './plugin-scope.ts';
import { storageRuntime } from './storage-runtime.ts';
import { randomUUID } from 'node:crypto';

export type PluginMetadata<T = unknown> = Readonly<{
  name: string;
  /**
   * 签名 / Signature: PluginMetadata.read.
   * 功能：为保存插件元数据回执声明 read 的输入与结果契约，所属容器为 PluginMetadata。
   * Purpose: Declares the input/result contract for read in PluginMetadata. Module responsibility: Persists validated plugin metadata receipts for management and recovery workflows.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: Promise<MetadataSnapshot<T>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  read(signal?: AbortSignal): Promise<MetadataSnapshot<T>>;
  /**
   * 签名 / Signature: PluginMetadata.replace.
   * 功能：为保存插件元数据回执声明 replace 的输入与结果契约，所属容器为 PluginMetadata。
   * Purpose: Declares the input/result contract for replace in PluginMetadata. Module responsibility: Persists validated plugin metadata receipts for management and recovery workflows.
   * 输入 / Inputs: value: T; options: MetadataWriteOptions optional
   * 输出 / Returns: Promise<MetadataSnapshot<T>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  replace(value: T, options?: MetadataWriteOptions): Promise<MetadataSnapshot<T>>;
}>;
const references = new WeakMap<object, string>();
/** Only host-side domain constructors resolve an opaque metadata reference. */
/**
 * 入口 / Entry: metadataPath.
 * 功能：在保存插件元数据回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` / `path` 供上层消费（`plugin-metadata.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-metadata.ts`; this entry produces `value` / `path` for its caller. Module context: Persists validated plugin metadata receipts for management and recovery workflows.
 * 处理：通过 `references.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `references.get`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `typeof value === 'string'`.
 * 输入 / Inputs: value: string | PluginMetadata
 * 输出 / Returns: string；结果来自 / values from `value`; `path`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!path`; 异常 / errors `new Error('插件元数据回执无效')`.
 */
export function metadataPath(value: string | PluginMetadata): string {
  if (typeof value === 'string') return value;
  const path = references.get(value);
  if (!path) throw new Error('插件元数据回执无效');
  return path;
}
/**
 * 入口 / Entry: pluginMetadata.
 * 功能：从当前输入或状态计算 `Object.freeze({ reference<T = unknown>(name: string, fallback: () => T = () => null as T): PluginMetadata<T> { const file = p…`，供调用方后续验证或使用。
 * Purpose: Computes `Object.freeze({ reference<T = unknown>(name: string, fallback: () => T = () => null as T): PluginMetadata<T> { const file = p…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: pluginId: string; owner: string; scope: PluginScope; run: <T>(permission: string, work: () => T) => T
 * 输出 / Returns: `Object.freeze({ reference<T = unknown>(name: string, fallback: () => T = () => null as T): PluginMetadata<T> { const file = p…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function pluginMetadata(pluginId: string, owner: string, scope: PluginScope,
  run: <T>(permission: string, work: () => T) => T) {
  return Object.freeze({
    /**
     * 入口 / Entry: pluginMetadata.reference.
     * 功能：在保存插件元数据回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `handle` 供上层消费（`plugin-metadata.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-metadata.ts`; this entry produces `handle` for its caller. Module context: Persists validated plugin metadata receipts for management and recovery workflows.
     * 处理：通过 `pluginDataFile`, `references.set`, `scope.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `pluginDataFile`, `references.set`, `scope.add`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: name: string; fallback: () => T default=() => null as T
     * 输出 / Returns: PluginMetadata<T>；结果来自 / values from `handle`.
     * 副作用 / Effects: `references.set`; `scope.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    reference<T = unknown>(name: string, fallback: () => T = () => null as T): PluginMetadata<T> {
      const file = pluginDataFile(pluginId, name), store = new MetadataStore(file, { fallback });
      /**
       * 入口 / Entry: pluginMetadata.reference.signal.
       * 功能：从当前输入或状态计算 `input ? AbortSignal.any([scope.signal, input]) : scope.signal`，供调用方后续验证或使用。
       * Purpose: Computes `input ? AbortSignal.any([scope.signal, input]) : scope.signal` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: input: AbortSignal optional
       * 输出 / Returns: `input ? AbortSignal.any([scope.signal, input]) : scope.signal`.
       * 副作用 / Effects: `AbortSignal.any`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const signal = (input?: AbortSignal) => input ? AbortSignal.any([scope.signal, input]) : scope.signal;
      const handle = Object.freeze({ name,
        /**
         * 入口 / Entry: pluginMetadata.reference.read.
         * 功能：把本层请求转交 `scope.run`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `scope.run` and propagates the provider result or rejection.
         * 输入 / Inputs: input: AbortSignal optional
         * 输出 / Returns: `scope.run(() => run('metadata', () => store.read(signal(input))))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        read: (input?: AbortSignal) => scope.run(() => run('metadata', () => store.read(signal(input)))),
        /**
         * 入口 / Entry: pluginMetadata.reference.replace.
         * 功能：把本层请求转交 `scope.run`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `scope.run` and propagates the provider result or rejection.
         * 输入 / Inputs: value: T; options: MetadataWriteOptions default={}
         * 输出 / Returns: `scope.run(() => run('metadata', () => store.replace(value, { ...options, signal: signal(options.signal), beforeCommit: async …`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        replace: (value: T, options: MetadataWriteOptions = {}) => scope.run(() => run('metadata', () => store.replace(value,
          { ...options, signal: signal(options.signal),
          /**
           * 入口 / Entry: pluginMetadata.reference.beforeCommit.
           * 功能：在保存插件元数据回执中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`plugin-metadata.ts`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-metadata.ts`; the calls and state transitions below complete the operation. Module context: Persists validated plugin metadata receipts for management and recovery workflows.
           * 处理：通过 `options.beforeCommit`, `run` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `options.beforeCommit`, `run`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          beforeCommit: async () => { await options.beforeCommit?.(); run('metadata', () => {}); } }))),
      });
      references.set(handle, file); scope.add(() => store.flush()); return handle;
    },
    /**
     * 入口 / Entry: pluginMetadata.run.
     * 功能：在保存插件元数据回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `scope.run(() => run('metadata', () => storageRuntime.run({ owner, taskId: randomUUID(), label: '插件元数据', paths: [file], mode: …` 供上层消费（`plugin-metadata.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-metadata.ts`; this entry produces `scope.run(() => run('metadata', () => storageRuntime.run({ owner, taskId: randomUUID(), label: '插件元数据', paths: [file], mode: …` for its caller. Module context: Persists validated plugin metadata receipts for management and recovery workflows.
     * 处理：通过 `pluginDataFile`, `scope.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `pluginDataFile`, `scope.run`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: name: string; work: (signal: AbortSignal) => Promise<T>
     * 输出 / Returns: Promise<T>；结果来自 / values from `scope.run(() => run('metadata', () => storageRuntime.run({ owner, taskId: randomUUID(), label: '插件元数据', paths: [file], mode: …`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    run<T>(name: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const file = pluginDataFile(pluginId, name);
      return scope.run(() => run('metadata', () => storageRuntime.run({ owner, taskId: randomUUID(),
        label: '插件元数据', paths: [file], mode: 'write', buffers: 256 * 1024, files: 1, signal: scope.signal }, () => work(scope.signal))));
    },
  });
}
