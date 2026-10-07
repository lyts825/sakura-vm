/**
 * 模块职责：管理对象存储备份策略和动作，解析私密凭证并协调备份校验及远端传输。
 * Module purpose: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
 */
import type { BackupsV1, BundlesV1, SecretsV1 } from './service-contracts/v1.ts';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { z } from 'zod';

import { backupLocked, verifyBackup } from './backups.ts';

import { withDecrypted } from './encrypted-backups.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { networkFor } from './network/index.ts';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { createSchema } from '../shared/contracts/vm.ts';
import { withoutOperationContext } from './operation-context.ts';
import { metadataFile } from './metadata-store.ts';
import { fileHash, readStore, writeStore } from './local-store.ts';
import { secretName } from './secrets.ts';
import { storageRuntime, type StorageLease } from './storage-runtime.ts';
import { uploadObjectFile, OBJECT_UPLOAD_BUFFERS } from './object-upload.ts';
import { randomUUID } from 'node:crypto';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

const objectNetwork = networkFor('core:object-backup', 's3');
const uuid = z.uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const prefix = z
  .string()
  .max(120)
  .regex(/^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/);
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.pathname === '/' || url.pathname === '')
  );
}, '目标地址需要无凭据、查询和路径的 HTTP(S) URL');
export const objectTargetSchema = z
  .object({
    endpoint: endpoint.optional(),
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
    region: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/)
      .default('us-east-1'),
    prefix: prefix.default(''),
    credentialSecret: secretName,
    autoUpload: z.boolean().default(false),
  })
  .strict();
const credentialSchema = z
  .object({
    accessKeyId: z.string().min(1).max(256),
    secretAccessKey: z.string().min(1).max(1024),
    sessionToken: z.string().max(4096).optional(),
  })
  .strict();
const metadataSchema = z
  .object({
    version: z.literal(1),
    sourceVmId: uuid,
    backupId: uuid,
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(33 * 1024 ** 3),
    sha256: sha,
    encrypted: z.boolean(),
    createdAt: z.iso.datetime(),
    passwordSecret: secretName.optional(),
    retainUntil: z.iso.datetime().optional(),
  })
  .strict();
type Metadata = z.infer<typeof metadataSchema>;
const syncStateSchema = z
  .object({
    mirrored: z.record(uuid, sha).default({}),
    lastAttemptAt: z.iso.datetime().optional(),
    lastSuccessAt: z.iso.datetime().optional(),
    lastError: z.string().max(500).optional(),
  })
  .strict();
type SyncState = z.infer<typeof syncStateSchema>;
export const objectBackupInput = z
  .object({
    mode: z.enum(['status', 'save', 'list', 'upload', 'verify', 'restore', 'delete']).default('status'),
    target: objectTargetSchema.optional(),
    backupId: uuid.optional(),
    remoteId: z
      .string()
      .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/)
      .optional(),
    restoreName: createSchema.shape.name.optional(),
    passwordSecret: secretName.optional(),
  })
  .strict();

