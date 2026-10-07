/**
 * 模块职责：同步并验证远端审计对象，显式读取凭证并管理对象完整性与远端锁状态。
 * Module purpose: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
 */
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import {
  GetObjectCommand,
  GetObjectLockConfigurationCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { z } from 'zod';
import { AuditLog } from './audit.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { networkFor } from './network/index.ts';

const auditNetwork = networkFor('core:remote-audit', 's3');
const hex = z.string().regex(/^[a-f0-9]{64}$/);
/**
 * 入口 / Entry: callback@24.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.url().refine / 远程审计地址需要 HTTPS；本机测试可使用 HTTP）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.url().refine / 远程审计地址需要 HTTPS；本机测试可使用 HTTP).
 * 输入 / Inputs: value
 * 输出 / Returns: `( !url.username && !url.password && !url.search && !url.hash && (url.pathname === '/' || url.pathname === '') && (url.protoco…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.pathname === '/' || url.pathname === '') &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  );
}, '远程审计地址需要 HTTPS；本机测试可使用 HTTP');
export const remoteAuditTarget = z
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
    prefix: z
      .string()
      .max(120)
      .regex(/^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/)
      .default(''),
    retentionDays: z.number().int().min(7).max(3650),
  })
  .strict();
export const remoteAuditAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configure'), target: remoteAuditTarget }).strict(),
  z.object({ action: z.literal('disable') }).strict(),
  z.object({ action: z.literal('sync') }).strict(),
  z.object({ action: z.literal('verify') }).strict(),
]);
export type RemoteAuditTarget = z.infer<typeof remoteAuditTarget>;

const anchorBody = z
  .object({
    format: z.literal('sakura-audit-anchor/v1'),
    hostId: z.uuid(),
    sequence: z.number().int().min(0),
    hash: hex,
    createdAt: z.iso.datetime(),
    previous: z
      .object({ key: z.string().min(1).max(300), versionId: z.string().min(1).max(512) })
      .strict()
      .nullable(),
  })
  .strict();
const anchor = z
  .object({
    target: remoteAuditTarget,
    key: z.string().min(1).max(300),
    versionId: z.string().min(1).max(512),
    sequence: z.number().int().min(0),
    hash: hex,
    body: z.string().min(1).max(2048),
    retainUntil: z.iso.datetime(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    hostId: z.uuid(),
    target: remoteAuditTarget.nullable(),
    last: anchor.optional(),
    lastAttemptAt: z.iso.datetime().optional(),
    lastVerifiedAt: z.iso.datetime().optional(),
    lastError: z.string().max(500).optional(),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
type Anchor = z.infer<typeof anchor>;

export type RemoteAuditObject = {
  body: string;
  versionId: string;
  mode: string | undefined;
  retainUntil: Date | undefined;
};
export interface RemoteAuditStore {
  /**
   * 签名 / Signature: RemoteAuditStore.locked.
   * 功能：为同步并验证远端审计对象声明 locked 的输入与结果契约，所属容器为 RemoteAuditStore。
   * Purpose: Declares the input/result contract for locked in RemoteAuditStore. Module responsibility: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 输入 / Inputs: target: RemoteAuditTarget; signal: AbortSignal optional
   * 输出 / Returns: Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  locked(target: RemoteAuditTarget, signal?: AbortSignal): Promise<boolean>;
  /**
   * 签名 / Signature: RemoteAuditStore.put.
   * 功能：为同步并验证远端审计对象声明 put 的输入与结果契约，所属容器为 RemoteAuditStore。
   * Purpose: Declares the input/result contract for put in RemoteAuditStore. Module responsibility: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 输入 / Inputs: target: RemoteAuditTarget; key: string; body: string; retainUntil: Date; signal: AbortSignal optional
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  put(
    target: RemoteAuditTarget,
    key: string,
    body: string,
    retainUntil: Date,
    signal?: AbortSignal,
  ): Promise<string>;
  /**
   * 签名 / Signature: RemoteAuditStore.read.
   * 功能：为同步并验证远端审计对象声明 read 的输入与结果契约，所属容器为 RemoteAuditStore。
   * Purpose: Declares the input/result contract for read in RemoteAuditStore. Module responsibility: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 输入 / Inputs: target: RemoteAuditTarget; key: string; versionId: string optional; signal: AbortSignal optional
   * 输出 / Returns: Promise<RemoteAuditObject>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  read(
    target: RemoteAuditTarget,
    key: string,
    versionId?: string,
    signal?: AbortSignal,
  ): Promise<RemoteAuditObject>;
}

/** The S3 adapter requires a locked, versioned bucket and checks the exact object version. */
export class S3RemoteAuditStore implements RemoteAuditStore {
  /**
   * 入口 / Entry: S3RemoteAuditStore.client.
   * 功能：在同步并验证远端审计对象中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new S3Client({ region: target.region, requestHandler: auditNetwork.requestHandler(), credentials: { accessKeyId, secretAccess…` 供上层消费（`S3RemoteAuditStore`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `S3RemoteAuditStore`; this entry produces `new S3Client({ region: target.region, requestHandler: auditNetwork.requestHandler(), credentials: { accessKeyId, secretAccess…` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `accessKeyId.trim`, `secretAccessKey.trim`, `auditNetwork.requestHandler` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `accessKeyId.trim`, `secretAccessKey.trim`, `auditNetwork.requestHandler`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: target: RemoteAuditTarget
   * 输出 / Returns: `new S3Client({ region: target.region, requestHandler: auditNetwork.requestHandler(), credentials: { accessKeyId, secretAccess…`.
   * 副作用 / Effects: `auditNetwork.requestHandler`.
   * 拒绝 / Refusals: 条件 / conditions `!accessKeyId?.trim() || !secretAccessKey?.trim()`; 异常 / errors `new AppError( '远程审计需要 AWS_ACCESS_KEY_ID 和 AWS_SECRET_ACCESS_KEY 环境凭据；不会自动获取 IAM 或元数据凭据', 503, 'REMOTE_AUDIT_CREDENTIALS_REQUI…`.
   */
  private client(target: RemoteAuditTarget) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;
    // The SDK default chain can make its own metadata/STS calls or start a
    // credential_process outside our transport. Only explicit credentials enter it.
    if (!accessKeyId?.trim() || !secretAccessKey?.trim())
      throw new AppError(
        '远程审计需要 AWS_ACCESS_KEY_ID 和 AWS_SECRET_ACCESS_KEY 环境凭据；不会自动获取 IAM 或元数据凭据',
        503,
        'REMOTE_AUDIT_CREDENTIALS_REQUIRED',
      );
    return new S3Client({
      region: target.region,
      requestHandler: auditNetwork.requestHandler(),
      credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
      ...(target.endpoint ? { endpoint: target.endpoint, forcePathStyle: true } : {}),
      maxAttempts: 2,
    });
  }
  /**
   * 入口 / Entry: S3RemoteAuditStore.locked.
   * 功能：在同步并验证远端审计对象中，执行此领域的具体处理步骤并返回其结果；本入口产生 `response.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled'` 供上层消费（`S3RemoteAuditStore`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `S3RemoteAuditStore`; this entry produces `response.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled'` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `this.client`, `client.send`, `AbortSignal.timeout`, `client.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.client`, `client.send`, `AbortSignal.timeout`, `client.destroy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: target: RemoteAuditTarget; signal: AbortSignal optional
   * 输出 / Returns: `response.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled'`.
   * 副作用 / Effects: `client.send`; `AbortSignal.timeout`; `client.destroy`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `client.destroy();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `client.destroy();`; these steps also apply to exceptional exits.
   */
  async locked(target: RemoteAuditTarget, signal?: AbortSignal) {
    const client = this.client(target);
    try {
      const response = await client.send(
        new GetObjectLockConfigurationCommand({
          Bucket: target.bucket,
        }),
        { abortSignal: signal || AbortSignal.timeout(15_000) },
      );
      return response.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled';
    } finally {
      client.destroy();
    }
  }
  /**
   * 入口 / Entry: S3RemoteAuditStore.put.
   * 功能：在同步并验证远端审计对象中，执行此领域的具体处理步骤并返回其结果；本入口产生 `response.VersionId` 供上层消费（`S3RemoteAuditStore`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `S3RemoteAuditStore`; this entry produces `response.VersionId` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `this.client`, `client.send`, `createHash().update().digest`, `createHash().update` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.client`, `client.send`, `createHash().update().digest`, `createHash().update`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: target: RemoteAuditTarget; key: string; body: string; retainUntil: Date; signal: AbortSignal optional
   * 输出 / Returns: `response.VersionId`.
   * 副作用 / Effects: `client.send`; `createHash().update().digest`; `createHash().update`; `createHash`; `AbortSignal.timeout`.
   * 拒绝 / Refusals: 条件 / conditions `!response.VersionId`; 异常 / errors `new AppError('远端未返回受保护对象版本 ID', 409)`.
   * 收尾：退出 try 区域时始终执行 `client.destroy();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `client.destroy();`; these steps also apply to exceptional exits.
   */
  async put(target: RemoteAuditTarget, key: string, body: string, retainUntil: Date, signal?: AbortSignal) {
    const client = this.client(target);
    try {
      const bytes = Buffer.from(body);
      const response = await client.send(
        new PutObjectCommand({
          Bucket: target.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'application/json',
          IfNoneMatch: '*',
          ChecksumAlgorithm: 'SHA256',
          ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
          ObjectLockMode: 'COMPLIANCE',
          ObjectLockRetainUntilDate: retainUntil,
        }),
        { abortSignal: signal || AbortSignal.timeout(15_000) },
      );
      if (!response.VersionId) throw new AppError('远端未返回受保护对象版本 ID', 409);
      return response.VersionId;
    } finally {
      client.destroy();
    }
  }
  /**
   * 入口 / Entry: S3RemoteAuditStore.read.
   * 功能：在同步并验证远端审计对象中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ body, versionId: head.VersionId, mode: head.ObjectLockMode, retainUntil: head.ObjectLockRetainUntilDate, }` 供上层消费（`S3RemoteAuditStore`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `S3RemoteAuditStore`; this entry produces `{ body, versionId: head.VersionId, mode: head.ObjectLockMode, retainUntil: head.ObjectLockRetainUntilDate, }` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `this.client`, `client.send`, `AbortSignal.timeout`, `chunks.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.client`, `client.send`, `AbortSignal.timeout`, `chunks.push`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: target: RemoteAuditTarget; key: string; versionId: string optional; signal: AbortSignal optional
   * 输出 / Returns: `{ body, versionId: head.VersionId, mode: head.ObjectLockMode, retainUntil: head.ObjectLockRetainUntilDate, }`.
   * 副作用 / Effects: `client.send`; `AbortSignal.timeout`; `chunks.push`; `client.destroy`; 更新 / updates `bytes`.
   * 拒绝 / Refusals: 条件 / conditions `!head.VersionId || head.ContentLength === undefined || head.ContentLength < 1 || head.ContentLength > 2048`; `!content.Body || content.ContentLength !== head.ContentLength`; `bytes > 2048`; 异常 / errors `new AppError('远端审计锚点缺少版本或内容过大', 409)`; `new AppError('远端审计锚点内容不一致', 409)`.
   * 收尾：退出 try 区域时始终执行 `client.destroy();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `client.destroy();`; these steps also apply to exceptional exits.
   */
  async read(target: RemoteAuditTarget, key: string, versionId?: string, signal?: AbortSignal) {
    const client = this.client(target);
    try {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: target.bucket,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
        { abortSignal: signal || AbortSignal.timeout(15_000) },
      );
      if (
        !head.VersionId ||
        head.ContentLength === undefined ||
        head.ContentLength < 1 ||
        head.ContentLength > 2048
      )
        throw new AppError('远端审计锚点缺少版本或内容过大', 409);
      const content = await client.send(
        new GetObjectCommand({ Bucket: target.bucket, Key: key, VersionId: head.VersionId }),
        { abortSignal: signal || AbortSignal.timeout(15_000) },
      );
      if (!content.Body || content.ContentLength !== head.ContentLength)
        throw new AppError('远端审计锚点内容不一致', 409);
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of content.Body as Readable) {
        bytes += chunk.length;
        if (bytes > 2048) throw new AppError('远端审计锚点内容过大', 409);
        chunks.push(Buffer.from(chunk));
      }
      if (bytes !== head.ContentLength) throw new AppError('远端审计锚点长度不符', 409);
      const body = Buffer.concat(chunks).toString('utf8');
      return {
        body,
        versionId: head.VersionId,
        mode: head.ObjectLockMode,
        retainUntil: head.ObjectLockRetainUntilDate,
      };
    } finally {
      client.destroy();
    }
  }
}

