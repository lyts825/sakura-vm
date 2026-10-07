/**
 * 模块职责：装配独立见证 HTTPS 服务及宿主动作，约束目标地址和电源状态响应。
 * Module purpose: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
 */
import { networkFor } from './network/index.ts';
import { type Server } from 'node:https';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { readJsonBody } from './http.ts';
import {
  HaWitness,
  type HaWitnessActions,
  type HaWitnessPlan,
  type HaWitnessVm,
  type HaWitnessReplicaIdentity,
  haWitnessReplicaInventorySchema,
} from './ha-witness-core.ts';
import { haHttpsRequest } from './ha-witness-http.ts';
import { lockHaWitnessState } from './ha-witness-lock.ts';

const { createHttpsServer } = networkFor('core:ha-witness-server');

const httpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
}, '需要不含凭据的 HTTPS 地址');
const baseUrl = httpsUrl.refine((value) => new URL(value).pathname === '/' &&
  !new URL(value).search, '基础 URL 不能包含路径或查询参数');
const fingerprint = z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
const bearerToken = z.string().regex(/^[a-f0-9]{64}$/);
const systemUuid = z.string().regex(/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/);
const applicationConfigSchema = z.object({ url: httpsUrl, token: bearerToken,
  fingerprint: fingerprint.optional() }).strict();

/**
 * 入口 / Entry: redfishPowerState.
 * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result.PowerState` 供上层消费（`ha-witness-server.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `result.PowerState` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
 * 处理：通过 `result.UUID.toLowerCase`, `expectedUuid.toLowerCase` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `result.UUID.toLowerCase`, `expectedUuid.toLowerCase`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: raw: unknown; expectedUuid: string
 * 输出 / Returns: `result.PowerState`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `typeof result?.UUID !== 'string' || result.UUID.toLowerCase() !== expectedUuid.toLowerCase()`; `typeof result.PowerState !== 'string' || !result.PowerState`; 异常 / errors `new AppError('Redfish 系统 UUID 与配置不一致', 409)`; `new AppError('Redfish 未返回 PowerState', 502)`.
 */
export function redfishPowerState(raw: unknown, expectedUuid: string) {
  const result = raw as { UUID?: unknown; PowerState?: unknown } | null;
  if (typeof result?.UUID !== 'string' ||
      result.UUID.toLowerCase() !== expectedUuid.toLowerCase())
    throw new AppError('Redfish 系统 UUID 与配置不一致', 409);
  if (typeof result.PowerState !== 'string' || !result.PowerState)
    throw new AppError('Redfish 未返回 PowerState', 502);
  return result.PowerState;
}

const witnessVmConfigSchema = z.object({
  sourceHostId: z.uuid(), sourceVmId: z.uuid(), targetHostId: z.uuid(),
  failureThreshold: z.number().int().min(2).max(10),
  redfish: z.object({ baseUrl, systemPath: z.string().regex(/^\/redfish\/v1\/Systems\/[A-Za-z0-9._~-]+$/),
    systemUuid,
    username: z.string().min(1).max(128), password: z.string().min(1).max(1024),
    caFile: z.string().min(1).optional(), fingerprint: fingerprint.optional(),
  }).strict().refine((value) => !!value.caFile !== !!value.fingerprint,
    '带外接口必须选择 CA 文件或证书指纹'),
  target: z.object({ baseUrl, fingerprint, token: bearerToken }).strict(),
  application: applicationConfigSchema,
  traffic: z.object({ baseUrl, token: bearerToken,
    fingerprint: fingerprint.optional() }).strict(),
  failback: z.object({ application: applicationConfigSchema }).strict().optional(),
}).strict().refine((vm) => vm.sourceHostId !== vm.targetHostId,
  '来源宿主与目标宿主必须不同');
