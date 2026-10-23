/**
 * 模块职责：导入、导出和克隆实例包；校验清单、磁盘与签名，传输及暂存受存储预算约束。
 * Module purpose: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
 */
import type { SignedBundlesV1, StorageRuntimeV1, TrustedBootServiceV1 } from './service-contracts/v1.ts';
import { noHostServices, type HostServiceResolver } from './host-service-contracts.ts';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { createSchema, type VMRecord } from '../shared/contracts/vm.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectSchema } from './project-config.ts';
import { projectIdSchema, projectIndexSchema } from './project-catalog.ts';
import ssh2 from 'ssh2';
import { ByteRate } from './byte-rate.ts';
import { bundleSignatureSchema, verifySignedManifest } from './signed-bundles.ts';
import { diskEncryptionSchema, encryptedImageOptions, qemuSecretObject } from './disk-encryption.ts';
import { Secrets } from './secrets.ts';
import { DesktopBindings, desktopBindingSchema } from './desktop-binding.ts';
import { x11ClipboardConfiguration } from './x11-clipboard.ts';
import { writeStore } from './local-store.ts';
import { storageRuntime, storageGrowth, type StorageLease } from './storage-runtime.ts';

import {
  decodeTrustedBootArchive,
  encodeTrustedBootArchive,
  trustedBootArchiveSchema,
  type TrustedBootFiles,
} from './trusted-boot-archive.ts';

const MAGIC = Buffer.from('SAKURA01');
const MAX_BUNDLE = 32 * 1024 ** 3;
export const MAX_BUNDLE_MANIFEST = 8 * 1024 ** 2;

/** A receiver with no bytes must not hold a device writer while its sender is
 * queued behind another outbound transfer. Observe the paused source's existing
 * buffer without consuming/copying a chunk; disk staging starts after admission. */
/**
 * 入口 / Entry: incomingBundle.
 * 功能：在导入、导出和克隆实例包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await work(active)` 供上层消费（`bundles.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `bundles.ts`; this entry produces `await work(active)` for its caller. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
 * 处理：通过 `AbortSignal.any`, `source.on`, `active.throwIfAborted`, `once` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `AbortSignal.any`, `source.on`, `active.throwIfAborted`, `once`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!source.readableLength && !source.readableEnded`.
 * 输入 / Inputs: source: Readable; signal: AbortSignal | undefined; work: (active: AbortSignal) => Promise<T>
 * 输出 / Returns: Promise<T>；结果来自 / values from `await work(active)`.
 * 副作用 / Effects: `AbortSignal.any`; `source.destroy`.
 * 拒绝 / Refusals: 条件 / conditions `source.destroyed`; `!source.readableLength`; 异常 / errors `source.errored || new AppError('导入包输入流已关闭', 400)`; `new AppError('导入包不完整或磁盘校验失败')`.
 * 收尾：退出 try 区域时始终执行 `source.off('error', failed);`; `source.off('close', closed);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `source.off('error', failed);`; `source.off('close', closed);`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `const failure = active.aborted ? active.reason : error;`; `source.destroy();`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `const failure = active.aborted ? active.reason : error;`; `source.destroy();`; these statements determine whether a failure is absorbed or rejected again.
 */