/** Publishes the verified local audit head as a protected, version-addressed remote anchor. */
export class RemoteAuditLock {
  private state?: State;
  private pending = Promise.resolve();
  private timer?: ScheduleHandle;
  private closed = false;
  /**
   * 入口 / Entry: RemoteAuditLock.constructor.
   * 功能：建立 RemoteAuditLock 的同步并验证远端审计对象上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the RemoteAuditLock context for this module's responsibility: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: audit: AuditLog; file: default=join(DATA, 'remote-audit.json'); store: RemoteAuditStore default=new S3RemoteAuditStore(); now: default=Date.now; intervalMs: default=3_600_000; backgroundAllowed: default=() => true
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private audit: AuditLog,
    private file = join(DATA, 'remote-audit.json'),
    private store: RemoteAuditStore = new S3RemoteAuditStore(),
    private now = Date.now,
    private intervalMs = 3_600_000,
    private backgroundAllowed = () => true,
  ) {}

  /**
   * 入口 / Entry: RemoteAuditLock.init.
   * 功能：在同步并验证远端审计对象中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.timer`（`RemoteAuditLock`）。
   * Purpose: Initializes and verifies current domain state in `RemoteAuditLock`; the outcome is recorded in `this.state`, `this.timer`. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `readStore`, `stateSchema.parse`, `anchorBody.parse`, `state.last.key.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `stateSchema.parse`, `anchorBody.parse`, `state.last.key.startsWith`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `created`; `this.intervalMs > 0`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `state.last.key.startsWith`; `writeStore`; `scheduler.register`; 更新 / updates `this.state`, `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `state.last && state.target && JSON.stringify(state.last.target) !== JSON.stringify(state.target)`; `state.last`; `body.hostId !== state.hostId || body.sequence !== state.last.sequence || body.hash !== state.last.hash || !state.last.key.sta…`; 异常 / errors `new AppError('远程审计目标与已锚定目标不一致', 503)`; `new Error('anchor mismatch')`.
   * 失败处理：catch 分支执行 `throw new AppError('远程审计锚点本地记录损坏', 503);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('远程审计锚点本地记录损坏', 503);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init() {
    let created = false;
    const raw = await readStore(this.file, () => {
      created = true;
      return { version: 1 as const, hostId: randomUUID(), target: null };
    });
    const state = stateSchema.parse(raw);
    if (state.last && state.target && JSON.stringify(state.last.target) !== JSON.stringify(state.target))
      throw new AppError('远程审计目标与已锚定目标不一致', 503);
    if (state.last) {
      try {
        const body = anchorBody.parse(JSON.parse(state.last.body));
        const prefix =
          `${state.last.target.prefix ? state.last.target.prefix + '/' : ''}` +
          `sakura-audit/${state.hostId}/`;
        if (
          body.hostId !== state.hostId ||
          body.sequence !== state.last.sequence ||
          body.hash !== state.last.hash ||
          !state.last.key.startsWith(prefix)
        )
          throw new Error('anchor mismatch');
      } catch {
        throw new AppError('远程审计锚点本地记录损坏', 503);
      }
    }
    if (created) await writeStore(this.file, state);
    this.state = state;
    if (this.intervalMs > 0) {
      this.timer = scheduler.register({
        owner: 'core:remote-audit',
        label: '审计远程锚点发布',
        intervalMs: this.intervalMs,
        overlap: 'skip',
        backoff: { initialMs: this.intervalMs, maxMs: Math.min(2147483647, this.intervalMs * 4) },
        /**
         * 入口 / Entry: RemoteAuditLock.init.run.
         * 功能：在同步并验证远端审计对象中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`RemoteAuditLock`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `RemoteAuditLock`; the calls and state transitions below complete the operation. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
         * 处理：通过 `this.backgroundAllowed`, `this.sync` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.backgroundAllowed`, `this.sync`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.state?.target && !this.closed && this.backgroundAllowed()`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: async () => {
          if (this.state?.target && !this.closed && this.backgroundAllowed()) await this.sync();
        },
      });
    }
  }
  /**
   * 入口 / Entry: RemoteAuditLock.ready.
   * 功能：在同步并验证远端审计对象中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.state` 供上层消费（`RemoteAuditLock`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RemoteAuditLock`; this entry produces `this.state` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.state`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.state`; 异常 / errors `new AppError('远程审计服务尚未启动', 503)`.
   */
  private ready() {
    if (!this.state) throw new AppError('远程审计服务尚未启动', 503);
    return this.state;
  }
  /**
   * 入口 / Entry: RemoteAuditLock.serial.
   * 功能：在同步并验证远端审计对象中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`RemoteAuditLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RemoteAuditLock`; this entry produces `task` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `this.pending.catch().then`, `this.pending.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.catch().then`, `this.pending.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.pending
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('远程审计服务正在关闭', 503);
        return work();
      });
    this.pending = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  /**
   * 入口 / Entry: RemoteAuditLock.save.
   * 功能：在同步并验证远端审计对象中，校验并提交领域状态变更；处理结果记录到 `this.state`（`RemoteAuditLock`）。
   * Purpose: Validates and commits a domain state change in `RemoteAuditLock`; the outcome is recorded in `this.state`. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `writeStore`, `stateSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`, `stateSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: state: State
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(state: State) {
    await writeStore(this.file, stateSchema.parse(state));
    this.state = state;
  }
  /**
   * 入口 / Entry: RemoteAuditLock.status.
   * 功能：在同步并验证远端审计对象中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ hostId: state.hostId, target: state.target, last: state.last && { key: state.last.key, versionId: state.last.versionId, seq…` 供上层消费（`RemoteAuditLock`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RemoteAuditLock`; this entry produces `{ hostId: state.hostId, target: state.target, last: state.last && { key: state.last.key, versionId: state.last.versionId, seq…` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `this.ready`, `this.audit.read`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ready`, `this.audit.read`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ hostId: state.hostId, target: state.target, last: state.last && { key: state.last.key, versionId: state.last.versionId, seq…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async status() {
    const state = this.ready();
    const local = await this.audit.read(0, undefined, state.last);
    return {
      hostId: state.hostId,
      target: state.target,
      last: state.last && {
        key: state.last.key,
        versionId: state.last.versionId,
        sequence: state.last.sequence,
        hash: state.last.hash,
        retainUntil: state.last.retainUntil,
      },
      local: local.valid
        ? { valid: true, sequence: local.sequence, hash: local.hash }
        : { valid: false, error: local.error },
      protected: Boolean(state.last && Date.parse(state.last.retainUntil) > this.now()),
      caughtUp: Boolean(
        local.valid && state.last && local.sequence === state.last.sequence && local.hash === state.last.hash,
      ),
      lastAttemptAt: state.lastAttemptAt,
      lastVerifiedAt: state.lastVerifiedAt,
      lastError: state.lastError,
    };
  }
  /**
   * 入口 / Entry: RemoteAuditLock.configure.
   * 功能：在同步并验证远端审计对象中，校验并提交领域状态变更；本入口产生 `this.serial(async () => { const current = this.ready(); if (current.last && JSON.stringify(current.last.target) !== JSON.stri…` 供上层消费（`RemoteAuditLock`）。
   * Purpose: Validates and commits a domain state change in `RemoteAuditLock`; this entry produces `this.serial(async () => { const current = this.ready(); if (current.last && JSON.stringify(current.last.target) !== JSON.stri…` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `remoteAuditTarget.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `remoteAuditTarget.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown; signal: AbortSignal optional
   * 输出 / Returns: `this.serial(async () => { const current = this.ready(); if (current.last && JSON.stringify(current.last.target) !== JSON.stri…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  configure(input: unknown, signal?: AbortSignal) {
    const target = remoteAuditTarget.parse(input);
    /**
     * 入口 / Entry: RemoteAuditLock.configure.callback@336.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.status()`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `current.last && JSON.stringify(current.last.target) !== JSON.stringify(target)`; `!(await this.store.locked(target, signal))`; 异常 / errors `new AppError('已有审计锚点，不能更换目标或保留期', 409)`; `new AppError('远程桶未启用 Object Lock', 409)`.
     */
    return this.serial(async () => {
      const current = this.ready();
      if (current.last && JSON.stringify(current.last.target) !== JSON.stringify(target))
        throw new AppError('已有审计锚点，不能更换目标或保留期', 409);
      if (!(await this.store.locked(target, signal))) throw new AppError('远程桶未启用 Object Lock', 409);
      await this.save({ ...current, target, lastError: undefined });
      return this.status();
    });
  }
  /**
   * 入口 / Entry: RemoteAuditLock.disable.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.serial(async () => { await this.save({ ...this.ready(), target: null }); return this.status(); })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  disable() {
    return this.serial(async () => {
      await this.save({ ...this.ready(), target: null });
      return this.status();
    });
  }
  /**
   * 入口 / Entry: RemoteAuditLock.verifyAnchor.
   * 功能：在同步并验证远端审计对象中，执行此领域的具体处理步骤并返回其结果；本入口产生 `remote` 供上层消费（`RemoteAuditLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RemoteAuditLock`; this entry produces `remote` for its caller. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `this.store.read`, `remote.retainUntil.getTime`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.store.read`, `remote.retainUntil.getTime`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: item: Anchor; signal: AbortSignal optional
   * 输出 / Returns: `remote`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `remote.versionId !== item.versionId || remote.body !== item.body || remote.mode !== 'COMPLIANCE' || !remote.retainUntil || re…`; 异常 / errors `new AppError('远端审计锚点内容或不可变保留期校验失败', 409)`.
   */
  private async verifyAnchor(item: Anchor, signal?: AbortSignal) {
    const remote = await this.store.read(item.target, item.key, item.versionId, signal);
    if (
      remote.versionId !== item.versionId ||
      remote.body !== item.body ||
      remote.mode !== 'COMPLIANCE' ||
      !remote.retainUntil ||
      remote.retainUntil.getTime() < Date.parse(item.retainUntil) - 1000 ||
      remote.retainUntil.getTime() <= this.now()
    )
      throw new AppError('远端审计锚点内容或不可变保留期校验失败', 409);
    return remote;
  }
  /**
   * 入口 / Entry: RemoteAuditLock.verify.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: `this.serial(async () => { const current = this.ready(); const attempt = new Date(this.now()).toISOString(); try { if (!curren…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  verify(signal?: AbortSignal) {
    /**
     * 入口 / Entry: RemoteAuditLock.verify.callback@365.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.status()`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!current.last`; `!local.valid || local.sequence < current.last.sequence || (local.sequence === current.last.sequence && local.hash !== current…`; 异常 / errors `new AppError('尚无远程审计锚点', 409)`; `new AppError('本地审计链与已锚定版本不一致', 409)`.
     * 失败处理：catch 分支执行 `await this.save({ ...current, lastAttemptAt: attempt, lastError: String((error as Error).message || error).slice(0, 500), });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `await this.save({ ...current, lastAttemptAt: attempt, lastError: String((error as Error).message || error).slice(0, 500), });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serial(async () => {
      const current = this.ready();
      const attempt = new Date(this.now()).toISOString();
      try {
        if (!current.last) throw new AppError('尚无远程审计锚点', 409);
        const local = await this.audit.read(0, undefined, current.last);
        if (
          !local.valid ||
          local.sequence < current.last.sequence ||
          (local.sequence === current.last.sequence && local.hash !== current.last.hash)
        )
          throw new AppError('本地审计链与已锚定版本不一致', 409);
        await this.verifyAnchor(current.last, signal);
        await this.save({
          ...current,
          lastAttemptAt: attempt,
          lastVerifiedAt: attempt,
          lastError: undefined,
        });
        return this.status();
      } catch (error) {
        await this.save({
          ...current,
          lastAttemptAt: attempt,
          lastError: String((error as Error).message || error).slice(0, 500),
        });
        throw error;
      }
    });
  }
  /**
   * 入口 / Entry: RemoteAuditLock.sync.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: `this.serial(async () => { const current = this.ready(); if (!current.target) throw new AppError('请先配置远程审计目标', 409); const att…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  sync(signal?: AbortSignal) {
    /**
     * 入口 / Entry: RemoteAuditLock.sync.callback@396.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.status()`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!current.target`; `!local.valid`; `current.last && (local.sequence < current.last.sequence || (local.sequence === current.last.sequence && local.hash !== curren…`; 异常 / errors `new AppError('请先配置远程审计目标', 409)`; `new AppError('本地审计链校验失败：' + local.error, 409)`.
     * 失败处理：catch 分支执行 `await this.save({ ...current, lastAttemptAt: attempt, lastError: String((error as Error).message || error).slice(0, 500), });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `await this.save({ ...current, lastAttemptAt: attempt, lastError: String((error as Error).message || error).slice(0, 500), });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serial(async () => {
      const current = this.ready();
      if (!current.target) throw new AppError('请先配置远程审计目标', 409);
      const attempt = new Date(this.now()).toISOString();
      try {
        const local = await this.audit.read(0, undefined, current.last);
        if (!local.valid) throw new AppError('本地审计链校验失败：' + local.error, 409);
        if (
          current.last &&
          (local.sequence < current.last.sequence ||
            (local.sequence === current.last.sequence && local.hash !== current.last.hash))
        )
          throw new AppError('本地审计链落后于远程锚点', 409);
        if (!(await this.store.locked(current.target, signal)))
          throw new AppError('远程桶未启用 Object Lock', 409);
        if (current.last) await this.verifyAnchor(current.last, signal);
        // Renew the anchor before retention lapses even when no new audit event exists.
        if (
          current.last &&
          local.sequence === current.last.sequence &&
          local.hash === current.last.hash &&
          Date.parse(current.last.retainUntil) > this.now() + 2 * 86_400_000
        ) {
          await this.save({
            ...current,
            lastAttemptAt: attempt,
            lastVerifiedAt: attempt,
            lastError: undefined,
          });
          return this.status();
        }
        const body = JSON.stringify(
          anchorBody.parse({
            format: 'sakura-audit-anchor/v1',
            hostId: current.hostId,
            sequence: local.sequence,
            hash: local.hash,
            createdAt: attempt,
            previous: current.last ? { key: current.last.key, versionId: current.last.versionId } : null,
          }),
        );
        const key =
          `${current.target.prefix ? current.target.prefix + '/' : ''}` +
          `sakura-audit/${current.hostId}/${local.sequence}-${local.hash}-${randomUUID()}.json`;
        const retainUntil = new Date(this.now() + current.target.retentionDays * 86_400_000);
        const versionId = await this.store.put(current.target, key, body, retainUntil, signal);
        const nextAnchor: Anchor = {
          target: current.target,
          key,
          versionId,
          sequence: local.sequence,
          hash: local.hash,
          body,
          retainUntil: retainUntil.toISOString(),
        };
        await this.verifyAnchor(nextAnchor, signal);
        await this.save({
          ...current,
          last: nextAnchor,
          lastAttemptAt: attempt,
          lastVerifiedAt: attempt,
          lastError: undefined,
        });
        return this.status();
      } catch (error) {
        await this.save({
          ...current,
          lastAttemptAt: attempt,
          lastError: String((error as Error).message || error).slice(0, 500),
        });
        throw error;
      }
    });
  }
  /**
   * 入口 / Entry: RemoteAuditLock.close.
   * 功能：在同步并验证远端审计对象中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`RemoteAuditLock`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `RemoteAuditLock`; the outcome is recorded in `this.closed`. Module context: Synchronizes/verifies remote audit objects with explicit credentials, object integrity and remote lock handling.
   * 处理：通过 `this.timer.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.timer?.close();
    await this.pending;
  }
}
