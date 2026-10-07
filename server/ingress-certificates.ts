/**
 * 模块职责：管理本地入口证书的生成、校验与轮换，确保包含 localhost 和回环地址。
 * Module purpose: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
 */
import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { createSecureContext } from 'node:tls';
import { generate } from 'selfsigned';
import { z } from 'zod';
import {
  certificateActionSchema,
  certificatePolicySchema,
  type CertificatePolicy,
  type CertificateView,
} from '../shared/ingress-certificates.ts';
import { readStore, writeStore } from './local-store.ts';
import { metadataPath, type PluginMetadata } from './plugin-metadata.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

const certificateSchema = z
  .object({
    key: z.string().min(100).max(16000),
    cert: z.string().min(100).max(16000),
    generatedAt: z.string().datetime(),
  })
  .strict();
const stateSchema = z
  .object({
    policy: certificatePolicySchema,
    certificate: certificateSchema.nullable(),
  })
  .strict();
type Certificate = z.infer<typeof certificateSchema>;
type State = z.infer<typeof stateSchema>;
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ policy: { autoRotate: true, renewBeforeDays: 30 }, certificate: null })`，供调用方后续验证或使用。
 * Purpose: Computes `({ policy: { autoRotate: true, renewBeforeDays: 30 }, certificate: null })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: State；结果来自 / values from `({ policy: { autoRotate: true, renewBeforeDays: 30 }, certificate: null })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): State => ({ policy: { autoRotate: true, renewBeforeDays: 30 }, certificate: null });

/**
 * 入口 / Entry: inspect.
 * 功能：在管理本地入口证书的生成、校验与轮换中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `parsed` 供上层消费（`ingress-certificates.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ingress-certificates.ts`; this entry produces `parsed` for its caller. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
 * 处理：通过 `createSecureContext`, `parsed.checkHost`, `parsed.checkIP` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createSecureContext`, `parsed.checkHost`, `parsed.checkIP`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: certificate: Certificate
 * 输出 / Returns: `parsed`.
 * 副作用 / Effects: `createSecureContext`.
 * 拒绝 / Refusals: 条件 / conditions `parsed.checkHost('localhost') !== 'localhost' || parsed.checkIP('127.0.0.1') !== '127.0.0.1'`; 异常 / errors `new AppError('入口证书不包含 localhost 和 127.0.0.1', 409)`.
 */
function inspect(certificate: Certificate) {
  createSecureContext({ key: certificate.key, cert: certificate.cert });
  const parsed = new X509Certificate(certificate.cert);
  if (parsed.checkHost('localhost') !== 'localhost' || parsed.checkIP('127.0.0.1') !== '127.0.0.1')
    throw new AppError('入口证书不包含 localhost 和 127.0.0.1', 409);
  return parsed;
}