export const haWitnessServerConfigSchema = z.object({
  version: z.literal(1), listen: z.object({ host: z.string().min(1),
    port: z.number().int().min(0).max(65535),
    certFile: z.string().min(1), keyFile: z.string().min(1) }).strict(),
  stateFile: z.string().min(1),
  sourceToken: bearerToken.optional(),
  sourceTokens: z.record(z.uuid(), bearerToken).optional(),
  vms: z.array(witnessVmConfigSchema).min(1).max(64),
}).strict().superRefine((config, context) => {
  const hosts = new Set(config.vms.map((vm) => vm.sourceHostId));
  if (!!config.sourceToken === !!config.sourceTokens ||
      (config.sourceToken && hosts.size !== 1) ||
      (config.sourceTokens &&
        (Object.keys(config.sourceTokens).length !== hosts.size ||
         [...hosts].some((host) => !config.sourceTokens?.[host]) ||
         new Set(Object.values(config.sourceTokens)).size !== hosts.size)))
    context.addIssue({ code: 'custom', path: ['sourceTokens'],
      message: '每个来源宿主须有独立令牌；全局来源令牌只适用于单一来源宿主' });
});
export type HaWitnessServerConfig = z.infer<typeof haWitnessServerConfigSchema>;
type ConfigVm = HaWitnessServerConfig['vms'][number];

