/**
 * 模块职责：管理同伴配对、传输、迁移和策略发布，核对证书指纹及远端发布或激活回执。
 * Module purpose: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
 */
import { PeerReplicaOperations } from './domains/peer-replica-operations.ts';
import { peerActivationInput as activateInput, peerReplicaActivationInput as replicaActivateInput,
  peerActivationResult as activateResult, peerActivationCheckResult as activateCheckResult,
  peerRetirementResult as retireResult } from '../shared/contracts/peer-transfer.ts';
import { PeerMigrationSessions, migrationQmpInput, type MigrationChannel } from './domains/peer-migration-sessions.ts';

import { networkFor } from './network/index.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { type Server as HttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { createSecureContext, type TLSSocket } from 'node:tls';
import type { Duplex, Writable } from 'node:stream';
import { generate } from 'selfsigned';
import { z } from 'zod';
import { liveMigrationTargetStatusSchema, liveMigrationPrepareReceiptSchema } from '../shared/contracts/live-migration.ts';
import { captureOperationCheck } from './operation-context.ts';
import { readJsonBody } from './http.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { createSchema, organizationSchema } from '../shared/contracts/vm.ts';
import { DATA } from './paths.ts';
import { featureRolloutRequest } from './feature-rollouts.ts';
import { qmp } from './qmp.ts';
import { liveMigrationProjectsSchema } from './live-migration-projects.ts';
import { isLiveMigrationStoppedRequest } from './live-migration-proof.ts';
import { haWitnessReplicaInventorySchema, type HaWitnessReplicaInventory } from './ha-witness-core.ts';

const {
  httpsRequest,
  createHttpsServer,
  dial,
  createServer: createTcpServer,
} = networkFor('core:host-peers');
const authenticatedMigrationCompletions = new WeakSet<object>();
/**
 * 入口 / Entry: isAuthenticatedMigrationCompletion.
 * 功能：从当前输入或状态计算 `authenticatedMigrationCompletions.has(value)`，供调用方后续验证或使用。
 * Purpose: Computes `authenticatedMigrationCompletions.has(value)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: object
 * 输出 / Returns: `authenticatedMigrationCompletions.has(value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const isAuthenticatedMigrationCompletion = (value: object) => authenticatedMigrationCompletions.has(value);

/**
 * 入口 / Entry: hash.
 * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`host-peers.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-peers.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string | Buffer
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fingerprint = z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const hostName = z.string().trim().min(1).max(128);
const listenerSchema = z
  .object({
    enabled: z.boolean(),
    host: z.enum(['127.0.0.1', '0.0.0.0']),
    port: z.number().int().min(1024).max(65535),
  })
  .strict();
/**
 * 入口 / Entry: callback@57.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.string().max().refine / 请输入带端口的 HTTPS 主机地址，不能包含路径或凭据）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.string().max().refine / 请输入带端口的 HTTPS 主机地址，不能包含路径或凭据).
 * 输入 / Inputs: value
 * 输出 / Returns: `( url.protocol === 'https:' && !!url.hostname && !!url.port && Number(url.port) >= 1024 && !url.username && !url.password && …`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
const peerUrl = z
  .string()
  .max(512)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        !!url.hostname &&
        !!url.port &&
        Number(url.port) >= 1024 &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, '请输入带端口的 HTTPS 主机地址，不能包含路径或凭据');
const certificateSchema = z
  .object({
    key: z.string().min(100).max(16000),
    cert: z.string().min(100).max(16000),
  })
  .strict();
const incomingSchema = z
  .object({
    id: z.uuid(),
    requesterId: z.uuid(),
    name: hostName,
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number().int().nonnegative(),
    allowImport: z.boolean().default(false),
    allowPolicy: z.boolean().default(false),
    allowActivate: z.boolean().default(false),
    allowFailover: z.boolean().default(false),
  })
  .strict();
const rolloutPolicySchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    enabled: z.boolean(),
    percentage: z.number().int().min(0).max(100),
    cohortVersion: z.string().min(1).max(64),
    revision: z.number().int().positive(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const rolloutViewSchema = z
  .object({ hostId: z.uuid(), policies: z.array(rolloutPolicySchema).max(128) })
  .strict();
export type PeerRolloutView = z.infer<typeof rolloutViewSchema>;
const outboundSchema = z
  .object({
    id: z.uuid(),
    remoteId: z.uuid(),
    name: hostName,
    url: peerUrl,
    fingerprint,
    token: tokenSchema,
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
const storeSchema = z
  .object({
    version: z.literal(1),
    hostId: z.uuid(),
    name: hostName,
    certificate: certificateSchema,
    listener: listenerSchema,
    incoming: z.array(incomingSchema).max(16),
    outbound: z.array(outboundSchema).max(16),
  })
  .strict();
const statusSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    name: hostName,
    platform: z.string().min(1).max(32),
    arch: z.string().min(1).max(32),
    cpus: z.number().int().min(1).max(4096),
    memoryTotal: z.number().int().nonnegative(),
    memoryFree: z.number().int().nonnegative(),
    load: z.array(z.number().finite().nonnegative()).length(3),
    vmCount: z.number().int().nonnegative(),
    runningVms: z.number().int().nonnegative(),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export type PeerStatus = z.infer<typeof statusSchema>;
type Store = z.infer<typeof storeSchema>;
type Observation = { status?: PeerStatus; error?: string; checkedAt: number; lastSuccessAt?: number };
const importReceiptSchema = z
  .object({
    id: z.uuid(),
    name: createSchema.shape.name,
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    sourceVmId: z.uuid().optional(),
    snapshotId: z.uuid().optional(),
  })
  .strict();
type ImportReceipt = z.infer<typeof importReceiptSchema>;
type ImportIdentity = { transferId: string; requesterId: string };
const liveTargetPrepareInput = z
  .object({
    transferId: z.uuid(),
    sourceVmId: z.uuid(),
    config: createSchema,
    key: z.string().min(100).max(16_000),
    seedBase64: z
      .string()
      .min(100)
      .max(1_400_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    projects: liveMigrationProjectsSchema.optional(),
    organization: organizationSchema.optional(),
    completionProtocol: z.literal(1).optional(),
  })
  .strict();
const liveTargetReceipt = liveMigrationPrepareReceiptSchema;
const liveTargetCompleteInput = z
  .object({ targetVmId: z.uuid(), transferId: z.uuid(), sessionId: z.uuid(), sourceStopped: z.literal(true).optional() })
  .strict();
const liveTargetAbortInput = liveTargetCompleteInput.omit({ sourceStopped: true }).safeExtend({
  sourceRunning: z.literal(true),
});
const liveTargetAbortResult = z.object({ targetVmId: z.uuid(), aborted: z.literal(true) }).strict();
const liveTargetStatusInput = liveTargetCompleteInput.omit({ sessionId: true, sourceStopped: true });
const liveTargetStatus = liveMigrationTargetStatusSchema;
type ImportReceiver = {
  /**
   * 签名 / Signature: ImportReceiver.status.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 status 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for status in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: identity: ImportIdentity
   * 输出 / Returns: Promise<ImportReceipt | null>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  status: (identity: ImportIdentity) => Promise<ImportReceipt | null>;
  /**
   * 签名 / Signature: ImportReceiver.receive.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 receive 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for receive in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: ImportIdentity & { name: string; sourceVmId?: string; snapshotId?: string; source: In…
   * 输出 / Returns: Promise<ImportReceipt>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  receive: (
    input: ImportIdentity & {
      name: string;
      sourceVmId?: string;
      snapshotId?: string;
      source: IncomingMessage;
      signal: AbortSignal;
    },
  ) => Promise<ImportReceipt>;
  /**
   * 签名 / Signature: ImportReceiver.activate.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 activate 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for activate in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: ImportIdentity & { remoteVmId: string; sha256: string }
   * 输出 / Returns: Promise<z.infer<typeof activateResult>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  activate?: (
    input: ImportIdentity & { remoteVmId: string; sha256: string },
  ) => Promise<z.infer<typeof activateResult>>;
  /**
   * 签名 / Signature: ImportReceiver.inspectActivation.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 inspectActivation 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for inspectActivation in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: ImportIdentity & { remoteVmId: string; sha256: string }
   * 输出 / Returns: Promise<z.infer<typeof activateResult>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  inspectActivation?: (
    input: ImportIdentity & { remoteVmId: string; sha256: string },
  ) => Promise<z.infer<typeof activateResult>>;
  /**
   * 签名 / Signature: ImportReceiver.activateReplica.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 activateReplica 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for activateReplica in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: ImportIdentity & z.infer<typeof replicaActivateInput>
   * 输出 / Returns: Promise<z.infer<typeof activateResult>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  activateReplica?: (
    input: ImportIdentity & z.infer<typeof replicaActivateInput>,
  ) => Promise<z.infer<typeof activateResult>>;
  /**
   * 签名 / Signature: ImportReceiver.inspectReplicaActivation.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 inspectReplicaActivation 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for inspectReplicaActivation in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: ImportIdentity & z.infer<typeof replicaActivateInput>
   * 输出 / Returns: Promise<z.infer<typeof activateResult>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  inspectReplicaActivation?: (
    input: ImportIdentity & z.infer<typeof replicaActivateInput>,
  ) => Promise<z.infer<typeof activateResult>>;
  /**
   * 签名 / Signature: ImportReceiver.retireReplica.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 retireReplica 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for retireReplica in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: ImportIdentity & z.infer<typeof replicaActivateInput>
   * 输出 / Returns: Promise<z.infer<typeof retireResult>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  retireReplica?: (
    input: ImportIdentity & z.infer<typeof replicaActivateInput>,
  ) => Promise<z.infer<typeof retireResult>>;
  /**
   * 签名 / Signature: ImportReceiver.inspectReplicas.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 inspectReplicas 的输入与结果契约，所属容器为 ImportReceiver。
   * Purpose: Declares the input/result contract for inspectReplicas in ImportReceiver. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: { requesterId: string; sourceVmId: string; targetHostId: string; }
   * 输出 / Returns: Promise<HaWitnessReplicaInventory>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  inspectReplicas?: (input: {
    requesterId: string;
    sourceVmId: string;
    targetHostId: string;
  }) => Promise<HaWitnessReplicaInventory>;
};
const pairInput = z
  .object({ code: z.string().regex(/^[A-F0-9]{10}$/), requesterId: z.uuid(), name: hostName })
  .strict();
const pairResponse = z.object({ id: z.uuid(), name: hostName, token: tokenSchema }).strict();
export const hostScoreInput = z
  .object({
    cpus: z.number().int().min(1).max(128),
    memoryMiB: z.number().int().min(256).max(131072),
  })
  .strict();
export type HostScoreInput = z.infer<typeof hostScoreInput>;
export const hostPeerRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('listener'), listener: listenerSchema }).strict(),
  z.object({ operation: z.literal('create-code') }).strict(),
  z.object({ operation: z.literal('revoke-code') }).strict(),
  z
    .object({ operation: z.literal('connect'), url: peerUrl, fingerprint, code: pairInput.shape.code })
    .strict(),
  z.object({ operation: z.literal('remove-outbound'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('revoke-inbound'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('allow-import'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('allow-policy'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('allow-activate'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('allow-failover'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('refresh') }).strict(),
  z.object({ operation: z.literal('score'), requirements: hostScoreInput }).strict(),
]);

/**
 * 入口 / Entry: initial.
 * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ version: 1, hostId: randomUUID(), name, certificate: { key: certificate.private, cert: certificate.cert }, listener: { enab…` 供上层消费（`host-peers.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-peers.ts`; this entry produces `{ version: 1, hostId: randomUUID(), name, certificate: { key: certificate.private, cert: certificate.cert }, listener: { enab…` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
 * 处理：通过 `generate`, `randomUUID` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `generate`, `randomUUID`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: name: string
 * 输出 / Returns: Promise<Store>；结果来自 / values from `{ version: 1, hostId: randomUUID(), name, certificate: { key: certificate.private, cert: certificate.cert }, listener: { enab…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function initial(name: string): Promise<Store> {
  const certificate = await generate([{ name: 'commonName', value: 'Sakura Peer' }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 3600_000),
    notAfterDate: new Date(Date.now() + 5 * 365 * 86400_000),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
    ],
  });
  return {
    version: 1,
    hostId: randomUUID(),
    name,
    certificate: { key: certificate.private, cert: certificate.cert },
    listener: { enabled: false, host: '127.0.0.1', port: 7443 },
    incoming: [],
    outbound: [],
  };
}

/**
 * 入口 / Entry: checkPinnedCertificate.
 * 功能：在管理同伴配对、传输、迁移和策略发布中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`host-peers.ts`）。
 * Purpose: Checks admission, input or resource ownership in `host-peers.ts`; the calls and state transitions below complete the operation. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
 * 处理：通过 `socket.getPeerCertificate` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `socket.getPeerCertificate`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: socket: TLSSocket; pin: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `certificate?.fingerprint256 !== pin`; `Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()`; 异常 / errors `new AppError('远端证书指纹不匹配', 409)`; `new AppError('远端证书尚未生效或已过期', 409)`.
 */