/**
 * 入口 / Entry: supportsAliases.
 * 功能：在管理本地入口证书的生成、校验与轮换中，执行此领域的具体处理步骤并返回其结果；本入口产生 `inspect(certificate).checkHost('app-example.sakura.localhost') === '*.sakura.localhost'` 供上层消费（`ingress-certificates.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ingress-certificates.ts`; this entry produces `inspect(certificate).checkHost('app-example.sakura.localhost') === '*.sakura.localhost'` for its caller. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
 * 处理：通过 `inspect().checkHost`, `inspect` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inspect().checkHost`, `inspect`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: certificate: Certificate
 * 输出 / Returns: `inspect(certificate).checkHost('app-example.sakura.localhost') === '*.sakura.localhost'`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const supportsAliases = (certificate: Certificate) =>
  inspect(certificate).checkHost('app-example.sakura.localhost') === '*.sakura.localhost';

/**
 * 入口 / Entry: rotationAt.
 * 功能：从当前输入或状态计算 `new Date(Date.parse(inspect(certificate).validTo) - policy.renewBeforeDays * 86400000)`，供调用方后续验证或使用。
 * Purpose: Computes `new Date(Date.parse(inspect(certificate).validTo) - policy.renewBeforeDays * 86400000)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: certificate: Certificate; policy: CertificatePolicy
 * 输出 / Returns: `new Date(Date.parse(inspect(certificate).validTo) - policy.renewBeforeDays * 86400000)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function rotationAt(certificate: Certificate, policy: CertificatePolicy) {
  return new Date(Date.parse(inspect(certificate).validTo) - policy.renewBeforeDays * 86400000);
}

export class IngressCertificates {
  private state: State = defaults();
  private listeners = new Set<
  /**
   * 中文功能：为 IngressCertificates.listeners 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for IngressCertificates.listeners using its declared event data.
   * 所属 / Owner: IngressCertificates.listeners.
   * 输入 / Inputs: certificate: Certificate.
   * 结果 / Result: `void`.
   */
  (certificate: Certificate) => void>();
  private pending = Promise.resolve();
  private timer?: ScheduleHandle;
  private closed = false;
  private rotationError?: string;

  private file: string;
  /**
   * 入口 / Entry: IngressCertificates.constructor.
   * 功能：建立 IngressCertificates 的管理本地入口证书的生成、校验与轮换上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the IngressCertificates context for this module's responsibility: Generates, validates and rotates local TLS certificates containing localhost and loopback identities. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: string | PluginMetadata default=join(DATA, 'plugins', 'network', 'certificates.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.file`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(file: string | PluginMetadata = join(DATA, 'plugins', 'network', 'certificates.json')) { this.file = metadataPath(file); }

  /**
   * 入口 / Entry: IngressCertificates.init.
   * 功能：在管理本地入口证书的生成、校验与轮换中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.timer`（`IngressCertificates`）。
   * Purpose: Initializes and verifies current domain state in `IngressCertificates`; the outcome is recorded in `this.state`, `this.timer`. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
   * 处理：通过 `stateSchema.parse`, `readStore`, `inspect`, `rotationAt().getTime` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `inspect`, `rotationAt().getTime`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.state.certificate`; `this.state.policy.autoRotate && this.state.certificate && rotationAt(this.state.certificate, this.st…`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.state`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    if (this.state.certificate) inspect(this.state.certificate);
    if (
      this.state.policy.autoRotate &&
      this.state.certificate &&
      rotationAt(this.state.certificate, this.state.policy).getTime() <= Date.now()
    )
      await this.rotate().catch((error) => {
        this.rotationError = (error as Error).message;
      });
    this.timer = scheduler.register({ owner: 'plugin:network', label: '本地入口证书轮换', intervalMs: 3600000,
      overlap: 'skip', backoff: { initialMs: 60000, maxMs: 3600000 },
      /**
       * 入口 / Entry: IngressCertificates.init.run.
       * 功能：在管理本地入口证书的生成、校验与轮换中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`IngressCertificates`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `IngressCertificates`; the calls and state transitions below complete the operation. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
       * 处理：通过 `rotationAt().getTime`, `rotationAt`, `this.rotate().catch`, `this.rotate` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `rotationAt().getTime`, `rotationAt`, `this.rotate().catch`, `this.rotate`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `this.state.policy.autoRotate && certificate && rotationAt(certificate, this.state.policy).getTime() …`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: async () => {
      const certificate = this.state.certificate;
      if (
        this.state.policy.autoRotate &&
        certificate &&
        rotationAt(certificate, this.state.policy).getTime() <= Date.now()
      )
        await this.rotate().catch((error) => {
          this.rotationError = (error as Error).message;
          throw error;
        });
    } });
  }

  /**
   * 入口 / Entry: IngressCertificates.view.
   * 功能：在管理本地入口证书的生成、校验与轮换中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy: { ...this.state.policy }, certificate: certificate && parsed ? { pem: certificate.cert, fingerprint256: parsed.fing…` 供上层消费（`IngressCertificates`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `IngressCertificates`; this entry produces `{ policy: { ...this.state.policy }, certificate: certificate && parsed ? { pem: certificate.cert, fingerprint256: parsed.fing…` for its caller. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
   * 处理：通过 `inspect`, `rotationAt().toISOString`, `rotationAt` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inspect`, `rotationAt().toISOString`, `rotationAt`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: CertificateView；结果来自 / values from `{ policy: { ...this.state.policy }, certificate: certificate && parsed ? { pem: certificate.cert, fingerprint256: parsed.fing…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): CertificateView {
    const certificate = this.state.certificate;
    const parsed = certificate && inspect(certificate);
    return {
      policy: { ...this.state.policy },
      certificate:
        certificate && parsed
          ? {
              pem: certificate.cert,
              fingerprint256: parsed.fingerprint256,
              validFrom: parsed.validFrom,
              validTo: parsed.validTo,
              generatedAt: certificate.generatedAt,
            }
          : null,
      nextRotationAt:
        certificate && this.state.policy.autoRotate
          ? rotationAt(certificate, this.state.policy).toISOString()
          : null,
      ...(this.rotationError ? { rotationError: this.rotationError } : {}),
    };
  }

  /**
   * 入口 / Entry: IngressCertificates.tlsOptions.
   * 功能：在管理本地入口证书的生成、校验与轮换中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ key: certificate.key, cert: certificate.cert }` 供上层消费（`IngressCertificates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `IngressCertificates`; this entry produces `{ key: certificate.key, cert: certificate.cert }` for its caller. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
   * 处理：通过 `inspect` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inspect`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ key: certificate.key, cert: certificate.cert }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!certificate`; `Date.parse(inspect(certificate).validTo) <= Date.now()`; 异常 / errors `new AppError('请先生成入口证书', 409)`; `new AppError('入口证书已过期，请轮换证书', 409)`.
   */
  tlsOptions() {
    const certificate = this.state.certificate;
    if (!certificate) throw new AppError('请先生成入口证书', 409);
    if (Date.parse(inspect(certificate).validTo) <= Date.now())
      throw new AppError('入口证书已过期，请轮换证书', 409);
    return { key: certificate.key, cert: certificate.cert };
  }

  /**
   * 入口 / Entry: IngressCertificates.onChange.
   * 功能：从当前输入或状态计算 `() => this.listeners.delete(listener)`，供调用方后续验证或使用。
   * Purpose: Computes `() => this.listeners.delete(listener)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: listener: (certificate: Certificate) => void
   * 输出 / Returns: `() => this.listeners.delete(listener)`.
   * 副作用 / Effects: `this.listeners.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  onChange(listener: (certificate: Certificate) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 入口 / Entry: IngressCertificates.ensure.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: domainAliases: default=false
   * 输出 / Returns: `this.serial(async () => { const certificate = this.state.certificate; if ( !certificate || (domainAliases && !supportsAliases…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async ensure(domainAliases = false) {
    return this.serial(async () => {
      const certificate = this.state.certificate;
      if (
        !certificate ||
        (domainAliases && !supportsAliases(certificate)) ||
        (this.state.policy.autoRotate && rotationAt(certificate, this.state.policy).getTime() <= Date.now())
      )
        await this.issue(this.state.policy);
      return this.tlsOptions();
    });
  }

  /**
   * 入口 / Entry: IngressCertificates.action.
   * 功能：在管理本地入口证书的生成、校验与轮换中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (action.action === 'rotate') await this.issue(this.state.policy); else { const policy = action.p…` 供上层消费（`IngressCertificates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `IngressCertificates`; this entry produces `this.serial(async () => { if (action.action === 'rotate') await this.issue(this.state.policy); else { const policy = action.p…` for its caller. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
   * 处理：通过 `certificateActionSchema.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `certificateActionSchema.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<CertificateView>；结果来自 / values from `this.serial(async () => { if (action.action === 'rotate') await this.issue(this.state.policy); else { const policy = action.p…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async action(input: unknown): Promise<CertificateView> {
    const action = certificateActionSchema.parse(input);
    /**
     * 入口 / Entry: IngressCertificates.action.callback@141.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.serial(async () => {
      if (action.action === 'rotate') await this.issue(this.state.policy);
      else {
        const policy = action.policy;
        if (
          policy.autoRotate &&
          this.state.certificate &&
          rotationAt(this.state.certificate, policy).getTime() <= Date.now()
        )
          await this.issue(policy);
        else {
          const next = { ...this.state, policy };
          await writeStore(this.file, next);
          this.state = next;
        }
      }
      return this.view();
    });
  }

  /**
   * 入口 / Entry: IngressCertificates.rotate.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.serial(async () => { await this.issue(this.state.policy); return this.view(); })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  rotate() {
    return this.serial(async () => {
      await this.issue(this.state.policy);
      return this.view();
    });
  }

  /**
   * 入口 / Entry: IngressCertificates.serial.
   * 功能：在管理本地入口证书的生成、校验与轮换中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`IngressCertificates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `IngressCertificates`; this entry produces `operation` for its caller. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
   * 处理：通过 `this.pending.catch().then`, `this.pending.catch`, `operation.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.catch().then`, `this.pending.catch`, `operation.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const operation = this.pending
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('证书服务正在关闭', 503);
        return work();
      });
    this.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  /**
   * 入口 / Entry: IngressCertificates.issue.
   * 功能：在管理本地入口证书的生成、校验与轮换中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.state`, `this.rotationError`（`IngressCertificates`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `IngressCertificates`; the outcome is recorded in `this.state`, `this.rotationError`. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
   * 处理：通过 `generate`, `inspect`, `supportsAliases`, `listener` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `generate`, `inspect`, `supportsAliases`, `listener`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `previous`.
   * 输入 / Inputs: policy: CertificatePolicy
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `listener`; `writeStore`; 更新 / updates `this.state`, `this.rotationError`.
   * 拒绝 / Refusals: 条件 / conditions `!supportsAliases(certificate)`; 异常 / errors `new AppError('新证书不支持本地域名别名', 500)`; `error`.
   * 失败处理：catch 分支执行 `if (previous) for (const listener of this.listeners) listener(previous);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (previous) for (const listener of this.listeners) listener(previous);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async issue(policy: CertificatePolicy) {
    const before = new Date(Date.now() - 3600000);
    const after = new Date(Date.now() + 365 * 86400000);
    const generated = await generate([{ name: 'commonName', value: 'localhost' }], {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate: before,
      notAfterDate: after,
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 2, value: '*.sakura.localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    });
    const certificate: Certificate = {
      key: generated.private,
      cert: generated.cert,
      generatedAt: new Date().toISOString(),
    };
    inspect(certificate);
    if (!supportsAliases(certificate)) throw new AppError('新证书不支持本地域名别名', 500);
    const previous = this.state.certificate;
    try {
      for (const listener of this.listeners) listener(certificate);
      const next = { policy, certificate };
      await writeStore(this.file, next);
      this.state = next;
      this.rotationError = undefined;
    } catch (error) {
      if (previous) for (const listener of this.listeners) listener(previous);
      throw error;
    }
  }

  /**
   * 入口 / Entry: IngressCertificates.close.
   * 功能：在管理本地入口证书的生成、校验与轮换中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`IngressCertificates`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `IngressCertificates`; the outcome is recorded in `this.closed`. Module context: Generates, validates and rotates local TLS certificates containing localhost and loopback identities.
   * 处理：通过 `this.timer.close`, `this.listeners.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.close`, `this.listeners.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.timer.close`; `this.listeners.clear`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.timer?.close();
    await this.pending;
    this.listeners.clear();
  }
}