/**
 * 入口 / Entry: witnessVms.
 * 功能：从当前输入或状态计算 `config.vms.map((vm) => ({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId, failureThr…`，供调用方后续验证或使用。
 * Purpose: Computes `config.vms.map((vm) => ({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId, failureThr…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: config: HaWitnessServerConfig
 * 输出 / Returns: HaWitnessVm[]；结果来自 / values from `config.vms.map((vm) => ({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId, failureThr…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function witnessVms(config: HaWitnessServerConfig): HaWitnessVm[] {
  return config.vms.map((vm) => ({ sourceHostId: vm.sourceHostId,
    sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId,
    failureThreshold: vm.failureThreshold,
    sourceSystemUuid: vm.redfish.systemUuid.toLowerCase(),
    ...(vm.failback ? { failbackBinding: createHash('sha256').update(JSON.stringify({
      sourceApplication: vm.failback.application.url,
      sourceApplicationFingerprint: vm.failback.application.fingerprint || null,
      traffic: vm.traffic.baseUrl, trafficFingerprint: vm.traffic.fingerprint || null,
    })).digest('hex') } : {}) }));
}

/**
 * 入口 / Entry: targetInput.
 * 功能：从当前输入或状态计算 `{ transferId: plan.transferId, remoteVmId: plan.remoteVmId, sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: pla…`，供调用方后续验证或使用。
 * Purpose: Computes `{ transferId: plan.transferId, remoteVmId: plan.remoteVmId, sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: pla…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: plan: HaWitnessReplicaIdentity
 * 输出 / Returns: `{ transferId: plan.transferId, remoteVmId: plan.remoteVmId, sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: pla…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function targetInput(plan: HaWitnessReplicaIdentity) {
  return { transferId: plan.transferId, remoteVmId: plan.remoteVmId,
    sha256: plan.sha256, sourceVmId: plan.sourceVmId, snapshotId: plan.snapshotId };
}

/**
 * 入口 / Entry: createHaWitnessActions.
 * 功能：根据受限配置创建见证的主机隔离、状态读取与接管动作适配器。
 * Purpose: Creates configured witness adapters for host fencing, status reads and promotion.
 * 设计：TLS 指纹、配对令牌和原主机身份在远端请求中固定；动作成功需响应和电源/实例状态核验。
 * Design: Remote requests pin TLS fingerprints, pairing credentials and host identity; success requires response and power/VM verification.
 * 输入 / Inputs: config: HaWitnessServerConfig
 * 输出 / Returns: Promise<HaWitnessActions>；结果来自 / values from `{ fence: async (identity) => { const vm = entry(identity), systemPath = vm.redfish.systemPath; const status = redfishPowerSta…`.
 * 副作用 / Effects: `ca.set`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function createHaWitnessActions(config: HaWitnessServerConfig): Promise<HaWitnessActions> {
  const entries = new Map(config.vms.map((vm) => [vm.sourceVmId, vm]));
  const ca = new Map<string, Buffer>();
  for (const vm of config.vms)
    if (vm.redfish.caFile) ca.set(vm.sourceVmId, await readFile(vm.redfish.caFile));
  /**
   * 入口 / Entry: createHaWitnessActions.entry.
   * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `found` 供上层消费（`ha-witness-server.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `found` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
   * 处理：通过 `entries.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `entries.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: HaWitnessVm
   * 输出 / Returns: ConfigVm；结果来自 / values from `found`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!found || found.sourceHostId !== vm.sourceHostId || found.targetHostId !== vm.targetHostId`; 异常 / errors `new AppError('见证实例配置已变化', 409)`.
   */
  const entry = (vm: HaWitnessVm): ConfigVm => {
    const found = entries.get(vm.sourceVmId);
    if (!found || found.sourceHostId !== vm.sourceHostId ||
        found.targetHostId !== vm.targetHostId)
      throw new AppError('见证实例配置已变化', 409);
    return found;
  };
  /**
   * 入口 / Entry: createHaWitnessActions.bmc.
   * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `haHttpsRequest( new URL(path, vm.redfish.baseUrl).toString(), method, body, { basic: { username: vm.redfish.username, passwor…` 供上层消费（`ha-witness-server.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `haHttpsRequest( new URL(path, vm.redfish.baseUrl).toString(), method, body, { basic: { username: vm.redfish.username, passwor…` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
   * 处理：通过 `haHttpsRequest`, `URL.toString`, `ca.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haHttpsRequest`, `URL.toString`, `ca.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: ConfigVm; method: 'GET' | 'POST'; path: string; body: unknown optional
   * 输出 / Returns: `haHttpsRequest( new URL(path, vm.redfish.baseUrl).toString(), method, body, { basic: { username: vm.redfish.username, passwor…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const bmc = async (vm: ConfigVm, method: 'GET' | 'POST',
    path: string, body?: unknown) => haHttpsRequest(
    new URL(path, vm.redfish.baseUrl).toString(), method, body,
    { basic: { username: vm.redfish.username, password: vm.redfish.password },
      ca: ca.get(vm.sourceVmId), fingerprint: vm.redfish.fingerprint,
      timeoutMs: 10_000 });
  /**
   * 入口 / Entry: createHaWitnessActions.target.
   * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `haHttpsRequest(new URL(path, vm.target.baseUrl).toString(), 'POST', body, { bearer: vm.target.token, fingerprint: vm.target.f…` 供上层消费（`ha-witness-server.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `haHttpsRequest(new URL(path, vm.target.baseUrl).toString(), 'POST', body, { bearer: vm.target.token, fingerprint: vm.target.f…` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
   * 处理：通过 `haHttpsRequest`, `URL.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haHttpsRequest`, `URL.toString`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: ConfigVm; path: string; body: unknown
   * 输出 / Returns: `haHttpsRequest(new URL(path, vm.target.baseUrl).toString(), 'POST', body, { bearer: vm.target.token, fingerprint: vm.target.f…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `identity?.version !== 1 || identity.id !== vm.targetHostId`; 异常 / errors `new AppError('目标主机身份与见证配置不一致', 409)`.
   */
  const target = async (vm: ConfigVm, path: string, body: unknown) => {
    const identity = await haHttpsRequest(new URL('/peer/status', vm.target.baseUrl).toString(),
      'GET', undefined, { bearer: vm.target.token, fingerprint: vm.target.fingerprint }) as {
      version?: unknown; id?: unknown };
    if (identity?.version !== 1 || identity.id !== vm.targetHostId)
      throw new AppError('目标主机身份与见证配置不一致', 409);
    return haHttpsRequest(new URL(path, vm.target.baseUrl).toString(), 'POST', body,
      { bearer: vm.target.token, fingerprint: vm.target.fingerprint, timeoutMs: 30_000 });
  };
  /**
   * 入口 / Entry: createHaWitnessActions.applicationReady.
   * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result?.ready === true && result.vmId === vmId` 供上层消费（`ha-witness-server.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `result?.ready === true && result.vmId === vmId` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
   * 处理：通过 `url.searchParams.set`, `haHttpsRequest`, `url.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `url.searchParams.set`, `haHttpsRequest`, `url.toString`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: application: z.infer<typeof applicationConfigSchema>; vmId: string
   * 输出 / Returns: `result?.ready === true && result.vmId === vmId`.
   * 副作用 / Effects: `url.searchParams.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const applicationReady = async (application: z.infer<typeof applicationConfigSchema>,
    vmId: string) => {
    const url = new URL(application.url);
    url.searchParams.set('vmId', vmId);
    const result = await haHttpsRequest(url.toString(), 'GET', undefined,
      { bearer: application.token, fingerprint: application.fingerprint }) as {
      ready?: boolean; vmId?: string };
    return result?.ready === true && result.vmId === vmId;
  };
  /**
   * 入口 / Entry: createHaWitnessActions.trafficTarget.
   * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result.activeVmId === null ? '' : result.activeVmId as string` 供上层消费（`ha-witness-server.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `result.activeVmId === null ? '' : result.activeVmId as string` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
   * 处理：通过 `entry`, `url.searchParams.set`, `haHttpsRequest`, `url.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `entry`, `url.searchParams.set`, `haHttpsRequest`, `url.toString`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: identity: HaWitnessVm
   * 输出 / Returns: `result.activeVmId === null ? '' : result.activeVmId as string`.
   * 副作用 / Effects: `url.searchParams.set`.
   * 拒绝 / Refusals: 条件 / conditions `result?.activeVmId !== null && !z.uuid().safeParse(result?.activeVmId).success`; 异常 / errors `new AppError('流量状态接口未返回有效实例身份或明确空路由', 502)`.
   */
  const trafficTarget = async (identity: HaWitnessVm) => {
    const vm = entry(identity), url = new URL('/status', vm.traffic.baseUrl);
    url.searchParams.set('sourceVmId', vm.sourceVmId);
    const result = await haHttpsRequest(url.toString(), 'GET', undefined,
      { bearer: vm.traffic.token, fingerprint: vm.traffic.fingerprint }) as { activeVmId?: unknown };
    if (result?.activeVmId !== null && !z.uuid().safeParse(result?.activeVmId).success)
      throw new AppError('流量状态接口未返回有效实例身份或明确空路由', 502);
    return result.activeVmId === null ? '' : result.activeVmId as string;
  };
  return {
    /**
     * 入口 / Entry: createHaWitnessActions.fence.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `void` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `entry`, `redfishPowerState`, `bmc` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `entry`, `redfishPowerState`, `bmc`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `status !== 'Off'`; `next === 'Off'`.
     * 输入 / Inputs: identity
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `Date.now() >= deadline`; 异常 / errors `new AppError('带外控制器未确认来源宿主已关闭', 504)`.
     */
    fence: async (identity) => {
      const vm = entry(identity), systemPath = vm.redfish.systemPath;
      const status = redfishPowerState(await bmc(vm, 'GET', systemPath),
        vm.redfish.systemUuid);
      if (status !== 'Off') {
        await bmc(vm, 'POST', `${systemPath}/Actions/ComputerSystem.Reset`,
          { ResetType: 'ForceOff' });
      }
      const deadline = Date.now() + 90_000;
      while (true) {
        const next = redfishPowerState(await bmc(vm, 'GET', systemPath),
          vm.redfish.systemUuid);
        if (next === 'Off') return;
        if (Date.now() >= deadline) throw new AppError('带外控制器未确认来源宿主已关闭', 504);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    },
    /**
     * 入口 / Entry: createHaWitnessActions.confirmFence.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; the calls and state transitions below complete the operation. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `entry`, `redfishPowerState`, `bmc` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `entry`, `redfishPowerState`, `bmc`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `redfishPowerState(await bmc(vm, 'GET', vm.redfish.systemPath), vm.redfish.systemUuid) !== 'Off'`; 异常 / errors `new AppError('来源宿主已不再确认关闭，保持隔离并停止接管推进', 409)`.
     */
    confirmFence: async (identity) => {
      const vm = entry(identity);
      if (redfishPowerState(await bmc(vm, 'GET', vm.redfish.systemPath),
        vm.redfish.systemUuid) !== 'Off')
        throw new AppError('来源宿主已不再确认关闭，保持隔离并停止接管推进', 409);
    },
    /**
     * 入口 / Entry: createHaWitnessActions.targetStatus.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result.status as 'stopped' | 'starting' | 'running'` 供上层消费（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `result.status as 'stopped' | 'starting' | 'running'` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `target`, `entry`, `targetInput`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `target`, `entry`, `targetInput`, `inline.includes`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity; plan
     * 输出 / Returns: `result.status as 'stopped' | 'starting' | 'running'`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result?.ready !== true || result.id !== plan.remoteVmId || !['stopped', 'starting', 'running'].includes(result.status || '')`; 异常 / errors `new AppError('目标副本预检结果不一致', 409)`.
     */
    targetStatus: async (identity, plan) => {
      const result = await target(entry(identity), '/peer/replica-activate-check',
        targetInput(plan)) as { ready?: boolean; id?: string; status?: string };
      if (result?.ready !== true || result.id !== plan.remoteVmId ||
          !['stopped', 'starting', 'running'].includes(result.status || ''))
        throw new AppError('目标副本预检结果不一致', 409);
      return result.status as 'stopped' | 'starting' | 'running';
    },
    /**
     * 入口 / Entry: createHaWitnessActions.activate.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; the calls and state transitions below complete the operation. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `target`, `entry`, `targetInput`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `target`, `entry`, `targetInput`, `inline.includes`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity; plan
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result?.id !== plan.remoteVmId || !['starting', 'running'].includes(result.status || '')`; 异常 / errors `new AppError('目标副本启动结果不一致', 409)`.
     */
    activate: async (identity, plan) => {
      const result = await target(entry(identity), '/peer/replica-activate',
        targetInput(plan)) as { id?: string; status?: string };
      if (result?.id !== plan.remoteVmId ||
          !['starting', 'running'].includes(result.status || ''))
        throw new AppError('目标副本启动结果不一致', 409);
    },
    /**
     * 入口 / Entry: createHaWitnessActions.applicationReady.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `applicationReady(vm.application, plan.remoteVmId)` 供上层消费（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `applicationReady(vm.application, plan.remoteVmId)` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `entry`, `applicationReady` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `entry`, `applicationReady`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity; plan
     * 输出 / Returns: `applicationReady(vm.application, plan.remoteVmId)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    applicationReady: async (identity, plan) => {
      const vm = entry(identity);
      return applicationReady(vm.application, plan.remoteVmId);
    },
    /**
     * 入口 / Entry: createHaWitnessActions.switchTraffic.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; the calls and state transitions below complete the operation. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `entry`, `haHttpsRequest`, `URL.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `entry`, `haHttpsRequest`, `URL.toString`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity; plan
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result?.accepted !== true || result.activeVmId !== plan.remoteVmId`; 异常 / errors `new AppError('流量切换接口未确认目标实例', 409)`.
     */
    switchTraffic: async (identity, plan) => {
      const vm = entry(identity);
      const result = await haHttpsRequest(new URL('/activate', vm.traffic.baseUrl).toString(),
        'POST', { sourceVmId: plan.sourceVmId, targetVmId: plan.remoteVmId },
        { bearer: vm.traffic.token,
          fingerprint: vm.traffic.fingerprint }) as { accepted?: boolean; activeVmId?: string };
      if (result?.accepted !== true || result.activeVmId !== plan.remoteVmId)
        throw new AppError('流量切换接口未确认目标实例', 409);
    },
    trafficTarget,
    recoveryTrafficTarget: trafficTarget,
    /**
     * 入口 / Entry: createHaWitnessActions.inspectReplicas.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result` 供上层消费（`ha-witness-server.ts`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ha-witness-server.ts`; this entry produces `result` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `entry`, `haHttpsRequest`, `URL.toString`, `url.searchParams.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `entry`, `haHttpsRequest`, `URL.toString`, `url.searchParams.set`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `url.searchParams.set`.
     * 拒绝 / Refusals: 条件 / conditions `peer?.version !== 1 || peer.id !== vm.targetHostId`; `result.hostId !== vm.targetHostId || result.sourceHostId !== vm.sourceHostId || result.sourceVmId !== vm.sourceVmId`; 异常 / errors `new AppError('目标主机身份与见证配置不一致', 409)`; `new AppError('目标完整副本清单身份不一致', 409)`.
     */
    inspectReplicas: async (identity) => {
      const vm = entry(identity);
      const peer = await haHttpsRequest(new URL('/peer/status', vm.target.baseUrl).toString(),
        'GET', undefined, { bearer: vm.target.token, fingerprint: vm.target.fingerprint }) as {
        version?: unknown; id?: unknown };
      if (peer?.version !== 1 || peer.id !== vm.targetHostId)
        throw new AppError('目标主机身份与见证配置不一致', 409);
      const url = new URL('/peer/replicas-status', vm.target.baseUrl);
      url.searchParams.set('sourceVmId', vm.sourceVmId);
      const result = haWitnessReplicaInventorySchema.parse(await haHttpsRequest(url.toString(),
        'GET', undefined, { bearer: vm.target.token, fingerprint: vm.target.fingerprint,
          maxResponseBytes: 1024 * 1024 }));
      if (result.hostId !== vm.targetHostId || result.sourceHostId !== vm.sourceHostId ||
          result.sourceVmId !== vm.sourceVmId)
        throw new AppError('目标完整副本清单身份不一致', 409);
      return result;
    },
    /**
     * 入口 / Entry: createHaWitnessActions.retire.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ha-witness-server.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `ha-witness-server.ts`; the calls and state transitions below complete the operation. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `target`, `entry`, `targetInput` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `target`, `entry`, `targetInput`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity; plan
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result?.id !== plan.remoteVmId || result.retired !== true`; 异常 / errors `new AppError('目标副本未确认持久退役', 409)`.
     */
    retire: async (identity, plan) => {
      const result = await target(entry(identity), '/peer/replica-retire',
        targetInput(plan)) as { id?: string; retired?: boolean };
      if (result?.id !== plan.remoteVmId || result.retired !== true)
        throw new AppError('目标副本未确认持久退役', 409);
    },
    /**
     * 入口 / Entry: createHaWitnessActions.sourceApplicationReady.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `applicationReady(vm.failback.application, vm.sourceVmId)` 供上层消费（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `applicationReady(vm.failback.application, vm.sourceVmId)` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `entry`, `applicationReady` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `entry`, `applicationReady`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity
     * 输出 / Returns: `applicationReady(vm.failback.application, vm.sourceVmId)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!vm.failback`; 异常 / errors `new AppError('未配置来源应用健康接口，不能自动回切', 409)`.
     */
    sourceApplicationReady: async (identity) => {
      const vm = entry(identity);
      if (!vm.failback) throw new AppError('未配置来源应用健康接口，不能自动回切', 409);
      return applicationReady(vm.failback.application, vm.sourceVmId);
    },
    /**
     * 入口 / Entry: createHaWitnessActions.restoreTraffic.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ha-witness-server.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; the calls and state transitions below complete the operation. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `entry`, `haHttpsRequest`, `URL.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `entry`, `haHttpsRequest`, `URL.toString`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: identity; plan
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!vm.failback`; `result?.accepted !== true || result.activeVmId !== vm.sourceVmId`; 异常 / errors `new AppError('自动流量回切未配置', 409)`; `new AppError('流量回切接口未确认来源实例', 409)`.
     */
    restoreTraffic: async (identity, plan) => {
      const vm = entry(identity);
      if (!vm.failback) throw new AppError('自动流量回切未配置', 409);
      const result = await haHttpsRequest(new URL('/restore', vm.traffic.baseUrl).toString(),
        'POST', { sourceVmId: vm.sourceVmId, retiredVmId: plan.remoteVmId },
        { bearer: vm.traffic.token, fingerprint: vm.traffic.fingerprint }) as {
        accepted?: boolean; activeVmId?: string };
      if (result?.accepted !== true || result.activeVmId !== vm.sourceVmId)
        throw new AppError('流量回切接口未确认来源实例', 409);
    },
  };
}