function checkPinnedCertificate(socket: TLSSocket, pin: string) {
  const raw = socket.getPeerCertificate(true)?.raw;
  const certificate = raw ? new X509Certificate(raw) : null;
  if (certificate?.fingerprint256 !== pin) throw new AppError('远端证书指纹不匹配', 409);
  if (Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now())
    throw new AppError('远端证书尚未生效或已过期', 409);
}

/**
 * 入口 / Entry: requestPeer.
 * 功能：从当前输入或状态计算 `new Promise((resolve, reject) => { const request = httpsRequest( url, { method, agent: false, rejectUnauthorized: false, sign…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise((resolve, reject) => { const request = httpsRequest( url, { method, agent: false, rejectUnauthorized: false, sign…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: urlText: string; pin: string; path: string; method: 'GET' | 'POST'; payload: unknown optional; token: string optional; timeoutMs: default=10_000
 * 输出 / Returns: Promise<unknown>；结果来自 / values from `new Promise((resolve, reject) => { const request = httpsRequest( url, { method, agent: false, rejectUnauthorized: false, sign…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function requestPeer(
  urlText: string,
  pin: string,
  path: string,
  method: 'GET' | 'POST',
  payload?: unknown,
  token?: string,
  timeoutMs = 10_000,
): Promise<unknown> {
  const url = new URL(path, urlText);
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  /**
   * 入口 / Entry: requestPeer.callback@292.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `AbortSignal.timeout`; `request.once`; `request.on`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise((resolve, reject) => {
    /**
     * 入口 / Entry: requestPeer.callback@305.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（httpsRequest）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (httpsRequest).
     * 输入 / Inputs: response
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const request = httpsRequest(
      url,
      {
        method,
        agent: false,
        rejectUnauthorized: false,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024) request.destroy(new AppError('远端响应超过上限', 502));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
              throw new AppError(`远端返回 HTTP ${response.statusCode || 0}`, 502);
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      },
    );
    request.once('socket', (socket) => {
      socket.once('secureConnect', () => {
        try {
          checkPinnedCertificate(socket as TLSSocket, pin);
          request.end(body);
        } catch (error) {
          request.destroy(error as Error);
        }
      });
    });
    request.on('error', reject);
  });
}

/**
 * 入口 / Entry: connectPinnedPeerStream.
 * 功能：从当前输入或状态计算 `new Promise((resolve, reject) => { const request = httpsRequest(new URL(path, urlText), { method: 'CONNECT', agent: false, re…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise((resolve, reject) => { const request = httpsRequest(new URL(path, urlText), { method: 'CONNECT', agent: false, re…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: urlText: string; pin: string; path: string; token: string
 * 输出 / Returns: Promise<Duplex>；结果来自 / values from `new Promise((resolve, reject) => { const request = httpsRequest(new URL(path, urlText), { method: 'CONNECT', agent: false, re…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function connectPinnedPeerStream(urlText: string, pin: string, path: string, token: string): Promise<Duplex> {
  /**
   * 入口 / Entry: connectPinnedPeerStream.callback@340.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `setTimeout`; `request.once`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise((resolve, reject) => {
    const request = httpsRequest(new URL(path, urlText), {
      method: 'CONNECT',
      agent: false,
      rejectUnauthorized: false,
      headers: { authorization: `Bearer ${token}` },
    });
    const timer = setTimeout(() => request.destroy(new AppError('迁移通道连接超时', 504)), 10_000);
    timer.unref();
    let settled = false;
    /**
     * 入口 / Entry: connectPinnedPeerStream.fail.
     * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`host-peers.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-peers.ts`; this entry produces `void` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 处理：通过 `clearTimeout`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `clearTimeout`, `reject`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `settled`.
     * 输入 / Inputs: error: Error
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `clearTimeout`; 更新 / updates `settled`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    request.once('socket', (socket) =>
      socket.once('secureConnect', () => {
        try {
          checkPinnedCertificate(socket as TLSSocket, pin);
          request.end();
        } catch (error) {
          request.destroy(error as Error);
        }
      }),
    );
    /**
     * 入口 / Entry: connectPinnedPeerStream.callback@366.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（request.once / connect）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (request.once / connect).
     * 输入 / Inputs: response; socket; head
     * 输出 / Returns: `fail(new AppError(`远端迁移通道返回 HTTP ${response.statusCode || 0}`, 502))`.
     * 副作用 / Effects: `socket.destroy`; `socket.unshift`; `clearTimeout`; 更新 / updates `settled`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    request.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        return fail(new AppError(`远端迁移通道返回 HTTP ${response.statusCode || 0}`, 502));
      }
      if (head.length) socket.unshift(head);
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    request.once('response', (response) => {
      response.resume();
      fail(new AppError(`远端迁移通道返回 HTTP ${response.statusCode || 0}`, 502));
    });
    request.once('error', fail);
  });
}

export type HostPeerDependencies = {
  importReceiver?: ImportReceiver;
  liveMigrationReceiver?: {
    /**
     * 签名 / Signature: HostPeerDependencies.prepare.
     * 功能：为管理同伴配对、传输、迁移和策略发布声明 prepare 的输入与结果契约，所属容器为 HostPeerDependencies。
     * Purpose: Declares the input/result contract for prepare in HostPeerDependencies. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 输入 / Inputs: input: { requesterId: string; transferId: string; sourceVmId: string; config: z.infer<typeof…
     * 输出 / Returns: Promise<z.infer<typeof liveTargetReceipt>>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    prepare: (input: {
      requesterId: string;
      transferId: string;
      sourceVmId: string;
      config: z.infer<typeof createSchema>;
      key: string;
      seed: Buffer;
      projects?: z.infer<typeof liveMigrationProjectsSchema>;
      organization?: z.infer<typeof organizationSchema>;
      completionProtocol?: 1;
    }) => Promise<z.infer<typeof liveTargetReceipt>>;
    /**
     * 签名 / Signature: HostPeerDependencies.complete.
     * 功能：为管理同伴配对、传输、迁移和策略发布声明 complete 的输入与结果契约，所属容器为 HostPeerDependencies。
     * Purpose: Declares the input/result contract for complete in HostPeerDependencies. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 输入 / Inputs: input: z.infer<typeof liveTargetCompleteInput> & { requesterId: string }
     * 输出 / Returns: Promise<z.infer<typeof liveTargetStatus>>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    complete: (
      input: z.infer<typeof liveTargetCompleteInput> & { requesterId: string },
    ) => Promise<z.infer<typeof liveTargetStatus>>;
    /**
     * 签名 / Signature: HostPeerDependencies.abort.
     * 功能：为管理同伴配对、传输、迁移和策略发布声明 abort 的输入与结果契约，所属容器为 HostPeerDependencies。
     * Purpose: Declares the input/result contract for abort in HostPeerDependencies. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 输入 / Inputs: input: z.infer<typeof liveTargetAbortInput> & { requesterId: string }
     * 输出 / Returns: Promise<z.infer<typeof liveTargetAbortResult>>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    abort: (
      input: z.infer<typeof liveTargetAbortInput> & { requesterId: string },
    ) => Promise<z.infer<typeof liveTargetAbortResult>>;
    /**
     * 签名 / Signature: HostPeerDependencies.status.
     * 功能：为管理同伴配对、传输、迁移和策略发布声明 status 的输入与结果契约，所属容器为 HostPeerDependencies。
     * Purpose: Declares the input/result contract for status in HostPeerDependencies. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 输入 / Inputs: input: z.infer<typeof liveTargetStatusInput> & { requesterId: string }
     * 输出 / Returns: Promise<z.infer<typeof liveTargetStatus>>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    status: (
      input: z.infer<typeof liveTargetStatusInput> & { requesterId: string },
    ) => Promise<z.infer<typeof liveTargetStatus>>;
  };
  rolloutReceiver?: {
  /**
   * 签名 / Signature: HostPeerDependencies.view.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 view 的输入与结果契约，所属容器为 HostPeerDependencies。
   * Purpose: Declares the input/result contract for view in HostPeerDependencies. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: PeerRolloutView.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  view: () => PeerRolloutView;
  /**
   * 签名 / Signature: HostPeerDependencies.save.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 save 的输入与结果契约，所属容器为 HostPeerDependencies。
   * Purpose: Declares the input/result contract for save in HostPeerDependencies. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<unknown>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  save: (input: unknown) => Promise<unknown> };
  /**
   * 签名 / Signature: HostPeerDependencies.mobileHandler.
   * 功能：为管理同伴配对、传输、迁移和策略发布声明 mobileHandler 的输入与结果契约，所属容器为 HostPeerDependencies。
   * Purpose: Declares the input/result contract for mobileHandler in HostPeerDependencies. Module responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 输入 / Inputs: request: IncomingMessage; response: ServerResponse
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  mobileHandler?: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
};

export class HostPeers {
  private state!: Store;
  private server?: HttpsServer;
  private timer?: ScheduleHandle;
  private code?: { value: string; expiresAt: number };
  private attempts = new Map<string, { count: number; until: number }>();
  private observations = new Map<string, Observation>();
  private writes: Promise<unknown> = Promise.resolve();
  private refreshing?: Promise<void>;
  private closed = false;
  private listenerError?: string;
  /**
   * 入口 / Entry: HostPeers.importReceiver.
   * 功能：从当前输入或状态计算 `this.handlers(this).importReceiver`，供调用方后续验证或使用。
   * Purpose: Computes `this.handlers(this).importReceiver` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.handlers(this).importReceiver`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get importReceiver() {
    return this.handlers(this).importReceiver;
  }
  /**
   * 入口 / Entry: HostPeers.liveMigrationReceiver.
   * 功能：从当前输入或状态计算 `this.handlers(this).liveMigrationReceiver`，供调用方后续验证或使用。
   * Purpose: Computes `this.handlers(this).liveMigrationReceiver` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.handlers(this).liveMigrationReceiver`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get liveMigrationReceiver() {
    return this.handlers(this).liveMigrationReceiver;
  }
  /**
   * 入口 / Entry: HostPeers.rolloutReceiver.
   * 功能：从当前输入或状态计算 `this.handlers(this).rolloutReceiver`，供调用方后续验证或使用。
   * Purpose: Computes `this.handlers(this).rolloutReceiver` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.handlers(this).rolloutReceiver`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get rolloutReceiver() {
    return this.handlers(this).rolloutReceiver;
  }
  /**
   * 入口 / Entry: HostPeers.mobileHandler.
   * 功能：从当前输入或状态计算 `this.handlers(this).mobileHandler`，供调用方后续验证或使用。
   * Purpose: Computes `this.handlers(this).mobileHandler` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.handlers(this).mobileHandler`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private get mobileHandler() {
    return this.handlers(this).mobileHandler;
  }
  private activeImports = new Map<string, Set<AbortController>>();
  private transferIds = new Set<string>();
  private readonly migration = new PeerMigrationSessions({
    /**
     * 入口 / Entry: HostPeers.unavailable.
     * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.closed || !this.ready() || this.blocked()` 供上层消费（`HostPeers`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `this.closed || !this.ready() || this.blocked()` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 处理：通过 `this.ready`, `this.blocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.ready`, `this.blocked`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.closed || !this.ready() || this.blocked()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    unavailable: () => this.closed || !this.ready() || this.blocked(),
    /**
     * 入口 / Entry: HostPeers.now.
     * 功能：把本层请求转交 `this.now`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.now` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.now()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    now: () => this.now(),
    /**
     * 入口 / Entry: HostPeers.inbound.
     * 功能：把本层请求转交 `this.inbound`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.inbound` and propagates the provider result or rejection.
     * 输入 / Inputs: request
     * 输出 / Returns: `this.inbound(request)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    inbound: request => this.inbound(request),
    /**
     * 入口 / Entry: HostPeers.canReceive.
     * 功能：从当前输入或状态计算 `this.state.incoming.some(peer => peer.requesterId === requesterId && peer.allowImport && peer.allowActivate)`，供调用方后续验证或使用。
     * Purpose: Computes `this.state.incoming.some(peer => peer.requesterId === requesterId && peer.allowImport && peer.allowActivate)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: requesterId
     * 输出 / Returns: `this.state.incoming.some(peer => peer.requesterId === requesterId && peer.allowImport && peer.allowActivate)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    canReceive: requesterId => this.state.incoming.some(peer => peer.requesterId === requesterId && peer.allowImport && peer.allowActivate),
    /**
     * 入口 / Entry: HostPeers.outbound.
     * 功能：把本层请求转交 `this.state.outbound.find`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.state.outbound.find` and propagates the provider result or rejection.
     * 输入 / Inputs: peerId
     * 输出 / Returns: `this.state.outbound.find(peer => peer.id === peerId)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    outbound: peerId => this.state.outbound.find(peer => peer.id === peerId),
    dial, createServer: createTcpServer, connectPinned: connectPinnedPeerStream, query: qmp,
  });
  /**
   * 入口 / Entry: HostPeers.constructor.
   * 功能：建立 HostPeers 的管理同伴配对、传输、迁移和策略发布上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HostPeers context for this module's responsibility: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: snapshot: () => Promise<Omit<PeerStatus, 'version' | 'id' | 'name' | 'checkedAt'>>; file: default=join(DATA, 'host-peers.json'); name: default='Sakura'; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; now: default=Date.now; handlers: (peer: HostPeers) => HostPeerDependencies default=() => ({}); ready: () => boolean default=() => true
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private snapshot: () => Promise<Omit<PeerStatus, 'version' | 'id' | 'name' | 'checkedAt'>>,
    private file = join(DATA, 'host-peers.json'),
    private name = 'Sakura',
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private now = Date.now,
    private handlers: (peer: HostPeers) => HostPeerDependencies = () => ({}),
    private ready: () => boolean = () => true,
  ) {}

  /**
   * 入口 / Entry: HostPeers.init.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.listenerError`, `this.timer`（`HostPeers`）。
   * Purpose: Initializes and verifies current domain state in `HostPeers`; the outcome is recorded in `this.state`, `this.listenerError`, `this.timer`. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!info`; `schedule && this.state.listener.enabled`; `schedule`.
   * 输入 / Inputs: schedule: default=true
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createSecureContext`; `writeStore`; `this.listen`; `scheduler.register`; 更新 / updates `this.state`, `this.listenerError`, `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 1024 * 1024)`; `new Set(this.state.incoming.map((item) => item.id)).size !== this.state.incoming.length || new Set(this.state.outbound.map((i…`; 异常 / errors `new AppError('主机配对存储类型或大小无效')`; `new AppError('主机配对记录重复')`.
   * 失败处理：catch 分支执行 `this.listenerError = (error as Error).message;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.listenerError = (error as Error).message;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init(schedule = true) {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 1024 * 1024)) throw new AppError('主机配对存储类型或大小无效');
    this.state = info
      ? storeSchema.parse(
          await readStore(this.file, () => {
            throw new Error('missing');
          }),
        )
      : await initial(this.name);
    if (
      new Set(this.state.incoming.map((item) => item.id)).size !== this.state.incoming.length ||
      new Set(this.state.outbound.map((item) => item.id)).size !== this.state.outbound.length ||
      new Set(this.state.outbound.map((item) => item.remoteId)).size !== this.state.outbound.length
    )
      throw new AppError('主机配对记录重复');
    createSecureContext(this.state.certificate);
    if (!info) await writeStore(this.file, this.state);
    if (schedule && this.state.listener.enabled) {
      try {
        await this.listen();
      } catch (error) {
        this.listenerError = (error as Error).message;
      }
    }
    if (schedule) {
      this.timer = scheduler.register({
        owner: 'core:host-peers',
        label: '协作宿主状态刷新',
        intervalMs: 30000,
        immediate: true,
        overlap: 'skip',
        /**
         * 入口 / Entry: HostPeers.init.run.
         * 功能：把本层请求转交 `this.refresh`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.refresh` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.refresh()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: () => this.refresh(),
      });
    }
  }

  /**
   * 入口 / Entry: HostPeers.listen.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，读取或核对领域状态并构造调用方可消费的结果；处理结果记录到 `server.requestTimeout`, `this.server`（`HostPeers`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HostPeers`; the outcome is recorded in `server.requestTimeout`, `this.server`. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `createHttpsServer`, `server.on`, `server.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createHttpsServer`, `server.on`, `server.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `createHttpsServer`; `server.close`; 更新 / updates `server.requestTimeout`, `this.server`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `server.close();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `server.close();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async listen() {
    const server = createHttpsServer(
      { ...this.state.certificate, minVersion: 'TLSv1.2' },
      (request, response) => void this.peerRoute(request, response),
    );
    server.requestTimeout = 10_000;
    server.on('connect', (request, socket, head) => this.acceptMigrationStream(request, socket, head));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.state.listener.port, this.state.listener.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      this.server = server;
      server.on('error', (error) => {
        this.listenerError = error.message;
      });
    } catch (error) {
      server.close();
      throw error;
    }
  }

  /**
   * 入口 / Entry: HostPeers.send.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; the calls and state transitions below complete the operation. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `response.writeHead`, `response.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `response.writeHead`, `response.end`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: response: ServerResponse; payload: unknown; status: default=200
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `response.writeHead`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private send(response: ServerResponse, payload: unknown, status = 200) {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    response.end(JSON.stringify(payload));
  }

  /**
   * 入口 / Entry: HostPeers.acceptMigrationStream.
   * 功能：把本层请求转交 `this.migration.acceptMigrationStream`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.migration.acceptMigrationStream` and propagates the provider result or rejection.
   * 输入 / Inputs: request: IncomingMessage; socket: Duplex; head: Buffer
   * 输出 / Returns: `this.migration.acceptMigrationStream(request, socket, head)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async acceptMigrationStream(request: IncomingMessage, socket: Duplex, head: Buffer) {
    return this.migration.acceptMigrationStream(request, socket, head);
  }
  /**
   * 入口 / Entry: HostPeers.registerMigrationSession.
   * 功能：把本层请求转交 `this.migration.registerMigrationSession`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.migration.registerMigrationSession` and propagates the provider result or rejection.
   * 输入 / Inputs: requesterId: string; ports: Record<MigrationChannel, number> & { qmp?: number; targetDiskNode?: string; targetVmI…
   * 输出 / Returns: `this.migration.registerMigrationSession(requesterId, ports)`.
   * 副作用 / Effects: `this.migration.registerMigrationSession`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  registerMigrationSession(requesterId: string, ports: Record<MigrationChannel, number> & {
    qmp?: number; targetDiskNode?: string; targetVmId?: string; transferId?: string; sessionId?: string;
  }) { return this.migration.registerMigrationSession(requesterId, ports); }
  /**
   * 入口 / Entry: HostPeers.matchesMigrationSession.
   * 功能：把本层请求转交 `this.migration.matchesMigrationSession`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.migration.matchesMigrationSession` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; requesterId: string; targetVmId: string; transferId: string
   * 输出 / Returns: `this.migration.matchesMigrationSession(id, requesterId, targetVmId, transferId)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  matchesMigrationSession(id: string, requesterId: string, targetVmId: string, transferId: string) {
    return this.migration.matchesMigrationSession(id, requesterId, targetVmId, transferId);
  }
  /**
   * 入口 / Entry: HostPeers.closeMigrationSession.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`HostPeers`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostPeers`; the calls and state transitions below complete the operation. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.migration.closeMigrationSession` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.migration.closeMigrationSession`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.migration.closeMigrationSession`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  closeMigrationSession(id: string) { this.migration.closeMigrationSession(id); }
  /**
   * 入口 / Entry: HostPeers.openMigrationForward.
   * 功能：把本层请求转交 `this.migration.openMigrationForward`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.migration.openMigrationForward` and propagates the provider result or rejection.
   * 输入 / Inputs: peerId: string; sessionId: string; channel: MigrationChannel
   * 输出 / Returns: `this.migration.openMigrationForward(peerId, sessionId, channel)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async openMigrationForward(peerId: string, sessionId: string, channel: MigrationChannel) {
    return this.migration.openMigrationForward(peerId, sessionId, channel);
  }

  /**
   * 入口 / Entry: HostPeers.targetMigrationQmp.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `requestPeer( peer.url, peer.fingerprint, '/peer/migration-qmp', 'POST', migrationQmpInput.parse({ sessionId, command, args })…` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `requestPeer( peer.url, peer.fingerprint, '/peer/migration-qmp', 'POST', migrationQmpInput.parse({ sessionId, command, args })…` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `this.state.outbound.find`, `requestPeer`, `migrationQmpInput.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.state.outbound.find`, `requestPeer`, `migrationQmpInput.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; sessionId: string; command: string; args: Record<string, unknown> optional; timeoutMs: default=10_000
   * 输出 / Returns: `requestPeer( peer.url, peer.fingerprint, '/peer/migration-qmp', 'POST', migrationQmpInput.parse({ sessionId, command, args })…`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.blocked()`; `!peer`; 异常 / errors `new AppError('服务不可用', 503)`; `new AppError('远端主机不存在', 404)`.
   */
  async targetMigrationQmp(
    peerId: string,
    sessionId: string,
    command: string,
    args?: Record<string, unknown>,
    timeoutMs = 10_000,
  ) {
    if (this.closed || this.blocked()) throw new AppError('服务不可用', 503);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    return requestPeer(
      peer.url,
      peer.fingerprint,
      '/peer/migration-qmp',
      'POST',
      migrationQmpInput.parse({ sessionId, command, args }),
      peer.token,
      Math.min(Math.max(timeoutMs, 1000), 15_000),
    );
  }

  /**
   * 入口 / Entry: HostPeers.prepareLiveTarget.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `liveTargetReceipt.parse( await requestPeer( peer.url, peer.fingerprint, '/peer/live-target-prepare', 'POST', input, peer.toke…` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `liveTargetReceipt.parse( await requestPeer( peer.url, peer.fingerprint, '/peer/live-target-prepare', 'POST', input, peer.toke…` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `this.state.outbound.find`, `liveTargetPrepareInput.parse`, `liveTargetReceipt.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.state.outbound.find`, `liveTargetPrepareInput.parse`, `liveTargetReceipt.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: `liveTargetReceipt.parse( await requestPeer( peer.url, peer.fingerprint, '/peer/live-target-prepare', 'POST', input, peer.toke…`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.blocked()`; `!peer`; 异常 / errors `new AppError('服务不可用', 503)`; `new AppError('远端主机不存在', 404)`.
   */
  async prepareLiveTarget(peerId: string, raw: unknown) {
    if (this.closed || this.blocked()) throw new AppError('服务不可用', 503);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const input = liveTargetPrepareInput.parse(raw);
    return liveTargetReceipt.parse(
      await requestPeer(
        peer.url,
        peer.fingerprint,
        '/peer/live-target-prepare',
        'POST',
        input,
        peer.token,
        120_000,
      ),
    );
  }

  /**
   * 入口 / Entry: HostPeers.completeLiveTarget.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `result` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `captureOperationCheck`, `check`, `liveTargetCompleteInput.parse`, `isLiveMigrationStoppedRequest` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `captureOperationCheck`, `check`, `liveTargetCompleteInput.parse`, `isLiveMigrationStoppedRequest`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `input.sourceStopped && !isLiveMigrationStoppedRequest(raw)`; `this.closed || this.blocked()`; `!peer`; 异常 / errors `new AppError('来源退出声明仅允许原迁移域核验端口提交', 403, 'LIVE_MIGRATION_SYSTEM_ONLY')`; `new AppError('服务不可用', 503)`.
   */
  async completeLiveTarget(peerId: string, raw: unknown) {
    const check = captureOperationCheck();
    await check();
    const input = liveTargetCompleteInput.parse(raw);
    if (input.sourceStopped && !isLiveMigrationStoppedRequest(raw))
      throw new AppError('来源退出声明仅允许原迁移域核验端口提交', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
    if (this.closed || this.blocked()) throw new AppError('服务不可用', 503);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const identity = JSON.stringify([peer.remoteId, peer.url, peer.fingerprint, peer.token]);
    const result = liveTargetStatus.parse(
      await requestPeer(
        peer.url,
        peer.fingerprint,
        '/peer/live-target-complete',
        'POST',
        input,
        peer.token,
        30_000,
      ),
    );
    await check();
    const current = this.state.outbound.find(item => item.id === peerId);
    if (this.closed || this.blocked() || !current || JSON.stringify([current.remoteId, current.url, current.fingerprint, current.token]) !== identity)
      throw new AppError('原在线迁移同伴身份已变化', 409);
    return result;
  }

  /**
   * 入口 / Entry: HostPeers.abortLiveTarget.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，结束、撤销或清理本次拥有的领域资源；本入口产生 `liveTargetAbortResult.parse( await requestPeer( peer.url, peer.fingerprint, '/peer/live-target-abort', 'POST', liveTargetAbor…` 供上层消费（`HostPeers`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostPeers`; this entry produces `liveTargetAbortResult.parse( await requestPeer( peer.url, peer.fingerprint, '/peer/live-target-abort', 'POST', liveTargetAbor…` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `this.state.outbound.find`, `liveTargetAbortResult.parse`, `requestPeer` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.state.outbound.find`, `liveTargetAbortResult.parse`, `requestPeer`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: `liveTargetAbortResult.parse( await requestPeer( peer.url, peer.fingerprint, '/peer/live-target-abort', 'POST', liveTargetAbor…`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.blocked()`; `!peer`; 异常 / errors `new AppError('服务不可用', 503)`; `new AppError('远端主机不存在', 404)`.
   */
  async abortLiveTarget(peerId: string, raw: unknown) {
    if (this.closed || this.blocked()) throw new AppError('服务不可用', 503);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    return liveTargetAbortResult.parse(
      await requestPeer(
        peer.url,
        peer.fingerprint,
        '/peer/live-target-abort',
        'POST',
        liveTargetAbortInput.parse(raw),
        peer.token,
        30_000,
      ),
    );
  }

  /**
   * 入口 / Entry: HostPeers.inspectLiveTarget.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result` 供上层消费（`HostPeers`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HostPeers`; this entry produces `result` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `captureOperationCheck`, `check`, `this.blocked`, `this.state.outbound.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `captureOperationCheck`, `check`, `this.blocked`, `this.state.outbound.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; raw: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.blocked()`; `!peer`; `this.closed || this.blocked() || !current || JSON.stringify([current.remoteId, current.url, current.fingerprint, current.toke…`; 异常 / errors `new AppError('服务不可用', 503)`; `new AppError('远端主机不存在', 404)`.
   */
  async inspectLiveTarget(peerId: string, raw: unknown) {
    const check = captureOperationCheck();
    await check();
    if (this.closed || this.blocked()) throw new AppError('服务不可用', 503);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const input = liveTargetStatusInput.parse(raw);
    const path = `/peer/live-target-status?targetVmId=${input.targetVmId}&transferId=${input.transferId}`;
    const identity = JSON.stringify([peer.remoteId, peer.url, peer.fingerprint, peer.token]);
    const result = liveTargetStatus.parse(
      await requestPeer(peer.url, peer.fingerprint, path, 'GET', undefined, peer.token),
    );
    await check();
    const current = this.state.outbound.find(item => item.id === peerId);
    if (this.closed || this.blocked() || !current || JSON.stringify([current.remoteId, current.url, current.fingerprint, current.token]) !== identity)
      throw new AppError('原在线迁移同伴身份已变化', 409);
    return result;
  }

  /**
   * 入口 / Entry: HostPeers.peerRoute.
   * 功能：处理已配对同伴的导入、迁移、副本与策略请求并返回核验回执。
   * Purpose: Handles paired-peer import/migration/replica/rollout requests and returns verified receipts.
   * 设计：请求先核对配对来源和目标身份；多阶段迁移或激活不因一个 HTTP 成功就删除来源证据。
   * Design: Pairing/source/target checks precede work; one HTTP success does not erase evidence of a multi-stage migration or activation.
   * 输入 / Inputs: request: IncomingMessage; response: ServerResponse
   * 输出 / Returns: `await this.mobileHandler(request, response)`; `this.send(response, result)`; `this.send(response, await this.status())`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `request.url.startsWith`; `this.attempts.delete`; `this.attempts.set`; `this.send`; `this.migration.executeMigrationQmp`; 更新 / updates `this.code`, `result`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!this.ready()`; `request.url === '/mobile' || request.url?.startsWith('/mobile/')`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('服务装配尚未就绪', 503, 'SERVICE_NOT_READY')`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`; `authenticatedMigrationCompletions.delete(admitted);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; `authenticatedMigrationCompletions.delete(admitted);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `const status = error instanceof AppError ? error.status : 400;`; `if (!response.destroyed && !response.headersSent) this.send(response, { error: status >= 500 ? '同伴请求失败' : (error as Error).me…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const status = error instanceof AppError ? error.status : 400;`; `if (!response.destroyed && !response.headersSent) this.send(response, { error: status >= 500 ? '同伴请求失败' : (error as Error).me…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async peerRoute(request: IncomingMessage, response: ServerResponse) {
    try {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (!this.ready()) throw new AppError('服务装配尚未就绪', 503, 'SERVICE_NOT_READY');
      if (request.url === '/mobile' || request.url?.startsWith('/mobile/')) {
        if (!this.mobileHandler) throw new AppError('移动伴侣尚未启用', 503);
        return await this.mobileHandler(request, response);
      }
      if (request.method === 'POST' && request.url === '/peer/pair') {
        const address = request.socket.remoteAddress || 'unknown';
        const attempt = this.attempts.get(address);
        if (!attempt && this.attempts.size >= 1024)
          for (const [key, item] of this.attempts) if (item.until <= this.now()) this.attempts.delete(key);
        if (!attempt && this.attempts.size >= 1024) throw new AppError('配对尝试容量已满', 429);
        if (attempt && attempt.until > this.now() && attempt.count >= 5)
          throw new AppError('配对尝试过多，请稍后重试', 429);
        this.attempts.set(address, {
          count: attempt?.until && attempt.until > this.now() ? attempt.count + 1 : 1,
          until: this.now() + 300_000,
        });
        if (this.attempts.size > 1024)
          for (const [key, value] of this.attempts) if (value.until <= this.now()) this.attempts.delete(key);
        const value = pairInput.parse(await readJsonBody(request, 4096));
        this.mutation(1);
        try {
          /**
           * 入口 / Entry: HostPeers.peerRoute.callback@671.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
           * 输入 / Inputs: next
           * 输出 / Returns: `{ id: next.hostId, name: next.name, token }`.
           * 副作用 / Effects: `next.incoming.push`.
           * 拒绝 / Refusals: 条件 / conditions `!this.code || this.code.expiresAt <= this.now() || !timingSafeEqual(Buffer.from(this.code.value), Buffer.from(value.code))`; `value.requesterId === next.hostId`; `next.incoming.length >= 16`; 异常 / errors `new AppError('配对码无效或已过期', 403)`; `new AppError('不能配对本机', 409)`.
           */
          const result = await this.change((next) => {
            if (
              !this.code ||
              this.code.expiresAt <= this.now() ||
              !timingSafeEqual(Buffer.from(this.code.value), Buffer.from(value.code))
            )
              throw new AppError('配对码无效或已过期', 403);
            if (value.requesterId === next.hostId) throw new AppError('不能配对本机', 409);
            if (next.incoming.length >= 16) throw new AppError('已达到入站配对上限', 409);
            const token = randomBytes(32).toString('hex');
            next.incoming.push({
              id: randomUUID(),
              requesterId: value.requesterId,
              name: value.name,
              tokenHash: hash(token),
              createdAt: this.now(),
              allowImport: false,
              allowPolicy: false,
              allowActivate: false,
              allowFailover: false,
            });
            return { id: next.hostId, name: next.name, token };
          });
          this.code = undefined;
          return this.send(response, result);
        } finally {
          this.mutation(-1);
        }
      }
      if (request.method === 'GET' && request.url === '/peer/status') {
        this.inbound(request);
        return this.send(response, await this.status());
      }
      if (request.method === 'POST' && request.url === '/peer/migration-qmp') {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowActivate) throw new AppError('此同伴未获在线迁移接收权限', 403);
        const input = migrationQmpInput.parse(await readJsonBody(request, 4096));
        this.mutation(1);
        try {
          if (
            !this.state.incoming.some((item) => item.id === peer.id && item.allowImport && item.allowActivate)
          )
            throw new AppError('在线迁移接收权限已撤销', 403);
          return this.send(response, await this.migration.executeMigrationQmp(peer.requesterId, input));
        } finally {
          this.mutation(-1);
        }
      }
      if (request.method === 'POST' && request.url === '/peer/live-target-prepare') {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowActivate) throw new AppError('此同伴未获在线迁移接收权限', 403);
        if (!this.liveMigrationReceiver) throw new AppError('目标主机尚未启用在线迁移接收器', 503);
        const input = liveTargetPrepareInput.parse(await readJsonBody(request, 2_000_000));
        const seed = Buffer.from(input.seedBase64, 'base64');
        if (seed.toString('base64') !== input.seedBase64) throw new AppError('客户机 seed 编码无效');
        this.mutation(1);
        try {
          if (
            !this.state.incoming.some((item) => item.id === peer.id && item.allowImport && item.allowActivate)
          )
            throw new AppError('在线迁移接收权限已撤销', 403);
          return this.send(
            response,
            liveTargetReceipt.parse(
              await this.liveMigrationReceiver.prepare({
                requesterId: peer.requesterId,
                transferId: input.transferId,
                sourceVmId: input.sourceVmId,
                config: input.config,
                key: input.key,
                seed,
                projects: input.projects,
                organization: input.organization,
                completionProtocol: input.completionProtocol,
              }),
            ),
          );
        } finally {
          this.mutation(-1);
        }
      }
      if (request.method === 'POST' && request.url === '/peer/live-target-complete') {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowActivate) throw new AppError('此同伴未获在线迁移接收权限', 403);
        if (!this.liveMigrationReceiver) throw new AppError('目标主机尚未启用在线迁移接收器', 503);
        const input = liveTargetCompleteInput.parse(await readJsonBody(request, 1024));
        this.mutation(1);
        try {
          if (
            !this.state.incoming.some((item) => item.id === peer.id && item.allowImport && item.allowActivate)
          )
            throw new AppError('在线迁移接收权限已撤销', 403);
          const admitted = Object.freeze({ ...input, requesterId: peer.requesterId });
          authenticatedMigrationCompletions.add(admitted);
          let result: z.infer<typeof liveTargetStatus>;
          try { result = liveTargetStatus.parse(await this.liveMigrationReceiver.complete(admitted)); }
          finally { authenticatedMigrationCompletions.delete(admitted); }
          const current = this.inbound(request);
          if (current.id !== peer.id || !current.allowImport || !current.allowActivate)
            throw new AppError('在线迁移接收权限已撤销', 403);
          return this.send(response, result);
        } finally {
          this.mutation(-1);
        }
      }
      if (request.method === 'POST' && request.url === '/peer/live-target-abort') {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowActivate) throw new AppError('此同伴未获在线迁移接收权限', 403);
        if (!this.liveMigrationReceiver) throw new AppError('目标主机尚未启用在线迁移接收器', 503);
        const input = liveTargetAbortInput.parse(await readJsonBody(request, 1024));
        this.mutation(1);
        try {
          if (
            !this.state.incoming.some((item) => item.id === peer.id && item.allowImport && item.allowActivate)
          )
            throw new AppError('在线迁移接收权限已撤销', 403);
          return this.send(
            response,
            liveTargetAbortResult.parse(
              await this.liveMigrationReceiver.abort({
                ...input,
                requesterId: peer.requesterId,
              }),
            ),
          );
        } finally {
          this.mutation(-1);
        }
      }
      if (request.method === 'GET' && request.url?.startsWith('/peer/live-target-status?')) {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowActivate) throw new AppError('此同伴未获在线迁移接收权限', 403);
        if (!this.liveMigrationReceiver) throw new AppError('目标主机尚未启用在线迁移接收器', 503);
        const url = new URL(request.url, 'https://peer.invalid');
        if (
          url.pathname !== '/peer/live-target-status' ||
          [...url.searchParams.keys()].some((key) => key !== 'targetVmId' && key !== 'transferId') ||
          url.searchParams.getAll('targetVmId').length !== 1 ||
          url.searchParams.getAll('transferId').length !== 1
        )
          throw new AppError('目标状态请求无效');
        const input = liveTargetStatusInput.parse({
          targetVmId: url.searchParams.get('targetVmId'),
          transferId: url.searchParams.get('transferId'),
        });
        const result = liveTargetStatus.parse(await this.liveMigrationReceiver.status({ ...input, requesterId: peer.requesterId }));
        const current = this.inbound(request);
        if (current.id !== peer.id || !current.allowImport || !current.allowActivate)
          throw new AppError('在线迁移接收权限已撤销', 403);
        return this.send(response, result);
      }
      if (request.url === '/peer/rollouts' && ['GET', 'POST'].includes(request.method || '')) {
        const peer = this.inbound(request);
        if (!peer.allowPolicy) throw new AppError('此同伴未获策略发布权限', 403);
        if (!this.rolloutReceiver) throw new AppError('目标主机尚未启用策略接收器', 503);
        if (request.method === 'GET') return this.send(response, this.rolloutReceiver.view());
        const input = featureRolloutRequest.parse(await readJsonBody(request, 4096));
        if (input.operation !== 'save') throw new AppError('同伴只能发布灰度策略', 400);
        if (!this.inbound(request).allowPolicy) throw new AppError('策略发布权限已撤销', 403);
        this.mutation(1);
        try {
          await this.rolloutReceiver.save(input);
          return this.send(response, this.rolloutReceiver.view());
        } finally {
          this.mutation(-1);
        }
      }
      if (request.method === 'GET' && request.url?.startsWith('/peer/import-status?')) {
        const peer = this.inbound(request);
        if (!peer.allowImport) throw new AppError('此同伴未获导入权限', 403);
        if (!this.importReceiver) throw new AppError('目标主机尚未启用迁移接收器', 503);
        const url = new URL(request.url, 'https://peer.invalid');
        if (
          url.pathname !== '/peer/import-status' ||
          [...url.searchParams.keys()].some((key) => key !== 'id') ||
          url.searchParams.getAll('id').length !== 1
        )
          throw new AppError('无效的迁移状态请求');
        const transferId = z.uuid().parse(url.searchParams.get('id'));
        return this.send(
          response,
          await this.importReceiver.status({
            transferId,
            requesterId: peer.requesterId,
          }),
        );
      }
      if (request.method === 'GET' && request.url?.startsWith('/peer/replicas-status?')) {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowFailover) throw new AppError('此同伴未获故障副本核对权限', 403);
        if (!this.importReceiver?.inspectReplicas)
          throw new AppError('目标主机尚未提供完整故障副本清单', 503);
        const url = new URL(request.url, 'https://peer.invalid');
        if (
          url.pathname !== '/peer/replicas-status' ||
          [...url.searchParams.keys()].some((key) => key !== 'sourceVmId') ||
          url.searchParams.getAll('sourceVmId').length !== 1
        )
          throw new AppError('无效的故障副本清单请求');
        const sourceVmId = z.uuid().parse(url.searchParams.get('sourceVmId'));
        const result = haWitnessReplicaInventorySchema.parse(
          await this.importReceiver.inspectReplicas({
            requesterId: peer.requesterId,
            sourceVmId,
            targetHostId: this.state.hostId,
          }),
        );
        if (
          result.hostId !== this.state.hostId ||
          result.sourceHostId !== peer.requesterId ||
          result.sourceVmId !== sourceVmId
        )
          throw new AppError('完整故障副本清单身份不一致', 409);
        return this.send(response, result);
      }
      if (
        request.method === 'POST' &&
        (request.url === '/peer/activate' || request.url === '/peer/activate-check')
      ) {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowActivate) throw new AppError('此同伴未获目标实例启动权限', 403);
        if (!this.importReceiver?.activate || !this.importReceiver.inspectActivation)
          throw new AppError('目标主机尚未启用实例启动接收器', 503);
        const input = activateInput.parse(await readJsonBody(request, 4096));
        const identity = { transferId: input.transferId, requesterId: peer.requesterId };
        const receipt = await this.importReceiver.status(identity);
        if (!receipt?.sha256 || receipt.id !== input.remoteVmId || receipt.sha256 !== input.sha256)
          throw new AppError('目标实例与已校验的导入回执不一致', 409);
        if (receipt.sourceVmId || receipt.snapshotId)
          throw new AppError('快照复制副本不能通过冷迁移目标启动接口启动', 409);
        const current = this.inbound(request);
        if (!current.allowImport || !current.allowActivate) throw new AppError('目标实例启动权限已撤销', 403);
        const activationInput = { ...identity, remoteVmId: input.remoteVmId, sha256: input.sha256 };
        if (request.url === '/peer/activate-check') {
          const inspected = activateResult.parse(
            await this.importReceiver.inspectActivation(activationInput),
          );
          if (inspected.id !== input.remoteVmId) throw new AppError('目标实例启动预检返回了其他实例', 409);
          return this.send(response, { ready: true, id: input.remoteVmId, status: inspected.status });
        }
        this.mutation(1);
        try {
          const result = activateResult.parse(await this.importReceiver.activate(activationInput));
          if (result.id !== input.remoteVmId) throw new AppError('目标实例启动返回了其他实例', 409);
          return this.send(response, result);
        } finally {
          this.mutation(-1);
        }
      }
      if (
        request.method === 'POST' &&
        (request.url === '/peer/replica-activate' ||
          request.url === '/peer/replica-activate-check' ||
          request.url === '/peer/replica-retire')
      ) {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowFailover) throw new AppError('此同伴未获故障副本启动权限', 403);
        if (!this.importReceiver?.activateReplica || !this.importReceiver.inspectReplicaActivation)
          throw new AppError('目标主机尚未启用故障副本接收器', 503);
        const input = replicaActivateInput.parse(await readJsonBody(request, 4096));
        const identity = { transferId: input.transferId, requesterId: peer.requesterId };
        const receipt = await this.importReceiver.status(identity);
        if (
          !receipt?.sha256 ||
          receipt.id !== input.remoteVmId ||
          receipt.sha256 !== input.sha256 ||
          receipt.sourceVmId !== input.sourceVmId ||
          receipt.snapshotId !== input.snapshotId
        )
          throw new AppError('故障副本与已校验的快照回执不一致', 409);
        const current = this.inbound(request);
        if (!current.allowImport || !current.allowFailover) throw new AppError('故障副本启动权限已撤销', 403);
        const activationInput = { ...identity, ...input };
        if (request.url === '/peer/replica-retire') {
          if (!this.importReceiver.retireReplica) throw new AppError('目标主机尚未启用故障副本退出接口', 503);
          this.mutation(1);
          try {
            const result = retireResult.parse(await this.importReceiver.retireReplica(activationInput));
            if (result.id !== input.remoteVmId) throw new AppError('故障副本退出返回了其他实例', 409);
            return this.send(response, result);
          } finally {
            this.mutation(-1);
          }
        }
        if (request.url === '/peer/replica-activate-check') {
          const inspected = activateResult.parse(
            await this.importReceiver.inspectReplicaActivation(activationInput),
          );
          if (inspected.id !== input.remoteVmId) throw new AppError('故障副本预检返回了其他实例', 409);
          return this.send(response, { ready: true, id: input.remoteVmId, status: inspected.status });
        }
        this.mutation(1);
        try {
          const result = activateResult.parse(await this.importReceiver.activateReplica(activationInput));
          if (result.id !== input.remoteVmId) throw new AppError('故障副本启动返回了其他实例', 409);
          return this.send(response, result);
        } finally {
          this.mutation(-1);
        }
      }
      if (request.method === 'POST' && request.url === '/peer/import') {
        const peer = this.inbound(request);
        if (!peer.allowImport) throw new AppError('此同伴未获导入权限', 403);
        if (!this.importReceiver) throw new AppError('目标主机尚未启用迁移接收器', 503);
        if (request.headers['content-type'] !== 'application/octet-stream')
          throw new AppError('需要二进制导出包', 415);
        const transferId = z.uuid().parse(request.headers['x-sakura-transfer-id']);
        const name = createSchema.shape.name.parse(request.headers['x-sakura-target-name']);
        const sourceVmId = z.uuid().optional().parse(request.headers['x-sakura-source-vm-id']);
        const snapshotId = z.uuid().optional().parse(request.headers['x-sakura-snapshot-id']);
        if (!!sourceVmId !== !!snapshotId) throw new AppError('快照来源必须同时包含实例与快照标识');
        const identity = { transferId, requesterId: peer.requesterId };
        const previous = await this.importReceiver.status(identity);
        if (previous) {
          if (
            previous.name !== name ||
            previous.sourceVmId !== sourceVmId ||
            previous.snapshotId !== snapshotId
          )
            throw new AppError('迁移标识已用于其他来源或实例名称', 409);
          return this.send(response, previous);
        }
        const key = `${peer.requesterId}:${transferId}`;
        if (this.transferIds.has(key)) throw new AppError('此迁移任务仍在导入', 409);
        this.transferIds.add(key);
        const controller = new AbortController();
        const active = this.activeImports.get(peer.id) || new Set<AbortController>();
        active.add(controller);
        this.activeImports.set(peer.id, active);
        /**
         * 入口 / Entry: HostPeers.peerRoute.abort.
         * 功能：把本层请求转交 `controller.abort`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `controller.abort` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `controller.abort(new AppError('同伴传输已中断', 409))`.
         * 副作用 / Effects: `controller.abort`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const abort = () => controller.abort(new AppError('同伴传输已中断', 409));
        request.once('aborted', abort);
        /**
         * 入口 / Entry: HostPeers.peerRoute.closed.
         * 功能：在管理同伴配对、传输、迁移和策略发布中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`HostPeers`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostPeers`; the calls and state transitions below complete the operation. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
         * 处理：通过 `abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `abort`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `!response.writableEnded`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `abort`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const closed = () => {
          if (!response.writableEnded) abort();
        };
        response.once('close', closed);
        this.mutation(1);
        try {
          const result = await this.importReceiver.receive({
            ...identity,
            name,
            ...(sourceVmId ? { sourceVmId } : {}),
            ...(snapshotId ? { snapshotId } : {}),
            source: request,
            signal: controller.signal,
          });
          controller.signal.throwIfAborted();
          return this.send(response, result);
        } finally {
          request.off('aborted', abort);
          response.off('close', closed);
          active.delete(controller);
          if (!active.size) this.activeImports.delete(peer.id);
          this.transferIds.delete(key);
          this.mutation(-1);
        }
      }
      throw new AppError('未找到同伴接口', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 400;
      if (!response.destroyed && !response.headersSent)
        this.send(response, { error: status >= 500 ? '同伴请求失败' : (error as Error).message }, status);
    }
  }

  /**
   * 入口 / Entry: HostPeers.inbound.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `peer` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `peer` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.ready`, `inline.exec`, `hash`, `this.state.incoming.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ready`, `inline.exec`, `hash`, `this.state.incoming.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: request: IncomingMessage
   * 输出 / Returns: `peer`.
   * 副作用 / Effects: `inline.exec`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || !this.ready()`; `!peer`; 异常 / errors `new AppError('服务尚未就绪或正在关闭', 503, 'SERVICE_NOT_READY')`; `new AppError('同伴凭证无效', 401)`.
   */
  private inbound(request: IncomingMessage) {
    if (this.closed || !this.ready()) throw new AppError('服务尚未就绪或正在关闭', 503, 'SERVICE_NOT_READY');
    const credential = /^Bearer ([a-f0-9]{64})$/.exec(String(request.headers.authorization || ''))?.[1];
    const digest = credential ? Buffer.from(hash(credential), 'hex') : null;
    const peer =
      digest &&
      this.state.incoming.find((entry) => timingSafeEqual(digest, Buffer.from(entry.tokenHash, 'hex')));
    if (!peer) throw new AppError('同伴凭证无效', 401);
    return peer;
  }

  /**
   * 入口 / Entry: HostPeers.rolloutStatus.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `result` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `this.state.outbound.find`, `rolloutViewSchema.parse`, `requestPeer` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.state.outbound.find`, `rolloutViewSchema.parse`, `requestPeer`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string
   * 输出 / Returns: Promise<PeerRolloutView>；结果来自 / values from `result`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `!peer`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  async rolloutStatus(peerId: string): Promise<PeerRolloutView> {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = rolloutViewSchema.parse(
      await requestPeer(peer.url, peer.fingerprint, '/peer/rollouts', 'GET', undefined, peer.token),
    );
    if (result.hostId !== peer.remoteId) throw new AppError('远端主机身份已变化', 409);
    return result;
  }
  /**
   * 入口 / Entry: HostPeers.publishRollout.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，校验并提交领域状态变更；本入口产生 `result` 供上层消费（`HostPeers`）。
   * Purpose: Validates and commits a domain state change in `HostPeers`; this entry produces `result` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `featureRolloutRequest.parse`, `this.state.outbound.find`, `rolloutViewSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `featureRolloutRequest.parse`, `this.state.outbound.find`, `rolloutViewSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: Promise<PeerRolloutView>；结果来自 / values from `result`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `value.operation !== 'save'`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  async publishRollout(peerId: string, input: unknown): Promise<PeerRolloutView> {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = featureRolloutRequest.parse(input);
    if (value.operation !== 'save') throw new AppError('只允许发布灰度策略');
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = rolloutViewSchema.parse(
      await requestPeer(peer.url, peer.fingerprint, '/peer/rollouts', 'POST', value, peer.token),
    );
    if (result.hostId !== peer.remoteId) throw new AppError('远端主机身份已变化', 409);
    return result;
  }

  /**
   * 入口 / Entry: HostPeers.importStatus.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result === null ? null : importReceiptSchema.parse(result)` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `result === null ? null : importReceiptSchema.parse(result)` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `z.uuid().parse`, `z.uuid`, `this.state.outbound.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `z.uuid().parse`, `z.uuid`, `this.state.outbound.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; transferId: string
   * 输出 / Returns: `result === null ? null : importReceiptSchema.parse(result)`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `!peer`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  async importStatus(peerId: string, transferId: string) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    z.uuid().parse(transferId);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = await requestPeer(
      peer.url,
      peer.fingerprint,
      `/peer/import-status?id=${transferId}`,
      'GET',
      undefined,
      peer.token,
    );
    return result === null ? null : importReceiptSchema.parse(result);
  }

  /**
   * 入口 / Entry: HostPeers.activateImport.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `result` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `activateInput.parse`, `this.state.outbound.find`, `activateResult.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `activateInput.parse`, `this.state.outbound.find`, `activateResult.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `!peer`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  async activateImport(peerId: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = activateInput.parse(input);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = activateResult.parse(
      await requestPeer(peer.url, peer.fingerprint, '/peer/activate', 'POST', value, peer.token, 30_000),
    );
    if (result.id !== value.remoteVmId) throw new AppError('远端目标实例身份已变化', 409);
    return result;
  }

  /**
   * 入口 / Entry: HostPeers.checkImportActivation.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，核对调用资格、输入或资源归属；本入口产生 `result` 供上层消费（`HostPeers`）。
   * Purpose: Checks admission, input or resource ownership in `HostPeers`; this entry produces `result` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `activateInput.parse`, `this.state.outbound.find`, `activateCheckResult.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `activateInput.parse`, `this.state.outbound.find`, `activateCheckResult.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `requestPeer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `!peer`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  async checkImportActivation(peerId: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = activateInput.parse(input);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = activateCheckResult.parse(
      await requestPeer(peer.url, peer.fingerprint, '/peer/activate-check', 'POST', value, peer.token),
    );
    if (result.id !== value.remoteVmId) throw new AppError('远端目标实例身份已变化', 409);
    return result;
  }

  private readonly replicas = new PeerReplicaOperations({
    /**
     * 入口 / Entry: HostPeers.requireAvailable.
     * 功能：在管理同伴配对、传输、迁移和策略发布中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`HostPeers`）。
     * Purpose: Checks admission, input or resource ownership in `HostPeers`; the calls and state transitions below complete the operation. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 处理：通过 `this.blocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.blocked`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
     */
    requireAvailable: () => {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    },
    /**
     * 入口 / Entry: HostPeers.request.
     * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `requestPeer(peer.url, peer.fingerprint, path, 'POST', input, peer.token, timeoutMs)` 供上层消费（`HostPeers`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `requestPeer(peer.url, peer.fingerprint, path, 'POST', input, peer.token, timeoutMs)` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
     * 处理：通过 `this.state.outbound.find`, `requestPeer` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.state.outbound.find`, `requestPeer`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: peerId; path; input; timeoutMs
     * 输出 / Returns: `requestPeer(peer.url, peer.fingerprint, path, 'POST', input, peer.token, timeoutMs)`.
     * 副作用 / Effects: `requestPeer`.
     * 拒绝 / Refusals: 条件 / conditions `!peer`; 异常 / errors `new AppError('远端主机不存在', 404)`.
     */
    request: (peerId, path, input, timeoutMs) => {
      const peer = this.state.outbound.find(item => item.id === peerId);
      if (!peer) throw new AppError('远端主机不存在', 404);
      return requestPeer(peer.url, peer.fingerprint, path, 'POST', input, peer.token, timeoutMs);
    },
  });
  /**
   * 入口 / Entry: HostPeers.checkReplicaActivation.
   * 功能：把本层请求转交 `this.replicas.check`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.replicas.check` and propagates the provider result or rejection.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `this.replicas.check(peerId, input)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async checkReplicaActivation(peerId: string, input: unknown) { return this.replicas.check(peerId, input); }
  /**
   * 入口 / Entry: HostPeers.activateReplica.
   * 功能：把本层请求转交 `this.replicas.activate`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.replicas.activate` and propagates the provider result or rejection.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `this.replicas.activate(peerId, input)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async activateReplica(peerId: string, input: unknown) { return this.replicas.activate(peerId, input); }
  /**
   * 入口 / Entry: HostPeers.retireReplica.
   * 功能：把本层请求转交 `this.replicas.retire`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.replicas.retire` and propagates the provider result or rejection.
   * 输入 / Inputs: peerId: string; input: unknown
   * 输出 / Returns: `this.replicas.retire(peerId, input)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async retireReplica(peerId: string, input: unknown) { return this.replicas.retire(peerId, input); }

  /**
   * 入口 / Entry: HostPeers.change.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `work` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `work` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: (next: Store) => T
   * 输出 / Returns: Promise<T>；结果来自 / values from `work`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private change<T>(edit: (next: Store) => T): Promise<T> {
    /**
     * 入口 / Entry: HostPeers.change.callback@1132.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
     */
    const work = this.writes
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('服务正在关闭', 503);
        if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
        const next = structuredClone(this.state);
        const result = edit(next);
        await writeStore(this.file, next);
        this.state = next;
        return result;
      });
    this.writes = work;
    return work;
  }

  /**
   * 入口 / Entry: HostPeers.codeChange.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `work` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `work` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: () => void
   * 输出 / Returns: `work`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private codeChange(edit: () => void) {
    /**
     * 入口 / Entry: HostPeers.codeChange.callback@1148.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.writes.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.writes.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
     */
    const work = this.writes
      .catch(() => {})
      .then(() => {
        if (this.closed) throw new AppError('服务正在关闭', 503);
        if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
        edit();
        return this.view();
      });
    this.writes = work;
    return work;
  }

  /**
   * 入口 / Entry: HostPeers.view.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ hostId: this.state.hostId, name: this.state.name, fingerprint: new X509Certificate(this.state.certificate.cert).fingerprint…` 供上层消费（`HostPeers`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HostPeers`; this entry produces `{ hostId: this.state.hostId, name: this.state.name, fingerprint: new X509Certificate(this.state.certificate.cert).fingerprint…` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.now`, `this.state.incoming.map`, `this.state.outbound.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `this.state.incoming.map`, `this.state.outbound.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ hostId: this.state.hostId, name: this.state.name, fingerprint: new X509Certificate(this.state.certificate.cert).fingerprint…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() {
    return {
      hostId: this.state.hostId,
      name: this.state.name,
      fingerprint: new X509Certificate(this.state.certificate.cert).fingerprint256,
      listener: {
        ...this.state.listener,
        active: !!this.server,
        ...(this.listenerError ? { error: this.listenerError } : {}),
      },
      pairing: this.code && this.code.expiresAt > this.now() ? { ...this.code } : null,
      incoming: this.state.incoming.map(({ tokenHash, ...entry }) => entry),
      outbound: this.state.outbound.map(({ token, ...entry }) => ({
        ...entry,
        observation: this.observations.get(entry.id) || null,
      })),
    };
  }

  /**
   * 入口 / Entry: HostPeers.status.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `statusSchema.parse({ version: 1, id: this.state.hostId, name: this.state.name, ...(await this.snapshot()), checkedAt: new Dat…` 供上层消费（`HostPeers`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HostPeers`; this entry produces `statusSchema.parse({ version: 1, id: this.state.hostId, name: this.state.name, ...(await this.snapshot()), checkedAt: new Dat…` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `statusSchema.parse`, `this.snapshot`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `statusSchema.parse`, `this.snapshot`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<PeerStatus>；结果来自 / values from `statusSchema.parse({ version: 1, id: this.state.hostId, name: this.state.name, ...(await this.snapshot()), checkedAt: new Dat…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async status(): Promise<PeerStatus> {
    return statusSchema.parse({
      version: 1,
      id: this.state.hostId,
      name: this.state.name,
      ...(await this.snapshot()),
      checkedAt: new Date(this.now()).toISOString(),
    });
  }

  /**
   * 入口 / Entry: HostPeers.score.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ requirements, scoredAt: new Date(this.now()).toISOString(), candidates }` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `{ requirements, scoredAt: new Date(this.now()).toISOString(), candidates }` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `hostScoreInput.parse`, `this.refresh`, `this.status` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `hostScoreInput.parse`, `this.refresh`, `this.status`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `{ requirements, scoredAt: new Date(this.now()).toISOString(), candidates }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  async score(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const requirements = hostScoreInput.parse(input);
    await this.refresh();
    const local = await this.status();
    const entries: Array<{
      id: string;
      name: string;
      source: 'local' | 'peer';
      status?: PeerStatus;
      error?: string;
      observedAt?: number;
    }> = [
      { id: local.id, name: local.name, source: 'local', status: local, observedAt: this.now() },
      ...this.state.outbound.map((peer) => {
        const observation = this.observations.get(peer.id);
        return {
          id: peer.remoteId,
          name: peer.name,
          source: 'peer' as const,
          status: observation?.status,
          error: observation?.error,
          observedAt: observation?.lastSuccessAt,
        };
      }),
    ];
    const requiredBytes = requirements.memoryMiB * 1024 ** 2;
    /**
     * 入口 / Entry: HostPeers.score.callback@1216.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（entries.map）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (entries.map).
     * 输入 / Inputs: entry
     * 输出 / Returns: `{ id: entry.id, name: entry.name, source: entry.source, eligible, score, components, reasons, status: status || null, observe…`.
     * 副作用 / Effects: `reasons.push`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const candidates = entries
      .map((entry) => {
        const status = entry.status;
        const reasons: string[] = [];
        if (entry.error) reasons.push(`连接失败：${entry.error}`);
        if (!status || !entry.observedAt || this.now() - entry.observedAt > 90_000)
          reasons.push('没有 90 秒内的有效资源观测');
        if (status && status.cpus < requirements.cpus)
          reasons.push(`逻辑处理器不足：${status.cpus} < ${requirements.cpus}`);
        if (status && status.memoryFree < requiredBytes)
          reasons.push(
            `空闲内存不足：${Math.floor(status.memoryFree / 1024 ** 2)} MiB < ${requirements.memoryMiB} MiB`,
          );
        const eligible = reasons.length === 0;
        const memoryHeadroom = status
          ? Math.min(1, Math.max(0, (status.memoryFree / requiredBytes - 1) / 3))
          : 0;
        const cpuHeadroom = status ? Math.max(0, 1 - status.load[0] / status.cpus) : 0;
        const density = status ? 1 / (1 + status.runningVms / status.cpus) : 0;
        const components = {
          memory: Math.round(memoryHeadroom * 100),
          cpuLoad: Math.round(cpuHeadroom * 100),
          instanceDensity: Math.round(density * 100),
        };
        const score = eligible
          ? Math.round(100 * (0.45 * memoryHeadroom + 0.45 * cpuHeadroom + 0.1 * density))
          : null;
        return {
          id: entry.id,
          name: entry.name,
          source: entry.source,
          eligible,
          score,
          components,
          reasons,
          status: status || null,
          observedAt: entry.observedAt || null,
        };
      })
      .sort(
        (left, right) =>
          Number(right.eligible) - Number(left.eligible) ||
          (right.score ?? -1) - (left.score ?? -1) ||
          left.id.localeCompare(right.id),
      );
    return { requirements, scoredAt: new Date(this.now()).toISOString(), candidates };
  }

  /**
   * 入口 / Entry: HostPeers.upload.
   * 功能：以原传输标识向远端发送实例包并核对发布回执。
   * Purpose: Transfers a VM bundle with its original transfer identity and verifies remote publication receipts.
   * 设计：存储传输准入和源实例锁先于输出；上传结束仍等待远端确认，取消不自动证明目标未发布。
   * Design: Transfer admission/source locking precede output; upload completion still awaits publication proof and cancellation does not prove remote absence.
   * 输入 / Inputs: peerId: string; transferId: string; name: string; produce: (target: Writable, signal: AbortSignal) => Promise<unknown>; signal: AbortSignal; origin: { sourceVmId: string; snapshotId: string } optional
   * 输出 / Returns: `previous`; `await new Promise<ImportReceipt>((resolve, reject) => { let settled = false; let producerDone = false; let reply: ImportRecei…`.
   * 副作用 / Effects: `createSchema.shape.name.parse`; `AbortSignal.any`; `AbortSignal.timeout`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `!peer`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async upload(
    peerId: string,
    transferId: string,
    name: string,
    produce: (target: Writable, signal: AbortSignal) => Promise<unknown>,
    signal: AbortSignal,
    origin?: { sourceVmId: string; snapshotId: string },
  ) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    z.uuid().parse(transferId);
    createSchema.shape.name.parse(name);
    if (origin) {
      z.uuid().parse(origin.sourceVmId);
      z.uuid().parse(origin.snapshotId);
    }
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const previous = await this.importStatus(peerId, transferId);
    if (previous) {
      if (
        previous.name !== name ||
        previous.sourceVmId !== origin?.sourceVmId ||
        previous.snapshotId !== origin?.snapshotId
      )
        throw new AppError('迁移标识已用于其他来源或实例名称', 409);
      return previous;
    }
    const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]);
    operationSignal.throwIfAborted();
    const url = new URL('/peer/import', peer.url);
    this.mutation(1);
    try {
      /**
       * 入口 / Entry: HostPeers.upload.callback@1296.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: resolve; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `request.on`; `request.once`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      return await new Promise<ImportReceipt>((resolve, reject) => {
        let settled = false;
        let producerDone = false;
        let reply: ImportReceipt | undefined;
        /**
         * 入口 / Entry: HostPeers.upload.complete.
         * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostPeers`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; the calls and state transitions below complete the operation. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
         * 处理：通过 `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `resolve`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `!settled && producerDone && reply`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 更新 / updates `settled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const complete = () => {
          if (!settled && producerDone && reply) {
            settled = true;
            resolve(reply);
          }
        };
        /**
         * 入口 / Entry: HostPeers.upload.fail.
         * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HostPeers`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `void` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
         * 处理：通过 `request.destroy`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `request.destroy`, `reject`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `settled`.
         * 输入 / Inputs: error: Error
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `request.destroy`; 更新 / updates `settled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          request.destroy();
          reject(error);
        };
        /**
         * 入口 / Entry: HostPeers.upload.callback@1329.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（httpsRequest）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (httpsRequest).
         * 输入 / Inputs: response
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const request = httpsRequest(
          url,
          {
            method: 'POST',
            agent: false,
            rejectUnauthorized: false,
            signal: operationSignal,
            headers: {
              authorization: `Bearer ${peer.token}`,
              'content-type': 'application/octet-stream',
              'x-sakura-transfer-id': transferId,
              'x-sakura-target-name': name,
              ...(origin
                ? { 'x-sakura-source-vm-id': origin.sourceVmId, 'x-sakura-snapshot-id': origin.snapshotId }
                : {}),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > 64 * 1024) fail(new AppError('远端响应超过上限', 502));
              else chunks.push(chunk);
            });
            /**
             * 入口 / Entry: HostPeers.upload.callback@1337.
             * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（response.on / end）。
             * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (response.on / end).
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `void`.
             * 副作用 / Effects: 更新 / updates `reply`.
             * 拒绝 / Refusals: 条件 / conditions `!response.statusCode || response.statusCode < 200 || response.statusCode >= 300`; 异常 / errors `new AppError(`远端返回 HTTP ${response.statusCode || 0}`, 502)`.
             * 失败处理：catch 分支执行 `fail(error as Error);`，是否吞掉错误或重新拒绝由这些语句决定。
             * Failure handling: Catch paths execute `fail(error as Error);`; these statements determine whether a failure is absorbed or rejected again.
             */
            response.on('end', () => {
              if (settled) return;
              try {
                if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
                  throw new AppError(`远端返回 HTTP ${response.statusCode || 0}`, 502);
                const result = importReceiptSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                reply = result;
                complete();
              } catch (error) {
                fail(error as Error);
              }
            });
            response.on('error', fail);
          },
        );
        request.on('error', (error) => {
          if (!reply) fail(error);
        });
        /**
         * 入口 / Entry: HostPeers.upload.callback@1355.
         * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（request.once / socket）。
         * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (request.once / socket).
         * 输入 / Inputs: socket
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        request.once('socket', (socket) => {
          /**
           * 入口 / Entry: HostPeers.upload.callback@1356.
           * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（socket.once / secureConnect）。
           * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (socket.once / secureConnect).
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           * 失败处理：catch 分支执行 `fail(error as Error);`，是否吞掉错误或重新拒绝由这些语句决定。
           * Failure handling: Catch paths execute `fail(error as Error);`; these statements determine whether a failure is absorbed or rejected again.
           */
          socket.once('secureConnect', () => {
            try {
              checkPinnedCertificate(socket as TLSSocket, peer.fingerprint);
              void produce(request, operationSignal)
                .then(() => {
                  producerDone = true;
                  if (!reply && !request.writableEnded) request.end();
                  complete();
                })
                .catch((error) => {
                  producerDone = true;
                  if (reply) complete();
                  else fail(error as Error);
                });
            } catch (error) {
              fail(error as Error);
            }
          });
        });
      });
    } finally {
      this.mutation(-1);
    }
  }

  /**
   * 入口 / Entry: HostPeers.configure.
   * 功能：校验并提交同伴配对、更新或移除配置，协调证书和既有连接资源。
   * Purpose: Validates/commits peer pairing/update/removal settings with certificate and existing-connection coordination.
   * 设计：配置变化撤销原授权和通道；新身份核验后才存储，不覆盖无法确认的原传输或清理证据。
   * Design: Changes revoke original grants/channels; verified identity precedes storage and unresolved transfer/cleanup evidence is preserved.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.view()`; `this.score(value.requirements)`; `this.codeChange(() => { if (!this.server) throw new AppError('请先启用同伴入口并重启 Sakura 服务', 409); this.code = { value: randomBytes(…`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `requestPeer`; `this.observations.delete`; `this.migration.closeMigrationForwards`; `controller.abort`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `value.operation === 'connect'`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = hostPeerRequest.parse(input);
    if (value.operation === 'refresh') {
      await this.refresh();
      return this.view();
    }
    if (value.operation === 'score') return this.score(value.requirements);
    if (value.operation === 'create-code')
      return this.codeChange(() => {
        if (!this.server) throw new AppError('请先启用同伴入口并重启 Sakura 服务', 409);
        this.code = { value: randomBytes(5).toString('hex').toUpperCase(), expiresAt: this.now() + 300_000 };
      });
    if (value.operation === 'revoke-code')
      return this.codeChange(() => {
        this.code = undefined;
      });
    this.mutation(1);
    try {
      if (value.operation === 'connect') {
        if (value.fingerprint === this.view().fingerprint) throw new AppError('不能配对本机证书', 409);
        if (this.state.outbound.some((peer) => peer.url === value.url))
          throw new AppError('此地址已配对', 409);
        const result = pairResponse.parse(
          await requestPeer(value.url, value.fingerprint, '/peer/pair', 'POST', {
            code: value.code,
            requesterId: this.state.hostId,
            name: this.state.name,
          }),
        );
        if (result.id === this.state.hostId) throw new AppError('不能配对本机', 409);
        /**
         * 入口 / Entry: HostPeers.configure.callback@1413.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
         * 输入 / Inputs: next
         * 输出 / Returns: `item`.
         * 副作用 / Effects: `next.outbound.push`.
         * 拒绝 / Refusals: 条件 / conditions `next.outbound.some((item) => item.remoteId === result.id || item.url === value.url)`; `next.outbound.length >= 16`; 异常 / errors `new AppError('此主机已配对', 409)`; `new AppError('已达到出站主机上限', 409)`.
         */
        const peer = await this.change((next) => {
          if (next.outbound.some((item) => item.remoteId === result.id || item.url === value.url))
            throw new AppError('此主机已配对', 409);
          if (next.outbound.length >= 16) throw new AppError('已达到出站主机上限', 409);
          const item = {
            id: randomUUID(),
            remoteId: result.id,
            name: result.name,
            url: value.url,
            fingerprint: value.fingerprint,
            token: result.token,
            createdAt: this.now(),
          };
          next.outbound.push(item);
          return item;
        });
        await this.poll(peer);
        return this.view();
      }
      /**
       * 入口 / Entry: HostPeers.configure.callback@1432.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
       * 输入 / Inputs: next
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `next.listener`, `next.outbound`, `next.incoming`, `peer.allowImport`.
       * 拒绝 / Refusals: 条件 / conditions `value.operation === 'remove-outbound'`; `!next.outbound.some((item) => item.id === value.id)`; `value.operation === 'revoke-inbound'`; 异常 / errors `new AppError('远端主机不存在', 404)`; `new AppError('入站配对不存在', 404)`.
       */
      await this.change((next) => {
        if (value.operation === 'listener') next.listener = value.listener;
        else if (value.operation === 'remove-outbound') {
          if (!next.outbound.some((item) => item.id === value.id)) throw new AppError('远端主机不存在', 404);
          next.outbound = next.outbound.filter((item) => item.id !== value.id);
        } else if (value.operation === 'revoke-inbound') {
          if (!next.incoming.some((item) => item.id === value.id)) throw new AppError('入站配对不存在', 404);
          next.incoming = next.incoming.filter((item) => item.id !== value.id);
        } else if (value.operation === 'allow-import') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowImport = value.enabled;
        } else if (value.operation === 'allow-policy') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowPolicy = value.enabled;
        } else if (value.operation === 'allow-activate') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowActivate = value.enabled;
        } else if (value.operation === 'allow-failover') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowFailover = value.enabled;
        }
      });
      if (value.operation === 'remove-outbound') this.observations.delete(value.id);
      if (value.operation === 'remove-outbound') this.migration.closeMigrationForwards(value.id);
      if (value.operation === 'revoke-inbound' || (value.operation === 'allow-import' && !value.enabled))
        for (const controller of this.activeImports.get(value.id) || [])
          controller.abort(new AppError('导入权限已撤销', 403));
      if (
        value.operation === 'revoke-inbound' ||
        ((value.operation === 'allow-import' || value.operation === 'allow-activate') && !value.enabled)
      ) {
        this.migration.revokeUnauthorized();
      }
      return this.view();
    } finally {
      this.mutation(-1);
    }
  }

  /**
   * 入口 / Entry: HostPeers.poll.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; the calls and state transitions below complete the operation. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.now`, `statusSchema.parse`, `requestPeer`, `this.state.outbound.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `statusSchema.parse`, `requestPeer`, `this.state.outbound.some`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.state.outbound.some((item) => item.id === peer.id)`.
   * 输入 / Inputs: peer: Store['outbound'][number]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `requestPeer`; `this.observations.set`.
   * 拒绝 / Refusals: 条件 / conditions `status.id !== peer.remoteId`; 异常 / errors `new AppError('远端主机身份已变化', 409)`.
   * 失败处理：catch 分支执行 `const previous = this.observations.get(peer.id);`; `if (this.state.outbound.some((item) => item.id === peer.id)) this.observations.set(peer.id, { ...previous, checkedAt, error: …`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const previous = this.observations.get(peer.id);`; `if (this.state.outbound.some((item) => item.id === peer.id)) this.observations.set(peer.id, { ...previous, checkedAt, error: …`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async poll(peer: Store['outbound'][number]) {
    const checkedAt = this.now();
    try {
      const status = statusSchema.parse(
        await requestPeer(peer.url, peer.fingerprint, '/peer/status', 'GET', undefined, peer.token),
      );
      if (status.id !== peer.remoteId) throw new AppError('远端主机身份已变化', 409);
      if (this.state.outbound.some((item) => item.id === peer.id))
        this.observations.set(peer.id, { status, checkedAt, lastSuccessAt: checkedAt });
    } catch (error) {
      const previous = this.observations.get(peer.id);
      if (this.state.outbound.some((item) => item.id === peer.id))
        this.observations.set(peer.id, {
          ...previous,
          checkedAt,
          error: String((error as Error).message || error).slice(0, 200),
        });
    }
  }

  /**
   * 入口 / Entry: HostPeers.refresh.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `this.refreshing` 供上层消费（`HostPeers`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HostPeers`; this entry produces `void` / `this.refreshing` for its caller. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.blocked`, `Promise.all().then`, `Promise.all`, `this.state.outbound.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `Promise.all().then`, `Promise.all`, `this.state.outbound.map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.blocked()`; `this.refreshing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`; `this.refreshing`.
   * 副作用 / Effects: 更新 / updates `this.refreshing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async refresh() {
    if (this.closed || this.blocked()) return;
    if (this.refreshing) return this.refreshing;
    const task = Promise.all(this.state.outbound.map((peer) => this.poll(peer))).then(() => {});
    this.refreshing = task.finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  /**
   * 入口 / Entry: HostPeers.close.
   * 功能：在管理同伴配对、传输、迁移和策略发布中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`, `this.code`（`HostPeers`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HostPeers`; the outcome is recorded in `this.closed`, `this.code`. Module context: Owns peer pairing, transfers, migration and rollouts, verifying certificate fingerprints and remote publication/activation receipts.
   * 处理：通过 `this.migration.close`, `this.activeImports.values`, `controller.abort`, `this.timer.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.migration.close`, `this.activeImports.values`, `controller.abort`, `this.timer.close`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.server`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.migration.close`; `controller.abort`; `this.timer.close`; `this.server.closeAllConnections`; `this.writes.catch`; 更新 / updates `this.closed`, `this.code`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.code = undefined;
    this.migration.close();
    for (const active of this.activeImports.values())
      for (const controller of active) controller.abort(new AppError('服务正在关闭', 503));
    await this.timer?.close();
    if (this.server) {
      const closing = new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server.closeAllConnections();
      await closing;
    }
    await this.refreshing;
    await this.writes.catch(() => {});
  }
}