export class ObjectBackup {
  private schedule: ScheduleHandle;
  private closed = false;
  private automaticAbort = new AbortController();
  /**
   * 入口 / Entry: ObjectBackup.constructor.
   * 功能：建立 ObjectBackup 的管理对象存储备份策略和动作上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ObjectBackup context for this module's responsibility: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; services: () => { backups?: BackupsV1; bundles?: BundlesV1; secrets?: SecretsV1 }
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.schedule`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private services: () => { backups?: BackupsV1; bundles?: BundlesV1; secrets?: SecretsV1 },
  ) {
    this.schedule = scheduler.register({
      owner: 'core:object-backup',
      label: 'Mirror verified backups to object storage',
      intervalMs: 60_000,
      overlap: 'skip',
      catchUp: 'once',
      /**
       * 入口 / Entry: ObjectBackup.constructor.run.
       * 功能：把本层请求转交 `this.tick`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.tick` and propagates the provider result or rejection.
       * 输入 / Inputs: { signal }
       * 输出 / Returns: `this.tick(Date.now(), signal)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: ({ signal }) => this.tick(Date.now(), signal),
    });
  }

  /**
   * 入口 / Entry: ObjectBackup.file.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(vmId), 'object-backup.json')` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `join(vmDir(vmId), 'object-backup.json')` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `join(vmDir(vmId), 'object-backup.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(vmId: string) {
    return join(vmDir(vmId), 'object-backup.json');
  }
  /**
   * 入口 / Entry: ObjectBackup.syncFile.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(vmId), 'object-backup-sync.json')` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `join(vmDir(vmId), 'object-backup-sync.json')` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `join(vmDir(vmId), 'object-backup-sync.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private syncFile(vmId: string) {
    return join(vmDir(vmId), 'object-backup-sync.json');
  }
  /**
   * 入口 / Entry: ObjectBackup.target.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `objectTargetSchema.nullable().parse(await readStore(this.file(vmId), () => null))` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `objectTargetSchema.nullable().parse(await readStore(this.file(vmId), () => null))` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `objectTargetSchema.nullable().parse`, `objectTargetSchema.nullable`, `readStore`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `objectTargetSchema.nullable().parse`, `objectTargetSchema.nullable`, `readStore`, `this.file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `objectTargetSchema.nullable().parse(await readStore(this.file(vmId), () => null))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async target(vmId: string) {
    return objectTargetSchema.nullable().parse(await readStore(this.file(vmId), () => null));
  }
  /**
   * 入口 / Entry: ObjectBackup.syncState.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `syncStateSchema.parse(await readStore(this.syncFile(vmId), () => ({ mirrored: {} })))` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `syncStateSchema.parse(await readStore(this.syncFile(vmId), () => ({ mirrored: {} })))` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `syncStateSchema.parse`, `readStore`, `this.syncFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `syncStateSchema.parse`, `readStore`, `this.syncFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: `syncStateSchema.parse(await readStore(this.syncFile(vmId), () => ({ mirrored: {} })))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async syncState(vmId: string) {
    return syncStateSchema.parse(await readStore(this.syncFile(vmId), () => ({ mirrored: {} })));
  }
  /**
   * 入口 / Entry: ObjectBackup.updateSync.
   * 功能：把本层请求转交 `this.machines.locked`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.machines.locked` and propagates the provider result or rejection.
   * 输入 / Inputs: vmId: string; update: (state: SyncState) => void
   * 输出 / Returns: `this.machines.locked(`object-backup-sync:${vmId}`, async () => { const result = await metadataFile( this.syncFile(vmId), () =…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async updateSync(vmId: string, update: (state: SyncState) => void) {
    return this.machines.locked(`object-backup-sync:${vmId}`, async () => {
      const result = await metadataFile(
        this.syncFile(vmId),
        () => ({ mirrored: {} }),
        syncStateSchema.parse,
      ).update(update);
      return result.value;
    });
  }
  /**
   * 入口 / Entry: ObjectBackup.markMirrored.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; the calls and state transitions below complete the operation. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `this.updateSync` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.updateSync`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; backupId: string; checksum: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.updateSync`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async markMirrored(vmId: string, backupId: string, checksum: string) {
    /**
     * 入口 / Entry: ObjectBackup.markMirrored.callback@165.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.updateSync）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.updateSync).
     * 输入 / Inputs: state
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `state.mirrored[backupId]`, `state.lastAttemptAt`, `state.lastSuccessAt`.
     */
    await this.updateSync(vmId, (state) => {
      state.mirrored[backupId] = checksum;
      state.lastAttemptAt = new Date().toISOString();
      state.lastSuccessAt = state.lastAttemptAt;
      delete state.lastError;
    });
  }
  /** Retry failed automatic transfers after five minutes; local backups remain usable on failure. */
  /**
   * 入口 / Entry: ObjectBackup.tick.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `void` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `AbortSignal.any`, `this.services`, `this.machines.records.keys`, `this.target` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `AbortSignal.any`, `this.services`, `this.machines.records.keys`, `this.target`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `!backups || !bundles || !secrets`; `this.closed || active.aborted`.
   * 输入 / Inputs: now: default=Date.now(); signal: AbortSignal optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `AbortSignal.any`; `this.updateSync`; 更新 / updates `state.mirrored[item.id]`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `if (this.closed || active.aborted) return;`; `await this.updateSync(vmId, (state) => { state.lastAttemptAt = new Date(now).toISOString(); state.lastError = String((error a…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (this.closed || active.aborted) return;`; `await this.updateSync(vmId, (state) => { state.lastAttemptAt = new Date(now).toISOString(); state.lastError = String((error a…`; these statements determine whether a failure is absorbed or rejected again.
   */
  async tick(now = Date.now(), signal?: AbortSignal) {
    const active = signal
      ? AbortSignal.any([signal, this.automaticAbort.signal])
      : this.automaticAbort.signal;
    if (this.closed) return;
    const { backups, bundles, secrets } = this.services();
    if (!backups || !bundles || !secrets) return;
    for (const vmId of this.machines.records.keys()) {
      if (this.closed || active.aborted) return;
      try {
        const target = await this.target(vmId);
        if (!target?.autoUpload || backups.jobs.view(vmId)?.status === 'running') continue;
        const state = await this.syncState(vmId);
        if (state.lastError && state.lastAttemptAt && now - Date.parse(state.lastAttemptAt) < 300_000)
          continue;
        const items = (await backups.view(vmId)).items;
        const localIds = new Set(items.map((item) => item.id));
        if (Object.keys(state.mirrored).some((id) => !localIds.has(id)))
          await this.updateSync(vmId, (current) => {
            for (const id of Object.keys(current.mirrored))
              if (!localIds.has(id)) delete current.mirrored[id];
          });
        for (const item of items.slice().reverse()) {
          if (this.closed || active.aborted) return;
          if (state.mirrored[item.id] === item.checksum) continue;
          await this.action(vmId, { mode: 'upload', backupId: item.id }, 'run', active);
          state.mirrored[item.id] = item.checksum;
        }
      } catch (error) {
        if (this.closed || active.aborted) return;
        await this.updateSync(vmId, (state) => {
          state.lastAttemptAt = new Date(now).toISOString();
          state.lastError = String((error as Error).message || error).slice(0, 500);
        });
      }
    }
  }
  /**
   * 入口 / Entry: ObjectBackup.client.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new S3Client({ requestHandler: objectNetwork.requestHandler(), region: target.region, ...(target.endpoint ? { endpoint: targe…` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `new S3Client({ requestHandler: objectNetwork.requestHandler(), region: target.region, ...(target.endpoint ? { endpoint: targe…` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `credentialSchema.parse`, `secrets.value`, `objectNetwork.requestHandler` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `credentialSchema.parse`, `secrets.value`, `objectNetwork.requestHandler`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; target: z.infer<typeof objectTargetSchema>; secrets: SecretsV1
   * 输出 / Returns: `new S3Client({ requestHandler: objectNetwork.requestHandler(), region: target.region, ...(target.endpoint ? { endpoint: targe…`.
   * 副作用 / Effects: `objectNetwork.requestHandler`; 更新 / updates `credential`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('对象存储凭据必须是含 accessKeyId 和 secretAccessKey 的私密配置 JSON', 400)`.
   * 失败处理：catch 分支执行 `throw new AppError('对象存储凭据必须是含 accessKeyId 和 secretAccessKey 的私密配置 JSON', 400);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('对象存储凭据必须是含 accessKeyId 和 secretAccessKey 的私密配置 JSON', 400);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async client(vmId: string, target: z.infer<typeof objectTargetSchema>, secrets: SecretsV1) {
    let credential: z.infer<typeof credentialSchema>;
    try {
      credential = credentialSchema.parse(JSON.parse(await secrets.value(vmId, target.credentialSecret)));
    } catch {
      throw new AppError('对象存储凭据必须是含 accessKeyId 和 secretAccessKey 的私密配置 JSON', 400);
    }
    return new S3Client({
      requestHandler: objectNetwork.requestHandler(),
      region: target.region,
      ...(target.endpoint ? { endpoint: target.endpoint } : {}),
      forcePathStyle: true,
      credentials: credential,
      // A create/complete response can be lost after committing remotely. The
      // operation reconciles that identity itself instead of replaying mutation.
      maxAttempts: 1,
    });
  }
  /**
   * 入口 / Entry: ObjectBackup.base.
   * 功能：从当前输入或状态计算 ``${target.prefix ? target.prefix + '/' : ''}sakura-backups/``，供调用方后续验证或使用。
   * Purpose: Computes ``${target.prefix ? target.prefix + '/' : ''}sakura-backups/`` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: target: z.infer<typeof objectTargetSchema>
   * 输出 / Returns: ``${target.prefix ? target.prefix + '/' : ''}sakura-backups/``.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private base(target: z.infer<typeof objectTargetSchema>) {
    return `${target.prefix ? target.prefix + '/' : ''}sakura-backups/`;
  }
  /**
   * 入口 / Entry: ObjectBackup.keys.
   * 功能：从当前输入或状态计算 `{ metadata: `${base}.json`, data: `${base}.sakura${encrypted ? '.enc' : ''}` }`，供调用方后续验证或使用。
   * Purpose: Computes `{ metadata: `${base}.json`, data: `${base}.sakura${encrypted ? '.enc' : ''}` }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: target: z.infer<typeof objectTargetSchema>; sourceVmId: string; backupId: string; encrypted: boolean
   * 输出 / Returns: `{ metadata: `${base}.json`, data: `${base}.sakura${encrypted ? '.enc' : ''}` }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private keys(
    target: z.infer<typeof objectTargetSchema>,
    sourceVmId: string,
    backupId: string,
    encrypted: boolean,
  ) {
    const base = `${this.base(target)}${sourceVmId}/${backupId}`;
    return { metadata: `${base}.json`, data: `${base}.sakura${encrypted ? '.enc' : ''}` };
  }
  /**
   * 入口 / Entry: ObjectBackup.remoteMetadata.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `metadata` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `metadata` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `remoteId.split`, `uuid.parse`, `this.keys`, `client.send` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `remoteId.split`, `uuid.parse`, `this.keys`, `client.send`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: client: S3Client; target: z.infer<typeof objectTargetSchema>; remoteId: string; signal: AbortSignal
   * 输出 / Returns: `metadata`.
   * 副作用 / Effects: `client.send`; `chunks.push`; `source.destroy`; 更新 / updates `bytes`.
   * 拒绝 / Refusals: 条件 / conditions `!result.Body`; `result.ContentLength === undefined || result.ContentLength > 16384`; `bytes > 16384`; 异常 / errors `new AppError('对象备份清单缺失或过大', 409)`; `new AppError('对象备份清单超过 16 KiB', 409)`.
   * 收尾：退出 try 区域时始终执行 `source.destroy();`; `await finished(source).catch(() => {});`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `source.destroy();`; `await finished(source).catch(() => {});`; these steps also apply to exceptional exits.
   */
  private async remoteMetadata(
    client: S3Client,
    target: z.infer<typeof objectTargetSchema>,
    remoteId: string,
    signal: AbortSignal,
  ) {
    const [sourceVmId, backupId] = remoteId.split('/');
    uuid.parse(sourceVmId);
    uuid.parse(backupId);
    const key = this.keys(target, sourceVmId, backupId, false).metadata;
    const result = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }), {
      abortSignal: signal,
    });
    if (!result.Body) throw new AppError('对象备份清单缺失或过大', 409);
    const source = result.Body as Readable,
      chunks: Buffer[] = [];
    let bytes = 0;
    try {
      if (result.ContentLength === undefined || result.ContentLength > 16384)
        throw new AppError('对象备份清单缺失或过大', 409);
      for await (const chunk of source) {
        signal.throwIfAborted();
        bytes += (chunk as Buffer).length;
        if (bytes > 16384) throw new AppError('对象备份清单超过 16 KiB', 409);
        chunks.push(chunk as Buffer);
      }
      if (bytes !== result.ContentLength) throw new AppError('对象备份清单长度不符', 409);
    } finally {
      source.destroy();
      await finished(source).catch(() => {});
    }
    const metadata = metadataSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (metadata.sourceVmId !== sourceVmId || metadata.backupId !== backupId)
      throw new AppError('对象备份清单与对象路径不匹配', 409);
    return metadata;
  }
  /**
   * 入口 / Entry: ObjectBackup.remoteHash.
   * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run( { owner: 'core:object-read', taskId: 'object-read:' + randomUUID(), label: 'Verify remote object', mode: …` 供上层消费（`ObjectBackup`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `storageRuntime.run( { owner: 'core:object-read', taskId: 'object-read:' + randomUUID(), label: 'Verify remote object', mode: …` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `lease.reserveTemporary` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storageRuntime.run`, `randomUUID`, `lease.assertActive`, `lease.reserveTemporary`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!lease`; `file`.
   * 输入 / Inputs: client: S3Client; target: z.infer<typeof objectTargetSchema>; metadata: Metadata; signal: AbortSignal; file: string optional; lease: StorageLease optional
   * 输出 / Returns: Promise<void>；结果来自 / values from `storageRuntime.run( { owner: 'core:object-read', taskId: 'object-read:' + randomUUID(), label: 'Verify remote object', mode: …`.
   * 副作用 / Effects: `client.send`; `createHash`; `createWriteStream`; `hash.update`; `source.destroy`; 更新 / updates `bytes`.
   * 拒绝 / Refusals: 条件 / conditions `!result.Body`; `result.ContentLength !== metadata.bytes`; `bytes > metadata.bytes`; 异常 / errors `new AppError('远端备份对象长度不符', 409)`; `new AppError('远端备份对象超过声明长度', 409)`.
   * 收尾：退出 try 区域时始终执行 `source.destroy();`; `await finished(source).catch(() => {});`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `source.destroy();`; `await finished(source).catch(() => {});`; these steps also apply to exceptional exits.
   */
  private async remoteHash(
    client: S3Client,
    target: z.infer<typeof objectTargetSchema>,
    metadata: Metadata,
    signal: AbortSignal,
    file?: string,
    lease?: StorageLease,
  ): Promise<void> {
    if (!lease)
      return storageRuntime.run(
        {
          owner: 'core:object-read',
          taskId: 'object-read:' + randomUUID(),
          label: 'Verify remote object',
          mode: file ? 'write' : 'read',
          paths: [file || DATA],
          ...(file ? { dynamicTemporary: [file] } : {}),
          buffers: 1024 ** 2,
          files: 3,
          signal,
        },
        (owned) => this.remoteHash(client, target, metadata, signal, file, owned),
      );
    lease.assertActive();
    if (file) await lease.reserveTemporary(file, metadata.bytes);
    const key = this.keys(target, metadata.sourceVmId, metadata.backupId, metadata.encrypted).data;
    const result = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }), {
      abortSignal: signal,
    });
    if (!result.Body) throw new AppError('远端备份对象长度不符', 409);
    const hash = createHash('sha256');
    let bytes = 0;
    const source = result.Body as Readable;
    try {
      if (result.ContentLength !== metadata.bytes) throw new AppError('远端备份对象长度不符', 409);
      if (file) {
        await pipeline(
          source,
          new Transform({
            /**
             * 入口 / Entry: ObjectBackup.remoteHash.transform.
             * 功能：在管理对象存储备份策略和动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `callback(new AppError('远端备份对象超过声明长度', 409))` 供上层消费（`ObjectBackup`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `ObjectBackup`; this entry produces `callback(new AppError('远端备份对象超过声明长度', 409))` for its caller. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
             * 处理：通过 `callback`, `hash.update` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `callback`, `hash.update`; the branches below determine continuation, return or refusal.
             * 分支 / Branches: `bytes > metadata.bytes`.
             * 输入 / Inputs: chunk: Buffer; _encoding; callback
             * 输出 / Returns: `callback(new AppError('远端备份对象超过声明长度', 409))`.
             * 副作用 / Effects: `hash.update`; 更新 / updates `bytes`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              if (bytes > metadata.bytes) return callback(new AppError('远端备份对象超过声明长度', 409));
              hash.update(chunk);
              callback(null, chunk);
            },
          }),
          createWriteStream(file, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
      } else
        for await (const chunk of source) {
          signal.throwIfAborted();
          bytes += (chunk as Buffer).length;
          if (bytes > metadata.bytes) throw new AppError('远端备份对象超过声明长度', 409);
          hash.update(chunk as Buffer);
        }
    } finally {
      source.destroy();
      await finished(source).catch(() => {});
    }
    if (bytes !== metadata.bytes || hash.digest('hex') !== metadata.sha256)
      throw new AppError('远端备份 SHA-256 校验失败', 409);
  }

  /**
   * 入口 / Entry: ObjectBackup.action.
   * 功能：校验对象备份模式并执行保存策略、上传、下载、恢复或删除对象动作。
   * Purpose: Validates object-backup modes and saves policies/uploads/downloads/restores/deletes objects.
   * 设计：私密凭证解析后限定客户端与目标，实际对象及本地备份均验证摘要；multipart、文件和存储租约在原流程收尾。
   * Design: Resolved secrets constrain clients/targets, objects/local backups require digest checks, and original workflows own multipart/file/storage cleanup.
   * 输入 / Inputs: vmId: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal
   * 输出 / Returns: `{ ready: false, executed: false, reason: '请先保存 S3/MinIO 目标；凭据需在当前实例的私密配置中保存为 JSON。', }`; `{ ready: false, executed: false, reason, ...(configured ? { target: configured, sync: await this.syncState(vmId) } : {}), }`; `{ ready: true, executed: action === 'run', target: options.target }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `client.send`; `client.destroy`; `statusClient.send`; `statusClient.destroy`; `key.startsWith`; 更新 / updates `statusClient`, `token`.
   * 拒绝 / Refusals: 条件 / conditions `!backups || !bundles || !secrets`; `options.mode === 'save'`; `!options.target`; 异常 / errors `new AppError(reason, 409)`; `new AppError('请填写对象存储目标')`.
   * 收尾：退出 try 区域时始终执行 `client.destroy();`; `statusClient?.destroy();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `client.destroy();`; `statusClient?.destroy();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (signal.aborted) throw error;`; `return { ready: false, executed: false, target, sync, reason: String((error as Error).message || error).slice(0, 500), };`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (signal.aborted) throw error;`; `return { ready: false, executed: false, target, sync, reason: String((error as Error).message || error).slice(0, 500), };`; these statements determine whether a failure is absorbed or rejected again.
   */
  async action(vmId: string, input: unknown, action: 'check' | 'run', signal: AbortSignal) {
    this.machines.get(vmId);
    const options = objectBackupInput.parse(input);
    const readOnly = action === 'check' || options.mode === 'status' || options.mode === 'list';
    if (!readOnly) this.machines.requireUnlocked(vmId);
    const configured = await this.target(vmId);
    if (!configured && options.mode !== 'save')
      return {
        ready: false,
        executed: false,
        reason: '请先保存 S3/MinIO 目标；凭据需在当前实例的私密配置中保存为 JSON。',
      };
    const { backups, bundles, secrets } = this.services();
    if (!backups || !bundles || !secrets) {
      const reason = '请启用快照、备份策略与私密配置插件';
      if (action === 'check' || options.mode === 'status')
        return {
          ready: false,
          executed: false,
          reason,
          ...(configured ? { target: configured, sync: await this.syncState(vmId) } : {}),
        };
      throw new AppError(reason, 409);
    }
    if (options.mode === 'save') {
      if (!options.target) throw new AppError('请填写对象存储目标');
      const client = await this.client(vmId, options.target, secrets);
      try {
        await client.send(new HeadBucketCommand({ Bucket: options.target.bucket }), { abortSignal: signal });
        if (action === 'run')
          await this.machines.locked(`object-backup:${vmId}`, async () => {
            const previous = await this.target(vmId);
            await writeStore(this.file(vmId), options.target!);
            if (JSON.stringify(previous) !== JSON.stringify(options.target))
              await this.machines.locked(`object-backup-sync:${vmId}`, () =>
                writeStore(this.syncFile(vmId), { mirrored: {} }),
              );
          });
        return { ready: true, executed: action === 'run', target: options.target };
      } finally {
        client.destroy();
      }
    }
    const target = configured!;
    if (action === 'check' || options.mode === 'status') {
      const sync = await this.syncState(vmId);
      let statusClient: S3Client | undefined;
      try {
        statusClient = await this.client(vmId, target, secrets);
        await statusClient.send(new HeadBucketCommand({ Bucket: target.bucket }), { abortSignal: signal });
        return { ready: true, executed: false, target, sync };
      } catch (error) {
        if (signal.aborted) throw error;
        return {
          ready: false,
          executed: false,
          target,
          sync,
          reason: String((error as Error).message || error).slice(0, 500),
        };
      } finally {
        statusClient?.destroy();
      }
    }
    const client = await this.client(vmId, target, secrets);
    try {
      if (options.mode === 'list') {
        const entries: Array<{ remoteId: string; metadata: Metadata }> = [];
        let token: string | undefined;
        do {
          const page = await client.send(
            new ListObjectsV2Command({
              Bucket: target.bucket,
              Prefix: this.base(target),
              ContinuationToken: token,
              MaxKeys: 1000,
            }),
            { abortSignal: signal },
          );
          for (const item of page.Contents || []) {
            const key = item.Key || '';
            if (!key.startsWith(this.base(target)) || !key.endsWith('.json')) continue;
            const remoteId = key.slice(this.base(target).length, -'.json'.length);
            const [sourceVmId, backupId, extra] = remoteId.split('/');
            if (extra || !uuid.safeParse(sourceVmId).success || !uuid.safeParse(backupId).success) continue;
            entries.push({ remoteId, metadata: await this.remoteMetadata(client, target, remoteId, signal) });
            if (entries.length >= 100) break;
          }
          token = page.IsTruncated && entries.length < 100 ? page.NextContinuationToken : undefined;
        } while (token);
        return { ready: true, executed: false, target, entries };
      }
      if (options.mode === 'upload') {
        if (!options.backupId) throw new AppError('请选择本机备份');
        /**
         * 入口 / Entry: ObjectBackup.action.callback@434.
         * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
         * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `{ ready: true, executed: false, remoteId: `${vmId}/${item.id}`, metadata: existing, message: '远端备份已存在并通过校验。', }`; `{ ready: true, executed: true, remoteId: `${vmId}/${item.id}`, metadata }`.
         * 副作用 / Effects: `client.send`.
         * 拒绝 / Refusals: 条件 / conditions `!item`; `item.encrypted && !passwordName`; `existing.sha256 !== metadata.sha256 || existing.bytes !== metadata.bytes`; 异常 / errors `new AppError('本机备份不存在', 404)`; `new AppError('加密备份需要 passwordSecret 指向保存了备份密码的私密配置', 400)`.
         * 失败处理：catch 分支执行 `if ( error instanceof AppError || !['NotFound', 'NoSuchKey', '404'].includes((error as Error).name) ) throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `if ( error instanceof AppError || !['NotFound', 'NoSuchKey', '404'].includes((error as Error).name) ) throw error;`; these statements determine whether a failure is absorbed or rejected again.
         */
        return await this.machines.locked(`object-backup:${vmId}`, async () => {
          const item = (await backups.view(vmId)).items.find((entry) => entry.id === options.backupId);
          if (!item) throw new AppError('本机备份不存在', 404);
          const passwordName = options.passwordSecret || item.passwordSecret;
          if (item.encrypted && !passwordName)
            throw new AppError('加密备份需要 passwordSecret 指向保存了备份密码的私密配置', 400);
          const password = passwordName ? await secrets.value(vmId, passwordName) : undefined;
          const metadata: Metadata = {
            version: 1,
            sourceVmId: vmId,
            backupId: item.id,
            bytes: item.bytes,
            sha256: item.checksum,
            encrypted: Boolean(item.encrypted),
            createdAt: item.createdAt,
            ...(item.encrypted ? { passwordSecret: passwordName } : {}),
            ...(item.retainUntil ? { retainUntil: item.retainUntil } : {}),
          };
          const keys = this.keys(target, vmId, item.id, Boolean(item.encrypted));
          try {
            await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: keys.metadata }), {
              abortSignal: signal,
            });
            const existing = await this.remoteMetadata(client, target, `${vmId}/${item.id}`, signal);
            if (existing.sha256 !== metadata.sha256 || existing.bytes !== metadata.bytes)
              throw new AppError('远端同名备份与本机备份不一致', 409);
            await this.remoteHash(client, target, existing, signal);
            await this.markMirrored(vmId, item.id, item.checksum);
            return {
              ready: true,
              executed: false,
              remoteId: `${vmId}/${item.id}`,
              metadata: existing,
              message: '远端备份已存在并通过校验。',
            };
          } catch (error) {
            if (
              error instanceof AppError ||
              !['NotFound', 'NoSuchKey', '404'].includes((error as Error).name)
            )
              throw error;
          }
          /**
           * 入口 / Entry: ObjectBackup.action.callback@481.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（backups.withVerifiedFile）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (backups.withVerifiedFile).
           * 输入 / Inputs: _verifiedFile; lease; file
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `uploadObjectFile`; `client.send`; 更新 / updates `uploaded`.
           * 拒绝 / Refusals: 条件 / conditions `(await stat(file)).size !== item.bytes || (await fileHash(file, signal)) !== item.checksum`; `uploaded`; 异常 / errors `new AppError('本机备份与记录的校验值不符', 409)`; `cleanup`.
           * 收尾：退出 try 区域时始终执行 ；这些步骤也适用于异常退出。
           * Finalization: Leaving the try region always executes ; these steps also apply to exceptional exits.
           * 失败处理：catch 分支执行 `if (uploaded) { try { await withoutOperationContext(async () => { const cleanupSignal = AbortSignal.timeout(30_000); // A los…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
           * Failure handling: Catch paths execute `if (uploaded) { try { await withoutOperationContext(async () => { const cleanupSignal = AbortSignal.timeout(30_000); // A los…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
           */
          await backups.withVerifiedFile(
            vmId,
            item.id,
            password,
            signal,
            async (_verifiedFile, lease, file) => {
              if ((await stat(file)).size !== item.bytes || (await fileHash(file, signal)) !== item.checksum)
                throw new AppError('本机备份与记录的校验值不符', 409);
              signal.throwIfAborted();
              let uploaded = false;
              try {
                signal.throwIfAborted();
                await uploadObjectFile(client, target.bucket, keys.data, file, item.bytes, signal, lease);
                uploaded = true;
                await this.remoteHash(client, target, metadata, signal, undefined, lease);
                await client.send(
                  new PutObjectCommand({
                    Bucket: target.bucket,
                    Key: keys.metadata,
                    Body: JSON.stringify(metadata),
                    ContentType: 'application/json',
                  }),
                  { abortSignal: signal },
                );
              } catch (error) {
                if (uploaded) {
                  try {
                    await withoutOperationContext(async () => {
                      const cleanupSignal = AbortSignal.timeout(30_000);
                      // A lost manifest PUT response may already have advertised
                      // the object. Withdraw its manifest before removing data.
                      for (const key of [keys.metadata, keys.data])
                        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }), {
                          abortSignal: cleanupSignal,
                        });
                    });
                  } catch (cleanup) {
                    lease.cleanupPending(cleanup);
                    throw cleanup;
                  }
                }
                throw error;
              } finally {
                /* uploadObjectFile settles every worker and closes its descriptor. */
              }
            },
            { extraBuffers: OBJECT_UPLOAD_BUFFERS, writes: false },
          );
          await this.markMirrored(vmId, item.id, item.checksum);
          return { ready: true, executed: true, remoteId: `${vmId}/${item.id}`, metadata };
        });
      }
      if (!options.remoteId) throw new AppError('请选择远端备份');
      const metadata = await this.remoteMetadata(client, target, options.remoteId, signal);
      if (options.mode === 'delete') {
        if (backupLocked(metadata))
          throw new AppError('备份在保留锁定期内，不能删除：' + metadata.retainUntil, 423, 'BACKUP_LOCKED');
        const keys = this.keys(target, metadata.sourceVmId, metadata.backupId, metadata.encrypted);
        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: keys.metadata }), {
          abortSignal: signal,
        });
        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: keys.data }), {
          abortSignal: signal,
        });
        if (metadata.sourceVmId === vmId)
          await this.updateSync(vmId, (state) => {
            delete state.mirrored[metadata.backupId];
          });
        return { ready: true, executed: true, remoteId: options.remoteId, deleted: true };
      }
      const tempRoot = join(DATA, 'object-backup-temp');
      /**
       * 入口 / Entry: ObjectBackup.action.callback@559.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（storageRuntime.run）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (storageRuntime.run).
       * 输入 / Inputs: lease
       * 输出 / Returns: `{ ready: true, executed: true, remoteId: options.remoteId, verified: true, ...(restored ? { restoredVmId: restored.id, restor…`.
       * 副作用 / Effects: `mkdir`; `createReadStream`; `rm`; 更新 / updates `restored`.
       * 拒绝 / Refusals: 条件 / conditions `metadata.encrypted`; `!passwordName`; `options.mode === 'restore'`; 异常 / errors `new AppError('加密备份需要 passwordSecret 指向保存了备份密码的私密配置', 400)`; `new AppError('恢复需要新实例名称')`.
       * 收尾：退出 try 区域时始终执行 `try { await rm(temp, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `try { await rm(temp, { recursive: true, force: true }); } catch (error) { lease.cleanupPending(error); throw error; }`; these steps also apply to exceptional exits.
       * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
       */
      return await storageRuntime.run(
        {
          owner: 'core:object-import',
          taskId: 'object-import:' + randomUUID(),
          label: 'Download and verify object backup',
          mode: 'write',
          paths: [DATA],
          dynamicTemporary: [DATA],
          buffers: 24 * 1024 ** 2,
          files: 10,
          signal,
        },
        async (lease) => {
          await mkdir(tempRoot, { recursive: true });
          const temp = await mkdtemp(join(tempRoot, 'download-'));
          const file = join(temp, `backup.sakura${metadata.encrypted ? '.enc' : ''}`);
          try {
            await this.remoteHash(client, target, metadata, signal, file, lease);
            let restored: { id: string; name: string } | undefined;
            if (metadata.encrypted) {
              const passwordName = options.passwordSecret || metadata.passwordSecret;
              if (!passwordName)
                throw new AppError('加密备份需要 passwordSecret 指向保存了备份密码的私密配置', 400);
              const password = await secrets.value(vmId, passwordName);
              /**
               * 入口 / Entry: ObjectBackup.action.callback@574.
               * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（withDecrypted）。
               * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (withDecrypted).
               * 输入 / Inputs: plain
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: `createReadStream`; 更新 / updates `restored`.
               * 拒绝 / Refusals: 条件 / conditions `options.mode === 'restore'`; `!options.restoreName`; 异常 / errors `new AppError('恢复需要新实例名称')`.
               */
              await withDecrypted(
                file,
                password,
                async (plain) => {
                  await verifyBackup(plain, signal, lease);
                  if (options.mode === 'restore') {
                    if (!options.restoreName) throw new AppError('恢复需要新实例名称');
                    restored = await bundles.importExternal(
                      options.restoreName,
                      createReadStream(plain),
                      signal,
                      lease,
                    );
                  }
                },
                signal,
                lease.cleanupPending,
                lease,
              );
            } else {
              await verifyBackup(file, signal, lease);
              if (options.mode === 'restore') {
                if (!options.restoreName) throw new AppError('恢复需要新实例名称');
                restored = await bundles.importExternal(
                  options.restoreName,
                  createReadStream(file),
                  signal,
                  lease,
                );
              }
            }
            return {
              ready: true,
              executed: true,
              remoteId: options.remoteId,
              verified: true,
              ...(restored ? { restoredVmId: restored.id, restoredName: restored.name } : {}),
            };
          } finally {
            try {
              await rm(temp, { recursive: true, force: true });
            } catch (error) {
              lease.cleanupPending(error);
              throw error;
            }
          }
        },
      );
    } finally {
      client.destroy();
    }
  }
  /**
   * 入口 / Entry: ObjectBackup.close.
   * 功能：在管理对象存储备份策略和动作中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`ObjectBackup`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ObjectBackup`; the outcome is recorded in `this.closed`. Module context: Owns object-storage backup settings/actions, resolving private credentials and coordinating verification/remote transfers.
   * 处理：通过 `this.automaticAbort.abort`, `this.schedule.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.automaticAbort.abort`, `this.schedule.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.automaticAbort.abort`; `this.schedule.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.automaticAbort.abort();
    await this.schedule.close();
  }
}