/**
 * 入口 / Entry: hash.
 * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest()` 供上层消费（`ha-witness-server.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `createHash('sha256').update(value).digest()` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `createHash('sha256').update(value).digest()`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const hash = (value: string) => createHash('sha256').update(value).digest();
/**
 * 入口 / Entry: authorizedHost.
 * 功能：在装配独立见证 HTTPS 服务及宿主动作中，核对调用资格、输入或资源归属；本入口产生 `null` / `host` 供上层消费（`ha-witness-server.ts`）。
 * Purpose: Checks admission, input or resource ownership in `ha-witness-server.ts`; this entry produces `null` / `host` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
 * 处理：通过 `header.startsWith`, `header.slice`, `inline.test`, `hash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `header.startsWith`, `header.slice`, `inline.test`, `hash`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!header?.startsWith('Bearer ')`; `!/^[a-f0-9]{64}$/.test(received)`; `timingSafeEqual(receivedHash, hash(token))`.
 * 输入 / Inputs: request: IncomingMessage; tokens: Map<string, string>
 * 输出 / Returns: `null`; `host`.
 * 副作用 / Effects: `header.startsWith`; 更新 / updates `host`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function authorizedHost(request: IncomingMessage, tokens: Map<string, string>) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const received = header.slice(7);
  if (!/^[a-f0-9]{64}$/.test(received)) return null;
  const receivedHash = hash(received);
  let host: string | null = null;
  for (const [id, token] of tokens)
    if (timingSafeEqual(receivedHash, hash(token))) host = id;
  return host;
}

/**
 * 入口 / Entry: startHaWitnessServerUnlocked.
 * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ witness, server, close: async () => { clearInterval(timer); await new Promise<void>((resolve) => server.close(() => resolve…` 供上层消费（`ha-witness-server.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `{ witness, server, close: async () => { clearInterval(timer); await new Promise<void>((resolve) => server.close(() => resolve…` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
 * 处理：通过 `haWitnessServerConfigSchema.parse`, `config.vms.map`, `witnessVms`, `createHaWitnessActions` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `haWitnessServerConfigSchema.parse`, `config.vms.map`, `witnessVms`, `createHaWitnessActions`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: raw: unknown; now: default=() => Date.now()
 * 输出 / Returns: `{ witness, server, close: async () => { clearInterval(timer); await new Promise<void>((resolve) => server.close(() => resolve…`.
 * 副作用 / Effects: `createHaWitnessActions`; `createHttpsServer`; `setInterval`; 更新 / updates `server.requestTimeout`.
 * 拒绝 / Refusals: 条件 / conditions `new Set(config.vms.map((vm) => vm.sourceVmId)).size !== config.vms.length`; 异常 / errors `new AppError('见证实例 ID 重复')`.
 */