async function incomingBundle<T>(
  source: Readable,
  signal: AbortSignal | undefined,
  work: (active: AbortSignal) => Promise<T>,
): Promise<T> {
  const transport = new AbortController();
  const active = signal ? AbortSignal.any([signal, transport.signal]) : transport.signal;
  /**
   * 入口 / Entry: incomingBundle.failed.
   * 功能：把本层请求转交 `transport.abort`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `transport.abort` and propagates the provider result or rejection.
   * 输入 / Inputs: error: Error
   * 输出 / Returns: `transport.abort(error)`.
   * 副作用 / Effects: `transport.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const failed = (error: Error) => transport.abort(error);
  /**
   * 入口 / Entry: incomingBundle.closed.
   * 功能：在导入、导出和克隆实例包中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`bundles.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `bundles.ts`; the calls and state transitions below complete the operation. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
   * 处理：通过 `failed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `failed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!source.readableEnded`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const closed = () => {
    if (!source.readableEnded) failed(new AppError('导入包输入流提前关闭', 400));
  };
  source.on('error', failed);
  source.on('close', closed);
  try {
    active.throwIfAborted();
    if (source.destroyed) throw source.errored || new AppError('导入包输入流已关闭', 400);
    if (!source.readableLength && !source.readableEnded) await once(source, 'readable', { signal: active });
    active.throwIfAborted();
    if (!source.readableLength) throw new AppError('导入包不完整或磁盘校验失败');
    return await work(active);
  } catch (error) {
    const failure = active.aborted ? active.reason : error;
    source.destroy();
    await finished(source, { cleanup: true }).catch(() => {});
    throw failure;
  } finally {
    source.off('error', failed);
    source.off('close', closed);
  }
}

const manifestSchema = z
  .object({
    version: z.literal(1),
    config: createSchema,
    managedNetwork: z.literal('isolated').optional(),
    project: projectSchema.optional(),
    projects: z
      .object({
        active: z.string().regex(/^(default|[a-f0-9]{16})$/),
        projects: z
          .array(z.object({ id: projectIdSchema, name: z.string().trim().min(1).max(64) }).strict())
          .min(1)
          .max(20),
        configs: z.record(z.string(), projectSchema),
      })
      .strict()
      .refine(
        (value) =>
          new Set(value.projects.map((entry) => entry.id)).size === value.projects.length &&
          value.projects.some((entry) => entry.id === 'default') &&
          value.projects.some((entry) => entry.id === value.active),
        '项目目录损坏',
      )
      .optional(),
    pendingResize: z.boolean().default(false),
    diskEncryption: diskEncryptionSchema.optional(),
    trustedBoot: trustedBootArchiveSchema.optional(),
    desktopBinding: desktopBindingSchema.optional(),
    x11Clipboard: x11ClipboardConfiguration.optional(),
    waylandClipboard: x11ClipboardConfiguration.optional(),
    key: z.string().max(16384),
    seed: z.string().max(262144),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    signature: bundleSignatureSchema.optional(),
  })
  .strict();
/**
 * 入口 / Entry: validateDiskHeader.
 * 功能：在导入、导出和克隆实例包中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`bundles.ts`）。
 * Purpose: Checks admission, input or resource ownership in `bundles.ts`; the calls and state transitions below complete the operation. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
 * 处理：通过 `header.readUInt32BE`, `inline.includes`, `header.readBigUInt64BE` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `header.readUInt32BE`, `inline.includes`, `header.readBigUInt64BE`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: header: Buffer; allowEncryption: default=false
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `header.length < 104 || header.readUInt32BE(0) !== 0x514649fb || ![2, 3].includes(header.readUInt32BE(4))`; `header.readBigUInt64BE(8) !== 0n || header.readUInt32BE(16) !== 0`; `header.readUInt32BE(32) !== (allowEncryption ? 2 : 0)`; 异常 / errors `new AppError('需要 QCOW2 磁盘')`; `new AppError('导入磁盘不能依赖外部基础镜像')`.
 */
export function validateDiskHeader(header: Buffer, allowEncryption = false) {
  if (
    header.length < 104 ||
    header.readUInt32BE(0) !== 0x514649fb ||
    ![2, 3].includes(header.readUInt32BE(4))
  )
    throw new AppError('需要 QCOW2 磁盘');
  if (header.readBigUInt64BE(8) !== 0n || header.readUInt32BE(16) !== 0)
    throw new AppError('导入磁盘不能依赖外部基础镜像');
  if (header.readUInt32BE(32) !== (allowEncryption ? 2 : 0))
    throw new AppError('磁盘加密格式与导入清单不一致');
  if (header.readUInt32BE(4) === 3 && (header.readBigUInt64BE(72) & 4n) !== 0n)
    throw new AppError('不支持外部数据文件');
  if (header.readBigUInt64BE(24) > 128n * 1024n ** 3n) throw new AppError('虚拟磁盘不能超过 128 GiB');
}
export class Bundles {
  /**
   * 入口 / Entry: Bundles.trustedBoot.
   * 功能：把本层请求转交 `this.dependencies.optional`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.dependencies.optional` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: TrustedBootServiceV1 | undefined；结果来自 / values from `this.dependencies.optional('trustedBoot')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get trustedBoot(): TrustedBootServiceV1 | undefined { return this.dependencies.optional('trustedBoot'); }
  /**
   * 入口 / Entry: Bundles.constructor.
   * 功能：建立 Bundles 的导入、导出和克隆实例包上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Bundles context for this module's responsibility: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; signatures: SignedBundlesV1 optional; dependencies: HostServiceResolver default=noHostServices
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private signatures?: SignedBundlesV1,
    private dependencies: HostServiceResolver = noHostServices,
  ) {}
  
  /**
   * 入口 / Entry: Bundles.project.
   * 功能：在导入、导出和克隆实例包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8')))` / `undefined` 供上层消费（`Bundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Bundles`; this entry produces `projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8')))` / `undefined` for its caller. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
   * 处理：通过 `projectSchema.parse`, `readFile`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectSchema.parse`, `readFile`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8')))`; `undefined`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return undefined;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return undefined;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async project(id: string) {
    try {
      return projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), 'project.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  /**
   * 入口 / Entry: Bundles.x11Clipboard.
   * 功能：在导入、导出和克隆实例包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `x11ClipboardConfiguration.parse( JSON.parse(await readFile(join(vmDir(id), `${transport}-clipboard.json`), 'utf8')), )` / `undefined` 供上层消费（`Bundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Bundles`; this entry produces `x11ClipboardConfiguration.parse( JSON.parse(await readFile(join(vmDir(id), `${transport}-clipboard.json`), 'utf8')), )` / `undefined` for its caller. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
   * 处理：通过 `x11ClipboardConfiguration.parse`, `readFile`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `x11ClipboardConfiguration.parse`, `readFile`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; transport: 'x11' | 'wayland' default='x11'
   * 输出 / Returns: `x11ClipboardConfiguration.parse( JSON.parse(await readFile(join(vmDir(id), `${transport}-clipboard.json`), 'utf8')), )`; `undefined`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return undefined;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return undefined;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async x11Clipboard(id: string, transport: 'x11' | 'wayland' = 'x11') {
    try {
      return x11ClipboardConfiguration.parse(
        JSON.parse(await readFile(join(vmDir(id), `${transport}-clipboard.json`), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  /**
   * 入口 / Entry: Bundles.projectCatalog.
   * 功能：在导入、导出和克隆实例包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ active: index.active, projects: index.projects, configs }` / `undefined` 供上层消费（`Bundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Bundles`; this entry produces `{ active: index.active, projects: index.projects, configs }` / `undefined` for its caller. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
   * 处理：通过 `projectIndexSchema.parse`, `readFile`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectIndexSchema.parse`, `readFile`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ active: index.active, projects: index.projects, configs }`; `undefined`.
   * 副作用 / Effects: 更新 / updates `configs[entry.id]`.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; 异常 / errors `error`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return undefined;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `return undefined;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async projectCatalog(id: string) {
    try {
      const index = projectIndexSchema.parse(
        JSON.parse(await readFile(join(vmDir(id), 'projects.json'), 'utf8')),
      );
      const configs: Record<string, ReturnType<typeof projectSchema.parse>> = {};
      for (const entry of index.projects) {
        const file = entry.id === 'default' ? 'project.json' : `project-${entry.id}.json`;
        try {
          configs[entry.id] = projectSchema.parse(JSON.parse(await readFile(join(vmDir(id), file), 'utf8')));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return { active: index.active, projects: index.projects, configs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }
  /**
   * 入口 / Entry: Bundles.temp.
   * 功能：在导入、导出和克隆实例包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `mkdtemp(join(DATA, 'transfers', 'bundle-'))` 供上层消费（`Bundles`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Bundles`; this entry produces `mkdtemp(join(DATA, 'transfers', 'bundle-'))` for its caller. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
   * 处理：通过 `mkdir`, `join`, `mkdtemp` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mkdir`, `join`, `mkdtemp`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `mkdtemp(join(DATA, 'transfers', 'bundle-'))`.
   * 副作用 / Effects: `mkdir`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async temp() {
    await mkdir(join(DATA, 'transfers'), { recursive: true });
    return mkdtemp(join(DATA, 'transfers', 'bundle-'));
  }
  /**
   * 入口 / Entry: Bundles.export.
   * 功能：把本层请求转交 `this.withExportBudget`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.withExportBudget` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; target: Writable; headers: () => void; signal: AbortSignal optional; bytesPerSecond: default=0; snapshotId: string optional; onCleanupError: (error: unknown) => void optional
   * 输出 / Returns: `this.withExportBudget( id, active, (bytes, exportFile) => storageRuntime.run( { owner: 'core:bundle-export', taskId: 'bundle-…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async export(
    id: string,
    target: Writable,
    headers: () => void,
    signal?: AbortSignal,
    bytesPerSecond = 0,
    snapshotId?: string,
    onCleanupError?: (error: unknown) => void,
  ) {
    const active = signal || new AbortController().signal;
    /**
     * 入口 / Entry: Bundles.export.callback@202.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
     * 输入 / Inputs: lease
     * 输出 / Returns: `await exportFile(target, headers, bytesPerSecond, (error) => { lease.cleanupPending(error); onCleanupError?.(error); })`.
     * 副作用 / Effects: `target.destroy`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 收尾：退出 try 区域时始终执行 `if (!target.writableFinished) target.destroy();`; `await finished(target).catch(() => {});`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (!target.writableFinished) target.destroy();`; `await finished(target).catch(() => {});`; these steps also apply to exceptional exits.
     */
    return this.withExportBudget(
      id,
      active,
      (bytes, exportFile) =>
        storageRuntime.run(
          {
            owner: 'core:bundle-export',
            taskId: 'bundle-export:' + id,
            label: 'Export independent VM disk',
            mode: 'write',
            transfer: 'outbound',
            paths: [vmDir(id), DATA],
            buffers: 20 * 1024 ** 2,
            files: 8,
            signal: active,
            temporary: [{ path: DATA, bytes }],
          },
          /**
           * 中文功能：向请求流导出包并记录清理异常；仅销毁未完成写入的请求，随后等待流结束。
           * English: Exports the bundle to the request stream and records cleanup failures, destroying only unfinished writes and then awaiting stream completion.
           * 所属 / Owner: Bundles.export.
           * 输入 / Inputs: lease.
           * 设计：已写完 ClientRequest 仍等待对端发布回执，finally 不可销毁它导致成功上传后的响应被重置。
           * Design: A finished ClientRequest still awaits the peer publication receipt; destroying it in finally would reset the response after a successful upload.
           */
          async (lease) => {
            try {
              return await exportFile(target, headers, bytesPerSecond, (error) => {
                lease.cleanupPending(error);
                onCleanupError?.(error);
              });
            } finally {
              // A finished ClientRequest still awaits its peer's publication receipt.
              // Destroying it here would reset that response after a successful upload.
              if (!target.writableFinished) target.destroy();
              await finished(target).catch(() => {});
            }
          },
        ),
      storageRuntime,
      snapshotId,
    );
  }
  /** Measure the actual compact QCOW2 output while holding the same VM lock as
   * conversion. A queued storage admission cannot invalidate the measured disk. */
  /**
   * 入口 / Entry: Bundles.withExportBudget.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; signal: AbortSignal; work: ( diskBytes: number, exportFile: ( target: Writable, headers: () => void, bytesPerSec…; storage: StorageRuntimeV1 default=storageRuntime; snapshotId: string optional
   * 输出 / Returns: `this.machines.locked(id, async () => { this.machines.requireStopped(id); signal.throwIfAborted(); const vm = this.machines.ge…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async withExportBudget<T>(
    id: string,
    signal: AbortSignal,
    work: (
      diskBytes: number,
      exportFile: (
        target: Writable,
        headers: () => void,
        bytesPerSecond?: number,
        onCleanupError?: (error: unknown) => void,
      ) => Promise<string>,
    ) => Promise<T>,
    storage: StorageRuntimeV1 = storageRuntime,
    snapshotId?: string,
  ) {
    /**
     * 入口 / Entry: Bundles.withExportBudget.callback@237.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `work(bytes, (target, headers, rate = 0, cleanup) => this.exportLocked(id, target, headers, signal, rate, snapshotId, cleanup)…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `snapshotId && !vm.snapshots.some((item) => item.id === snapshotId)`; `typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_BUNDLE`; 异常 / errors `new AppError('快照不存在', 404)`; `new AppError('无法为导出的 QCOW2 磁盘确认空间预算', 507, 'STORAGE_SPACE_REQUIRED')`.
     */
    return this.machines.locked(id, async () => {
      this.machines.requireStopped(id);
      signal.throwIfAborted();
      const vm = this.machines.get(id);
      if (snapshotId && !vm.snapshots.some((item) => item.id === snapshotId))
        throw new AppError('快照不存在', 404);
      const measure = await storage.run(
        {
          owner: 'core:backup-measure',
          taskId: 'backup-measure:' + id,
          label: 'Measure compact backup disk',
          mode: 'read',
          paths: [vmDir(id), DATA],
          buffers: 256 * 1024,
          files: 2,
          signal,
        },
        async () =>
          vm.diskEncryption
            ? await this.machines.withDiskSecret(vm, (secret) =>
                this.machines.engine.run(
                  'sakura-img',
                  [
                    'measure',
                    '--output=json',
                    '--object',
                    qemuSecretObject(secret),
                    '--image-opts',
                    '-O',
                    'qcow2',
                    '-o',
                    'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
                    ...(snapshotId ? ['-l', snapshotId] : []),
                    encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
                  ],
                  { signal },
                ),
              )
            : await this.machines.engine.run(
                'sakura-img',
                [
                  'measure',
                  '--output=json',
                  '-f',
                  'qcow2',
                  '-O',
                  'qcow2',
                  ...(snapshotId ? ['-l', snapshotId] : []),
                  join(vmDir(id), 'disk.qcow2'),
                ],
                { signal },
              ),
      );
      const bytes: unknown = JSON.parse(measure).required;
      if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_BUNDLE)
        throw new AppError('无法为导出的 QCOW2 磁盘确认空间预算', 507, 'STORAGE_SPACE_REQUIRED');
      signal.throwIfAborted();
      return work(bytes, (target, headers, rate = 0, cleanup) =>
        this.exportLocked(id, target, headers, signal, rate, snapshotId, cleanup),
      );
    });
  }
  /**
   * 入口 / Entry: Bundles.exportLocked.
   * 功能：从锁定的停止实例导出磁盘、清单和可信启动相关状态为实例包流。
   * Purpose: Exports disk, manifest and trusted-boot state from a locked stopped VM into a bundle stream.
   * 设计：存储准入先于输出，校验摘要和受管附属文件；数据流背压与取消共享作用域，避免暂存副本失去归属。
   * Design: Storage admission precedes output; digests/managed attachments are verified and backpressure/cancellation retain staging ownership.
   * 输入 / Inputs: id: string; target: Writable; headers: () => void; signal: AbortSignal optional; bytesPerSecond: default=0; snapshotId: string optional; onCleanupError: (error: unknown) => void optional
   * 输出 / Returns: `unsigned.sha256`.
   * 副作用 / Effects: `createHash`; `createReadStream`; `hash.update`; `length.writeUInt32BE`; `rm`.
   * 拒绝 / Refusals: 条件 / conditions `snapshotId && !snapshot`; `manifest.length > MAX_BUNDLE_MANIFEST || (await stat(disk)).size + manifest.length + 12 > MAX_BUNDLE`; 异常 / errors `new AppError('快照不存在', 404)`; `new AppError('当前导出包超过大小上限')`.
   * 收尾：退出 try 区域时始终执行 `try { await rm(dir, { recursive: true, force: true }); } catch (error) { onCleanupError?.(error); throw error; }`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { await rm(dir, { recursive: true, force: true }); } catch (error) { onCleanupError?.(error); throw error; }`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `onCleanupError?.(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `onCleanupError?.(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async exportLocked(
    id: string,
    target: Writable,
    headers: () => void,
    signal?: AbortSignal,
    bytesPerSecond = 0,
    snapshotId?: string,
    onCleanupError?: (error: unknown) => void,
  ) {
    this.machines.requireStopped(id);
    const vm = this.machines.get(id);
    const snapshot = snapshotId ? vm.snapshots.find((item) => item.id === snapshotId) : undefined;
    if (snapshotId && !snapshot) throw new AppError('快照不存在', 404);
    const trustedBoot = await this.trustedBoot?.capture(id, snapshotId);
    const dir = await this.temp();
    try {
      const disk = join(dir, 'disk.qcow2');
      if (vm.diskEncryption)
        await this.machines.withDiskSecret(vm, (secret) =>
          this.machines.engine.run(
            'sakura-img',
            [
              'convert',
              '--object',
              qemuSecretObject(secret),
              '--image-opts',
              '-O',
              'qcow2',
              '-o',
              'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
              ...(snapshotId ? ['-l', snapshotId] : []),
              encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
              disk,
            ],
            { timeoutMs: 1800000, signal },
          ),
        );
      else
        await this.machines.engine.run(
          'sakura-img',
          [
            'convert',
            '-f',
            'qcow2',
            '-O',
            'qcow2',
            ...(snapshotId ? ['-l', snapshotId] : []),
            join(vmDir(id), 'disk.qcow2'),
            disk,
          ],
          { timeoutMs: 1800000, signal },
        );
      signal?.throwIfAborted();
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(disk)) {
        signal?.throwIfAborted();
        hash.update(chunk);
      }
      const {
        name,
        memoryMiB,
        cpus,
        diskGiB,
        accelerator,
        forwards,
        distro,
        architecture,
        template,
        hardware,
        firmware,
        pendingResize,
      } = this.machines.get(id);
      const identity = await this.machines.snapshotIdentity(id, snapshotId);
      const unsigned = manifestSchema.parse({
        version: 1,
        managedNetwork: vm.managedNetwork === 'isolated' ? 'isolated' : undefined,
        desktopBinding: (await new DesktopBindings(this.machines).read(id)) || undefined,
        x11Clipboard: await this.x11Clipboard(id),
        waylandClipboard: await this.x11Clipboard(id, 'wayland'),
        config: {
          name,
          memoryMiB,
          cpus,
          diskGiB: snapshot?.diskGiB || diskGiB,
          accelerator,
          forwards,
          distro,
          architecture,
          template,
          hardware,
          firmware,
        },
        project: await this.project(id),
        projects: await this.projectCatalog(id),
        ...((snapshot ? snapshot.pendingResize : pendingResize) ? { pendingResize: true } : {}),
        ...(vm.diskEncryption ? { diskEncryption: vm.diskEncryption } : {}),
        ...(trustedBoot ? { trustedBoot: encodeTrustedBootArchive(trustedBoot) } : {}),
        key: identity.key,
        seed: identity.seed.toString('base64'),
        sha256: hash.digest('hex'),
      });
      const manifest = Buffer.from(JSON.stringify(this.signatures?.signManifest(unsigned) || unsigned));
      if (
        manifest.length > MAX_BUNDLE_MANIFEST ||
        (await stat(disk)).size + manifest.length + 12 > MAX_BUNDLE
      )
        throw new AppError('当前导出包超过大小上限');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(manifest.length);
      signal?.throwIfAborted();
      headers();
      /**
       * 入口 / Entry: Bundles.exportLocked.contents.
       * 功能：在导入、导出和克隆实例包中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Bundles`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `Bundles`; the calls and state transitions below complete the operation. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
       * 处理：通过 `createReadStream` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `createReadStream`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `createReadStream`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      async function* contents() {
        yield MAGIC;
        yield length;
        yield manifest;
        yield* createReadStream(disk);
      }
      await pipeline(
        Readable.from(contents()),
        new ByteRate(bytesPerSecond).stream(signal || new AbortController().signal),
        target,
        { signal },
      );
      return unsigned.sha256;
    } finally {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        onCleanupError?.(error);
        throw error;
      }
    }
  }
  /**
   * 入口 / Entry: Bundles.import.
   * 功能：把本层请求转交 `this.importCore`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.importCore` and propagates the provider result or rejection.
   * 输入 / Inputs: name: string; source: Readable; signal: AbortSignal optional; beforeAdopt: () => void optional; migrationOrigin: VMRecord['migrationOrigin'] optional; onCleanupError: (error: unknown) => void optional; lease: StorageLease optional
   * 输出 / Returns: `this.importCore(name, source, signal, beforeAdopt, false, migrationOrigin, onCleanupError, lease)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async import(
    name: string,
    source: Readable,
    signal?: AbortSignal,
    beforeAdopt?: () => void,
    migrationOrigin?: VMRecord['migrationOrigin'],
    onCleanupError?: (error: unknown) => void,
    lease?: StorageLease,
  ) {
    return this.importCore(name, source, signal, beforeAdopt, false, migrationOrigin, onCleanupError, lease);
  }
  /**
   * 入口 / Entry: Bundles.importExternal.
   * 功能：把本层请求转交 `this.importCore`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.importCore` and propagates the provider result or rejection.
   * 输入 / Inputs: name: string; source: Readable; signal: AbortSignal optional; lease: StorageLease optional
   * 输出 / Returns: `this.importCore(name, source, signal, undefined, true, undefined, undefined, lease)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async importExternal(name: string, source: Readable, signal?: AbortSignal, lease?: StorageLease) {
    return this.importCore(name, source, signal, undefined, true, undefined, undefined, lease);
  }
  /**
   * 入口 / Entry: Bundles.importCore.
   * 功能：把本层请求转交 `this.withContents`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.withContents` and propagates the provider result or rejection.
   * 输入 / Inputs: name: string; source: Readable; signal: AbortSignal optional; beforeAdopt: () => void optional; external: default=false; migrationOrigin: VMRecord['migrationOrigin'] optional; onCleanupError: (error: unknown) => void optional; lease: StorageLease optional
   * 输出 / Returns: `this.withContents( source, signal, async (disk, manifest, seed, trustedBoot, storage) => { if (trustedBoot && !this.trustedBo…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async importCore(
    name: string,
    source: Readable,
    signal?: AbortSignal,
    beforeAdopt?: () => void,
    external = false,
    migrationOrigin?: VMRecord['migrationOrigin'],
    onCleanupError?: (error: unknown) => void,
    lease?: StorageLease,
  ) {
    /**
     * 入口 / Entry: Bundles.importCore.callback@458.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withContents）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withContents).
     * 输入 / Inputs: disk; manifest; seed; trustedBoot; storage
     * 输出 / Returns: `external && this.signatures ? this.signatures.withAuthorizedExternal(manifest.signature, publish) : publish()`.
     * 副作用 / Effects: `publish`.
     * 拒绝 / Refusals: 条件 / conditions `trustedBoot && !this.trustedBoot`; 异常 / errors `new AppError('TPM 状态恢复服务不可用', 503)`.
     */
    return this.withContents(
      source,
      signal,
      async (disk, manifest, seed, trustedBoot, storage) => {
        if (trustedBoot && !this.trustedBoot) throw new AppError('TPM 状态恢复服务不可用', 503);
        /**
         * 入口 / Entry: Bundles.importCore.publish.
         * 功能：在导入、导出和克隆实例包中，校验并提交领域状态变更；本入口产生 `adopted` 供上层消费（`Bundles`）。
         * Purpose: Validates and commits a domain state change in `Bundles`; this entry produces `adopted` for its caller. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
         * 处理：通过 `signal.throwIfAborted`, `beforeAdopt`, `this.machines.adopt`, `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `beforeAdopt`, `this.machines.adopt`, `writeStore`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `adopted`.
         * 副作用 / Effects: `writeStore`; `this.machines.delete`.
         * 拒绝 / Refusals: 条件 / conditions `manifest.desktopBinding`; `manifest.x11Clipboard`; `manifest.waylandClipboard`; 异常 / errors `error`.
         * 失败处理：catch 分支执行 `await this.machines.delete(adopted.id);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `await this.machines.delete(adopted.id);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
         */
        const publish = async () => {
          signal?.throwIfAborted();
          beforeAdopt?.();
          const adopted = await this.machines.adopt(
            { ...manifest.config, name, forwards: [] },
            disk,
            manifest.key,
            seed,
            manifest.project,
            manifest.pendingResize,
            manifest.projects,
            migrationOrigin ? { ...migrationOrigin, diskSha256: manifest.sha256 } : undefined,
            manifest.diskEncryption,
            undefined,
            storage,
            signal,
          );
          if (manifest.managedNetwork === 'isolated')
            await this.machines.isolateStopped(adopted.id, this.machines.get(adopted.id).createdAt);
          if (manifest.desktopBinding) {
            try {
              await writeStore(join(vmDir(adopted.id), 'desktop-binding.json'), manifest.desktopBinding);
            } catch (error) {
              await this.machines.delete(adopted.id);
              throw error;
            }
          }
          if (manifest.x11Clipboard) {
            try {
              await writeStore(join(vmDir(adopted.id), 'x11-clipboard.json'), manifest.x11Clipboard);
            } catch (error) {
              await this.machines.delete(adopted.id);
              throw error;
            }
          }
          if (manifest.waylandClipboard) {
            try {
              await writeStore(join(vmDir(adopted.id), 'wayland-clipboard.json'), manifest.waylandClipboard);
            } catch (error) {
              await this.machines.delete(adopted.id);
              throw error;
            }
          }
          if (trustedBoot) {
            try {
              await this.trustedBoot!.restore(adopted.id, trustedBoot);
            } catch (error) {
              await this.machines.delete(adopted.id);
              throw error;
            }
          }
          return adopted;
        };
        return external && this.signatures
          ? this.signatures.withAuthorizedExternal(manifest.signature, publish)
          : publish();
      },
      onCleanupError,
      lease,
    );
  }
  /** A verified standalone disk exists only for the duration of the callback. */
  /**
   * 入口 / Entry: Bundles.withDisk.
   * 功能：把本层请求转交 `this.withContents`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.withContents` and propagates the provider result or rejection.
   * 输入 / Inputs: source: Readable; signal: AbortSignal; work: (disk: string, diskEncryption?: VMRecord['diskEncryption']) => Promise<T>; lease: StorageLease optional
   * 输出 / Returns: `this.withContents( source, signal, (disk, manifest) => work(disk, manifest.diskEncryption), undefined, lease, )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async withDisk<T>(
    source: Readable,
    signal: AbortSignal,
    work: (disk: string, diskEncryption?: VMRecord['diskEncryption']) => Promise<T>,
    lease?: StorageLease,
  ) {
    return this.withContents(
      source,
      signal,
      (disk, manifest) => work(disk, manifest.diskEncryption),
      undefined,
      lease,
    );
  }
  /**
   * 入口 / Entry: Bundles.withContents.
   * 功能：受限解析包头、清单和磁盘正文，把已验证内容交给调用方执行导入步骤。
   * Purpose: Parses bounded bundle headers/manifests/disk bodies and hands validated content to the importer.
   * 设计：先检查长度、签名与磁盘格式再使用内容；临时文件始终由当前存储租约管理，异常也执行收尾。
   * Design: Lengths, signatures and disk format are checked before use; the storage lease owns temporary files through failure cleanup.
   * 输入 / Inputs: source: Readable; signal: AbortSignal | undefined; work: ( disk: string, manifest: z.infer<typeof manifestSchema>, seed: Buffer, trustedBoot: …; onCleanupError: (error: unknown) => void optional; lease: StorageLease optional
   * 输出 / Returns: Promise<T>；结果来自 / values from `incomingBundle(source, signal, (active) => storageRuntime.run( { owner: 'core:bundle-import', taskId: 'bundle-import:' + rand…`; `await work(disk, manifest, seed, trustedBoot, lease)`.
   * 副作用 / Effects: `createHash`; `createWriteStream`; `handle.close`; `rm`; `lease.releaseTemporary`.
   * 拒绝 / Refusals: 条件 / conditions `!manifest || hash.digest('hex') !== manifest.sha256`; `info['backing-filename'] || info['format-specific']?.data?.['data-file']`; `!!info.encrypted !== !!manifest.diskEncryption`; 异常 / errors `new AppError('导入包不完整或磁盘校验失败')`; `new AppError('导入磁盘含外部依赖')`.
   * 收尾：退出 try 区域时始终执行 `try { await rm(dir, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); onCleanupError?.(error)…`; `if (!lease.pendingCleanup) await lease.releaseTemporary(disk);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { await rm(dir, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); onCleanupError?.(error)…`; `if (!lease.pendingCleanup) await lease.releaseTemporary(disk);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `onCleanupError?.(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `onCleanupError?.(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async withContents<T>(
    source: Readable,
    signal: AbortSignal | undefined,
    work: (
      disk: string,
      manifest: z.infer<typeof manifestSchema>,
      seed: Buffer,
      trustedBoot: TrustedBootFiles | undefined,
      lease: StorageLease,
    ) => Promise<T>,
    onCleanupError?: (error: unknown) => void,
    lease?: StorageLease,
  ): Promise<T> {
    if (!lease)
      return incomingBundle(source, signal, (active) =>
        storageRuntime.run(
          {
            owner: 'core:bundle-import',
            taskId: 'bundle-import:' + randomUUID(),
            label: 'Validate and import VM bundle',
            mode: 'write',
            paths: [DATA],
            dynamicTemporary: [DATA],
            buffers: 20 * 1024 ** 2,
            files: 8,
            signal: active,
          },
          (owned) => this.withContents(source, active, work, onCleanupError, owned),
        ),
      );
    lease.assertActive();
    signal?.throwIfAborted();
    const dir = await this.temp();
    const disk = join(dir, 'disk.qcow2');
    try {
      let prefix = Buffer.alloc(0),
        manifest: z.infer<typeof manifestSchema> | undefined,
        total = 0;
      const hash = createHash('sha256');
      await pipeline(
        source,
        new Transform({
          /**
           * 入口 / Entry: Bundles.withContents.transform.
           * 功能：在导入、导出和克隆实例包中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cb(new AppError('导入包超过 32 GiB', 413))` / `cb()` 供上层消费（`Bundles`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `Bundles`; this entry produces `cb(new AppError('导入包超过 32 GiB', 413))` / `cb()` for its caller. Module context: Imports, exports and clones VM bundles; verifies manifests, disks and signatures under transfer and storage budgets.
           * 处理：通过 `cb`, `prefix.subarray().equals`, `prefix.subarray`, `prefix.readUInt32BE` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `cb`, `prefix.subarray().equals`, `prefix.subarray`, `prefix.readUInt32BE`; the branches below determine continuation, return or refusal.
           * 分支 / Branches: `total > MAX_BUNDLE`; `!manifest`; `prefix.length < 12`.
           * 输入 / Inputs: chunk: Buffer; _enc; cb
           * 输出 / Returns: `cb(new AppError('导入包超过 32 GiB', 413))`; `cb()`; `cb(new AppError('不是 Sakura 导出文件'))`；另有分支返回 / additional branch-specific returns.
           * 副作用 / Effects: `hash.update`; 更新 / updates `total`, `prefix`, `manifest`, `chunk`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           * 失败处理：catch 分支执行 `return cb(new AppError('导入清单损坏'));`，是否吞掉错误或重新拒绝由这些语句决定。
           * Failure handling: Catch paths execute `return cb(new AppError('导入清单损坏'));`; these statements determine whether a failure is absorbed or rejected again.
           */
          transform(chunk: Buffer, _enc, cb) {
            total += chunk.length;
            if (total > MAX_BUNDLE) return cb(new AppError('导入包超过 32 GiB', 413));
            if (!manifest) {
              prefix = Buffer.concat([prefix, chunk]);
              if (prefix.length < 12) return cb();
              if (!prefix.subarray(0, 8).equals(MAGIC)) return cb(new AppError('不是 Sakura 导出文件'));
              const length = prefix.readUInt32BE(8);
              if (length > MAX_BUNDLE_MANIFEST || length < 2) return cb(new AppError('无效的导入清单'));
              if (prefix.length < 12 + length) return cb();
              try {
                manifest = manifestSchema.parse(
                  JSON.parse(prefix.subarray(12, 12 + length).toString('utf8')),
                );
              } catch {
                return cb(new AppError('导入清单损坏'));
              }
              chunk = prefix.subarray(12 + length);
              prefix = Buffer.alloc(0);
            }
            hash.update(chunk);
            cb(null, chunk);
          },
        }),
        storageGrowth(lease, disk, MAX_BUNDLE),
        createWriteStream(disk, { flags: 'wx', mode: 0o600 }),
        { signal },
      );
      signal?.throwIfAborted();
      if (!manifest || hash.digest('hex') !== manifest.sha256)
        throw new AppError('导入包不完整或磁盘校验失败');
      verifySignedManifest(manifest);
      const trustedBoot = manifest.trustedBoot ? decodeTrustedBootArchive(manifest.trustedBoot) : undefined;
      const handle = await open(disk, 'r');
      try {
        const b = Buffer.alloc(104);
        await handle.read(b, 0, b.length, 0);
        validateDiskHeader(b, !!manifest.diskEncryption);
      } finally {
        await handle.close();
      }
      const info = JSON.parse(
        await this.machines.engine.run('sakura-img', ['info', '-f', 'qcow2', '--output=json', disk], {
          signal,
        }),
      );
      if (info['backing-filename'] || info['format-specific']?.data?.['data-file'])
        throw new AppError('导入磁盘含外部依赖');
      if (!!info.encrypted !== !!manifest.diskEncryption) throw new AppError('磁盘加密状态与导入清单不一致');
      const key = manifest.key;
      const parsedKey = ssh2.utils.parseKey(key);
      const identity = Array.isArray(parsedKey) ? parsedKey[0] : parsedKey;
      if (!identity || identity instanceof Error || !identity.getPrivatePEM())
        throw new AppError('导入包缺少有效实例身份私钥');
      const seed = Buffer.from(manifest.seed, 'base64');
      if (seed.length < 34816 || seed.toString('ascii', 32769, 32774) !== 'CD001')
        throw new AppError('初始化镜像已损坏');
      signal?.throwIfAborted();
      return await work(disk, manifest, seed, trustedBoot, lease);
    } finally {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (error) {
        lease.cleanupPending(error);
        onCleanupError?.(error);
        throw error;
      }
      if (!lease.pendingCleanup) await lease.releaseTemporary(disk);
    }
  }
  /**
   * 入口 / Entry: Bundles.clone.
   * 功能：创建基于源实例的独立副本，复制磁盘与配置并处理账户、桌面及可信启动附件。
   * Purpose: Creates an independent VM copy, copying disk/configuration and handling account, desktop and trusted-boot attachments.
   * 设计：源实例和目标暂存保持受控，成功采用后才返回新实例；失败撤销未完成目标但保留可诊断清理失败。
   * Design: Source and target staging stay controlled; adoption precedes returning the VM, and rollback preserves diagnosable cleanup failures.
   * 输入 / Inputs: id: string; name: string; snapshot: string optional; signal: AbortSignal optional
   * 输出 / Returns: `this.withExportBudget( id, active, async (bytes) => { const target = this.machines.storagePools.directory( randomUUID(), this…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async clone(id: string, name: string, snapshot?: string, signal?: AbortSignal) {
    const active = signal || new AbortController().signal;
    /**
     * 入口 / Entry: Bundles.clone.callback@651.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.withExportBudget）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.withExportBudget).
     * 输入 / Inputs: bytes
     * 输出 / Returns: `storageRuntime.run( { owner: 'core:vm-clone', taskId: 'clone:' + id, label: 'Clone independent VM disk', mode: 'write', paths…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.withExportBudget(
      id,
      active,
      async (bytes) => {
        const target = this.machines.storagePools.directory(
          randomUUID(),
          this.machines.get(id).storagePoolId || 'default',
        );
        /**
         * 入口 / Entry: Bundles.clone.callback@672.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
         * 输入 / Inputs: lease
         * 输出 / Returns: `adopted`.
         * 副作用 / Effects: `writeStore`; `this.machines.delete`; `secrets.save`; `rm`.
         * 拒绝 / Refusals: 条件 / conditions `snapshot && !shot`; `desktopBinding`; `x11Clipboard`; 异常 / errors `new AppError('快照不存在', 404)`; `error`.
         * 收尾：退出 try 区域时始终执行 `try { await rm(dir, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `try { await rm(dir, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`; these steps also apply to exceptional exits.
         * 失败处理：catch 分支执行 `await this.machines.delete(adopted.id);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `await this.machines.delete(adopted.id);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
         */
        return storageRuntime.run(
          {
            owner: 'core:vm-clone',
            taskId: 'clone:' + id,
            label: 'Clone independent VM disk',
            mode: 'write',
            paths: [vmDir(id), DATA, target],
            dynamicTemporary: [DATA, target],
            temporary: [
              { path: DATA, bytes },
              { path: target, bytes: bytes * (snapshot && !this.machines.get(id).diskEncryption ? 2 : 1) },
            ],
            buffers: 20 * 1024 ** 2,
            files: 8,
            signal: active,
          },
          async (lease) => {
            signal?.throwIfAborted();
            this.machines.requireStopped(id);
            const vm = this.machines.get(id);
            const shot = snapshot ? vm.snapshots.find((s) => s.id === snapshot) : undefined;
            if (snapshot && !shot) throw new AppError('快照不存在', 404);
            const trustedBoot = await this.trustedBoot?.capture(id, snapshot);
            const dir = await this.temp();
            try {
              const disk = join(dir, 'disk.qcow2');
              if (vm.diskEncryption)
                await this.machines.withDiskSecret(vm, (secret) =>
                  this.machines.engine.run(
                    'sakura-img',
                    [
                      'convert',
                      '--object',
                      qemuSecretObject(secret),
                      '--image-opts',
                      '-O',
                      'qcow2',
                      '-o',
                      'encrypt.format=luks,encrypt.key-secret=sakura-disk-key',
                      ...(snapshot ? ['-l', snapshot] : []),
                      encryptedImageOptions(join(vmDir(id), 'disk.qcow2')),
                      disk,
                    ],
                    { timeoutMs: 1800000, signal },
                  ),
                );
              else
                await this.machines.engine.run(
                  'sakura-img',
                  [
                    'convert',
                    '-f',
                    'qcow2',
                    '-O',
                    'qcow2',
                    ...(snapshot ? ['-l', snapshot] : []),
                    join(vmDir(id), 'disk.qcow2'),
                    disk,
                  ],
                  { timeoutMs: 1800000, signal },
                );
              const identity = await this.machines.snapshotIdentity(id, snapshot);
              const {
                memoryMiB,
                cpus,
                diskGiB,
                accelerator,
                distro,
                template,
                hardware,
                firmware,
                storagePoolId,
              } = vm;
              const project = await this.project(id);
              const projects = await this.projectCatalog(id);
              const desktopBinding = await new DesktopBindings(this.machines).read(id);
              const x11Clipboard = await this.x11Clipboard(id);
              const waylandClipboard = await this.x11Clipboard(id, 'wayland');
              signal?.throwIfAborted();
              const adopted = await this.machines.adopt(
                {
                  name,
                  memoryMiB,
                  cpus,
                  diskGiB: shot?.diskGiB || diskGiB,
                  accelerator,
                  distro,
                  template,
                  hardware,
                  firmware,
                  storagePoolId,
                  forwards: [],
                },
                disk,
                identity.key,
                identity.seed,
                project,
                !!(shot ? shot.pendingResize : vm.pendingResize),
                projects,
                undefined,
                vm.diskEncryption,
                snapshot && !vm.diskEncryption
                  ? { sourceVmId: id, snapshotId: snapshot, createdAt: new Date().toISOString() }
                  : undefined,
                lease,
                active,
              );
              if (desktopBinding) {
                try {
                  await writeStore(join(vmDir(adopted.id), 'desktop-binding.json'), desktopBinding);
                } catch (error) {
                  await this.machines.delete(adopted.id);
                  throw error;
                }
              }
              if (x11Clipboard) {
                try {
                  await writeStore(join(vmDir(adopted.id), 'x11-clipboard.json'), x11Clipboard);
                } catch (error) {
                  await this.machines.delete(adopted.id);
                  throw error;
                }
              }
              if (waylandClipboard) {
                try {
                  await writeStore(join(vmDir(adopted.id), 'wayland-clipboard.json'), waylandClipboard);
                } catch (error) {
                  await this.machines.delete(adopted.id);
                  throw error;
                }
              }
              if (vm.diskEncryption) {
                const secrets = new Secrets(this.machines);
                await secrets.save(adopted.id, {
                  name: vm.diskEncryption.secretName,
                  value: await secrets.value(id, vm.diskEncryption.secretName),
                });
              }
              if (trustedBoot) {
                try {
                  await this.trustedBoot!.restore(adopted.id, trustedBoot);
                } catch (error) {
                  await this.machines.delete(adopted.id);
                  throw error;
                }
              }
              return adopted;
            } finally {
              try {
                await rm(dir, { recursive: true, force: true });
              } catch (error) {
                lease.cleanupPending(error);
                throw error;
              }
            }
          },
        );
      },
      storageRuntime,
      snapshot,
    );
  }
}
