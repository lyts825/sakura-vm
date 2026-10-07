/**
 * 模块职责：封装 HTTPS 见证心跳、启动授权和重加入请求，校验返回身份与结果契约。
 * Module purpose: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts.
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { HaWitnessHttpError, haHttpsRequest } from './ha-witness-http.ts';
import { haWitnessHeartbeatSchema, haWitnessIdentitySchema } from './ha-witness-core.ts';
import { AppError } from '../shared/errors.ts';

export const haWitnessClientConfigSchema = z.object({
  version: z.literal(1),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.search &&
      !url.hash && !url.username && !url.password;
  }),
  fingerprint: z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/),
  token: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type HaWitnessClientConfig = z.infer<typeof haWitnessClientConfigSchema>;

export class HaWitnessClient {
  /**
   * 入口 / Entry: HaWitnessClient.constructor.
   * 功能：建立 HaWitnessClient 的封装 HTTPS 见证心跳、启动授权和重加入请求上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HaWitnessClient context for this module's responsibility: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: config: HaWitnessClientConfig
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.config`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private config: HaWitnessClientConfig) {
    this.config = haWitnessClientConfigSchema.parse(config);
  }

  /**
   * 入口 / Entry: HaWitnessClient.fromEnv.
   * 功能：在封装 HTTPS 见证心跳、启动授权和重加入请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `new HaWitnessClient(JSON.parse(await readFile(path, 'utf8')))` 供上层消费（`HaWitnessClient`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitnessClient`; this entry produces `null` / `new HaWitnessClient(JSON.parse(await readFile(path, 'utf8')))` for its caller. Module context: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts.
   * 处理：通过 `readFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readFile`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!path`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `null`; `new HaWitnessClient(JSON.parse(await readFile(path, 'utf8')))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  static async fromEnv() {
    const path = process.env.SAKURA_HA_WITNESS_CONFIG_FILE;
    if (!path) return null;
    return new HaWitnessClient(JSON.parse(await readFile(path, 'utf8')));
  }

  /**
   * 入口 / Entry: HaWitnessClient.call.
   * 功能：在封装 HTTPS 见证心跳、启动授权和重加入请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `haHttpsRequest(new URL(path, this.config.url).toString(), 'POST', input, { bearer: this.config.token, fingerprint: this.confi…` 供上层消费（`HaWitnessClient`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitnessClient`; this entry produces `haHttpsRequest(new URL(path, this.config.url).toString(), 'POST', input, { bearer: this.config.token, fingerprint: this.confi…` for its caller. Module context: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts.
   * 处理：通过 `haHttpsRequest`, `URL.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haHttpsRequest`, `URL.toString`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: path: string; input: unknown
   * 输出 / Returns: `haHttpsRequest(new URL(path, this.config.url).toString(), 'POST', input, { bearer: this.config.token, fingerprint: this.confi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async call(path: string, input: unknown) {
    return haHttpsRequest(new URL(path, this.config.url).toString(), 'POST', input,
      { bearer: this.config.token, fingerprint: this.config.fingerprint });
  }

  /**
   * 入口 / Entry: HaWitnessClient.heartbeat.
   * 功能：在封装 HTTPS 见证心跳、启动授权和重加入请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ armed: result.armed, ...(result.failback !== undefined ? { failback: result.failback } : {}) }` 供上层消费（`HaWitnessClient`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitnessClient`; this entry produces `{ armed: result.armed, ...(result.failback !== undefined ? { failback: result.failback } : {}) }` for its caller. Module context: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts.
   * 处理：通过 `haWitnessHeartbeatSchema.parse`, `this.call`, `z.enum().nullable().optional().safeParse`, `z.enum().nullable().optional` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haWitnessHeartbeatSchema.parse`, `this.call`, `z.enum().nullable().optional().safeParse`, `z.enum().nullable().optional`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `{ armed: result.armed, ...(result.failback !== undefined ? { failback: result.failback } : {}) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result?.phase !== 'source' || typeof result.armed !== 'boolean' || !z.enum(['pending', 'completed']).nullable().optional().sa…`; 异常 / errors `new AppError('见证心跳响应无效', 502)`.
   */
  async heartbeat(input: unknown) {
    const value = haWitnessHeartbeatSchema.parse(input);
    const result = await this.call('/v1/heartbeat', value) as {
      armed?: boolean; phase?: string; failback?: 'pending' | 'completed' | null };
    if (result?.phase !== 'source' || typeof result.armed !== 'boolean' ||
        !z.enum(['pending', 'completed']).nullable().optional().safeParse(result.failback).success)
      throw new AppError('见证心跳响应无效', 502);
    return { armed: result.armed, ...(result.failback !== undefined ? { failback: result.failback } : {}) };
  }

  /**
   * 入口 / Entry: HaWitnessClient.authorizeStart.
   * 功能：在封装 HTTPS 见证心跳、启动授权和重加入请求中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`HaWitnessClient`）。
   * Purpose: Checks admission, input or resource ownership in `HaWitnessClient`; the calls and state transitions below complete the operation. Module context: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts.
   * 处理：通过 `haWitnessIdentitySchema.parse`, `this.call` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haWitnessIdentitySchema.parse`, `this.call`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result?.allowed !== true || result.phase !== 'source'`; 异常 / errors `new AppError('见证节点未授权来源启动', 409, 'HA_WITNESS_FENCED')`.
   */
  async authorizeStart(input: unknown) {
    const value = haWitnessIdentitySchema.parse(input);
    const result = await this.call('/v1/authorize-start', value) as {
      allowed?: boolean; phase?: string };
    if (result?.allowed !== true || result.phase !== 'source')
      throw new AppError('见证节点未授权来源启动', 409, 'HA_WITNESS_FENCED');
  }

  /**
   * 入口 / Entry: HaWitnessClient.status.
   * 功能：在封装 HTTPS 见证心跳、启动授权和重加入请求中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `result` 供上层消费（`HaWitnessClient`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HaWitnessClient`; this entry produces `result` for its caller. Module context: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts.
   * 处理：通过 `haWitnessIdentitySchema.parse`, `this.call().catch`, `this.call`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haWitnessIdentitySchema.parse`, `this.call().catch`, `this.call`, `inline.includes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!['source', 'fencing', 'fenced', 'promoted'].includes(result?.phase || '') || typeof result.armed !== 'boolean' || !z.uuid().…`; 异常 / errors `new AppError('见证状态响应无效', 502)`.
   */
  async status(input: unknown) {
    const value = haWitnessIdentitySchema.parse(input);
    const result = await this.call('/v1/status', value).catch((error: unknown) => {
      if (error instanceof HaWitnessHttpError && error.upstreamStatus === 404)
        throw new AppError('见证节点未登记此来源实例', 404, 'HA_WITNESS_NOT_REGISTERED');
      throw error;
    }) as {
      phase?: string; armed?: boolean; lastHeartbeatAt?: number;
      targetVmId?: string | null; targetHostId?: string;
      failureThreshold?: number; error?: string | null;
      failback?: { phase: 'pending' | 'completed'; retiredVmId: string;
        requestedAt: number; completedAt: number | null } | null;
      recoveryHeld?: boolean; recoveredRetiredVmIds?: string[] };
    if (!['source', 'fencing', 'fenced', 'promoted'].includes(result?.phase || '') ||
        typeof result.armed !== 'boolean' ||
        !z.uuid().safeParse(result.targetHostId).success ||
        !z.number().int().min(2).max(10).safeParse(result.failureThreshold).success ||
        !z.object({ phase: z.enum(['pending', 'completed']), retiredVmId: z.uuid(),
          requestedAt: z.number().int().nonnegative(),
          completedAt: z.number().int().nonnegative().nullable(),
        }).strict().nullable().optional().safeParse(result.failback).success ||
        !z.boolean().optional().safeParse(result.recoveryHeld).success ||
        !z.array(z.uuid()).max(1024).optional().safeParse(result.recoveredRetiredVmIds).success ||
        (result.failback && result.phase !== 'source'))
      throw new AppError('见证状态响应无效', 502);
    return result;
  }

  /**
   * 入口 / Entry: HaWitnessClient.rejoin.
   * 功能：在封装 HTTPS 见证心跳、启动授权和重加入请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`HaWitnessClient`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitnessClient`; this entry produces `result` for its caller. Module context: Wraps witness HTTPS heartbeat, startup authorization and rejoin requests, validating response identity and contracts.
   * 处理：通过 `haWitnessIdentitySchema.safeExtend().parse`, `haWitnessIdentitySchema.safeExtend`, `z.literal`, `this.call` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haWitnessIdentitySchema.safeExtend().parse`, `haWitnessIdentitySchema.safeExtend`, `z.literal`, `this.call`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result?.released !== true || !retirementConfirmed || !z.enum(['pending', 'completed']).optional().safeParse(result.failback).…`; 异常 / errors `new AppError('见证退出接管响应无效', 502)`.
   */
  async rejoin(input: unknown) {
    const value = haWitnessIdentitySchema.safeExtend({
      dataReconciled: z.literal(true),
    }).parse(input);
    const result = await this.call('/v1/rejoin', value) as {
      released?: boolean; retiredRemoteVmId?: string; failback?: 'pending' | 'completed';
      recovered?: boolean; retiredVmIds?: string[] };
    const retirementConfirmed = z.uuid().safeParse(result?.retiredRemoteVmId).success ||
      (result?.recovered === true && z.array(z.uuid()).max(1024).safeParse(result.retiredVmIds).success);
    if (result?.released !== true || !retirementConfirmed ||
        !z.enum(['pending', 'completed']).optional().safeParse(result.failback).success)
      throw new AppError('见证退出接管响应无效', 502);
    return result;
  }
}