async function startHaWitnessServerUnlocked(raw: unknown,
  now = () => Date.now()) {
  const config = haWitnessServerConfigSchema.parse(raw);
  if (new Set(config.vms.map((vm) => vm.sourceVmId)).size !== config.vms.length)
    throw new AppError('见证实例 ID 重复');
  const sourceTokens = new Map<string, string>(config.sourceTokens
    ? Object.entries(config.sourceTokens)
    : [[config.vms[0].sourceHostId, config.sourceToken!]]);
  const witness = new HaWitness(config.stateFile, witnessVms(config),
    await createHaWitnessActions(config), now);
  await witness.init();
  /**
   * 入口 / Entry: startHaWitnessServerUnlocked.callback@269.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `response.writeHead`; 更新 / updates `result`.
   * 拒绝 / Refusals: 条件 / conditions `!sourceHostId`; `request.method !== 'POST'`; `!body || typeof body !== 'object' || (body as Record<string, unknown>).sourceHostId !== sourceHostId`; 异常 / errors `new AppError('未授权', 401)`; `new AppError('不支持此方法', 405)`.
   * 失败处理：catch 分支执行 `const status = error instanceof AppError ? error.status : 500;`; `response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const status = error instanceof AppError ? error.status : 500;`; `response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });`; these statements determine whether a failure is absorbed or rejected again.
   */
  const server: Server = createHttpsServer({
    cert: await readFile(config.listen.certFile), key: await readFile(config.listen.keyFile),
    minVersion: 'TLSv1.2',
  }, (request, response) => void (
  /**
   * 中文功能：只处理已授权主机的 POST，限制 JSON 为 4096 字节并匹配来源身份，再分派见证接口；返回禁止缓存且内部错误脱敏。
   * English: Accepts only authorized-host POSTs, bounds JSON to 4096 bytes and matches source identity before witness dispatch, returning uncached responses with sanitized internal errors.
   * 所属 / Owner: startHaWitnessServerUnlocked.server.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   */
  async () => {
    try {
      const sourceHostId = authorizedHost(request, sourceTokens);
      if (!sourceHostId) throw new AppError('未授权', 401);
      if (request.method !== 'POST') throw new AppError('不支持此方法', 405);
      const body = await readJsonBody(request, 4096);
      if (!body || typeof body !== 'object' ||
          (body as Record<string, unknown>).sourceHostId !== sourceHostId)
        throw new AppError('来源凭据与实例身份不匹配', 403);
      let result: unknown;
      if (request.url === '/v1/heartbeat') result = await witness.heartbeat(body);
      else if (request.url === '/v1/authorize-start') result = await witness.authorizeStart(body);
      else if (request.url === '/v1/status') result = await witness.status(body);
      else if (request.url === '/v1/rejoin') result = await witness.rejoin(body);
      else throw new AppError('接口不存在', 404);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store' });
      response.end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: status === 500 ? '见证服务内部错误' :
        (error as Error).message }));
    }
  })());
  server.requestTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listen.port, config.listen.host, () => {
      server.off('error', reject); resolve();
    });
  });
  const timer = setInterval(() => void witness.sample().catch((error) =>
    console.error('HA 见证采样失败：', error)), 5_000);
  timer.unref();
  void witness.sample().catch((error) => console.error('HA 见证启动扫描失败：', error));
  return { witness, server,
  /**
   * 入口 / Entry: startHaWitnessServerUnlocked.close.
   * 功能：在装配独立见证 HTTPS 服务及宿主动作中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ha-witness-server.ts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ha-witness-server.ts`; the calls and state transitions below complete the operation. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
   * 处理：通过 `clearInterval`, `witness.drain` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearInterval`, `witness.drain`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearInterval`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close: async () => {
    clearInterval(timer);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await witness.drain();
  } };
}

/**
 * 入口 / Entry: startHaWitnessServer.
 * 功能：在装配独立见证 HTTPS 服务及宿主动作中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...service, close: () => closing ||= (async () => { try { await service.close(); } finally { await release(); } })() }` 供上层消费（`ha-witness-server.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-server.ts`; this entry produces `{ ...service, close: () => closing ||= (async () => { try { await service.close(); } finally { await release(); } })() }` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
 * 处理：通过 `haWitnessServerConfigSchema.parse`, `realpath().catch`, `realpath`, `lockHaWitnessState` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `haWitnessServerConfigSchema.parse`, `realpath().catch`, `realpath`, `lockHaWitnessState`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: raw: unknown; now: default=() => Date.now()
 * 输出 / Returns: `{ ...service, close: () => closing ||= (async () => { try { await service.close(); } finally { await release(); } })() }`.
 * 副作用 / Effects: `startHaWitnessServerUnlocked`; `release`.
 * 拒绝 / Refusals: 异常 / errors `error`.
 * 失败处理：catch 分支执行 `await release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `await release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function startHaWitnessServer(raw: unknown, now = () => Date.now()) {
  const parsed = haWitnessServerConfigSchema.parse(raw);
  const config = { ...parsed, stateFile: await realpath(parsed.stateFile).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new AppError('见证状态文件缺失；为避免双主启动，须人工核对后初始化',
        503, 'HA_WITNESS_STATE_MISSING');
    throw error;
  }) };
  const release = await lockHaWitnessState(config.stateFile);
  try {
    const service = await startHaWitnessServerUnlocked(config, now);
    let closing: Promise<void> | undefined;
    return { ...service,
    /**
     * 入口 / Entry: startHaWitnessServer.close.
     * 功能：在装配独立见证 HTTPS 服务及宿主动作中，结束、撤销或清理本次拥有的领域资源；本入口产生 `closing ||= (async () => { try { await service.close(); } finally { await release(); } })()` 供上层消费（`ha-witness-server.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `ha-witness-server.ts`; this entry produces `closing ||= (async () => { try { await service.close(); } finally { await release(); } })()` for its caller. Module context: Assembles the independent witness HTTPS server and host actions with bounded target URLs and power-state responses.
     * 处理：通过 `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inline`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `closing ||= (async () => { try { await service.close(); } finally { await release(); } })()`.
     * 副作用 / Effects: 更新 / updates `closing`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    close: () => closing ||= (async () => {
      try { await service.close(); }
      finally { await release(); }
    })() };
  } catch (error) { await release(); throw error; }
}
