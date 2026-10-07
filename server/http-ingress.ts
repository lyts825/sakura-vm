/**
 * 模块职责：管理本地 HTTP 入口、别名和客户端证书，维护 TLS 入口及转发资源生命周期。
 * Module purpose: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
 */
import type { IngressCertificatesV1 } from './service-contracts/v1.ts';
import { networkFor, type NetworkScope } from './network/index.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { randomUUID, X509Certificate } from 'node:crypto';
import { type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';
import { TLSSocket } from 'node:tls';
import { z } from 'zod';
import {
  ingressActionSchema,
  ingressAlias,
  ingressEntrySchema,
  type IngressAction,
  type IngressEntry,
  type IngressHealth,
  type IngressView,
  type IngressClientAuth,
} from '../shared/http-ingress.ts';
import { readStore, writeStore } from './local-store.ts';
import { metadataPath, type PluginMetadata } from './plugin-metadata.ts';
import { AppError } from '../shared/errors.ts';
import { DATA, PORT } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';

const OWNER = 'http-ingress';
const storedSchema = z.array(ingressEntrySchema).max(24);
const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'forwarded',
]);

/**
 * 入口 / Entry: cleanHeaders.
 * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `next` 供上层消费（`http-ingress.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-ingress.ts`; this entry produces `next` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
 * 处理：通过 `hopHeaders.has`, `listed.includes`, `key.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hopHeaders.has`, `listed.includes`, `key.startsWith`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `hopHeaders.has(key) || listed.includes(key) || key.startsWith('x-forwarded-')`.
 * 输入 / Inputs: headers: IncomingMessage['headers']
 * 输出 / Returns: `next`.
 * 副作用 / Effects: `key.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function cleanHeaders(headers: IncomingMessage['headers']) {
  const next = { ...headers };
  const listed = String(headers.connection || '')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  for (const key of Object.keys(next)) {
    if (hopHeaders.has(key) || listed.includes(key) || key.startsWith('x-forwarded-')) delete next[key];
  }
  return next;
}

/**
 * 入口 / Entry: matching.
 * 功能：从当前输入或状态计算 `prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)`，供调用方后续验证或使用。
 * Purpose: Computes `prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: path: string; prefix: string
 * 输出 / Returns: `prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)`.
 * 副作用 / Effects: `path.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function matching(path: string, prefix: string) {
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * 入口 / Entry: localClient.
 * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `true` 供上层消费（`http-ingress.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-ingress.ts`; this entry produces `false` / `true` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
 * 处理：通过 `req.headers.host.toLowerCase`, `aliases.has`, `origin.host.toLowerCase` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `req.headers.host.toLowerCase`, `aliases.has`, `origin.host.toLowerCase`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `host && host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && !aliases.has(host)`; `!req.headers.origin`; `!host`.
 * 输入 / Inputs: req: IncomingMessage; port: number; aliases: Set<string>
 * 输出 / Returns: `false`; `true`; `origin.host.toLowerCase() === host && origin.protocol === ((req.socket as { encrypted?: boolean }).encrypted ? 'https:' : 'ht…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
function localClient(req: IncomingMessage, port: number, aliases: Set<string>) {
  const host = req.headers.host?.toLowerCase();
  if (host && host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && !aliases.has(host))
    return false;
  if (!req.headers.origin) return true;
  if (!host) return false;
  try {
    const origin = new URL(req.headers.origin);
    return origin.host.toLowerCase() === host &&
      origin.protocol === ((req.socket as { encrypted?: boolean }).encrypted ? 'https:' : 'http:');
  } catch {
    return false;
  }
}

/**
 * 入口 / Entry: clientCertificate.
 * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new X509Certificate(pem)` 供上层消费（`http-ingress.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-ingress.ts`; this entry produces `new X509Certificate(pem)` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
 * 处理：通过 `pem.match` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `pem.match`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: pem: string
 * 输出 / Returns: `new X509Certificate(pem)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `(pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length !== 1 || (pem.match(/-----END CERTIFICATE-----/g) || []).length !== …`; 异常 / errors `new AppError('每个客户端证书字段只能包含一张 PEM 证书', 409)`; `new AppError('客户端证书不是有效的 PEM 证书', 409)`.
 * 失败处理：catch 分支执行 `throw new AppError('客户端证书不是有效的 PEM 证书', 409);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('客户端证书不是有效的 PEM 证书', 409);`; these statements determine whether a failure is absorbed or rejected again.
 */
function clientCertificate(pem: string) {
  if ((pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length !== 1 ||
      (pem.match(/-----END CERTIFICATE-----/g) || []).length !== 1)
    throw new AppError('每个客户端证书字段只能包含一张 PEM 证书', 409);
  try {
    return new X509Certificate(pem);
  } catch {
    throw new AppError('客户端证书不是有效的 PEM 证书', 409);
  }
}

/**
 * 入口 / Entry: validateClientAuth.
 * 功能：在管理本地 HTTP 入口、别名和客户端证书中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`http-ingress.ts`）。
 * Purpose: Checks admission, input or resource ownership in `http-ingress.ts`; this entry produces `void` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
 * 处理：通过 `clientCertificate`, `validateIssuer` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `clientCertificate`, `validateIssuer`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!policy`; `rotateAt === null || rotateAt > now`; `rotateAt !== null`.
 * 输入 / Inputs: policy: IngressClientAuth | null; protocol: 'http' | 'https'
 * 输出 / Returns: `void`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `protocol !== 'https'`; `replacement && current.fingerprint256 === replacement.fingerprint256`; `Date.parse(active.validFrom) > now || Date.parse(active.validTo) <= now`; 异常 / errors `new AppError('mTLS 策略只能用于 HTTPS 入口', 409)`; `new AppError('替换证书须与当前客户端证书不同', 409)`.
 */
function validateClientAuth(policy: IngressClientAuth | null, protocol: 'http' | 'https') {
  if (!policy) return;
  if (protocol !== 'https') throw new AppError('mTLS 策略只能用于 HTTPS 入口', 409);
  const now = Date.now();
  const current = clientCertificate(policy.currentPem);
  const rotateAt = policy.rotateAt ? Date.parse(policy.rotateAt) : null;
  const replacement = policy.replacementPem ? clientCertificate(policy.replacementPem) : null;
  /**
   * 入口 / Entry: validateClientAuth.validateIssuer.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`http-ingress.ts`）。
   * Purpose: Checks admission, input or resource ownership in `http-ingress.ts`; this entry produces `void` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `leaf.verify`, `clientCertificate`, `leaf.checkIssued` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `leaf.verify`, `clientCertificate`, `leaf.checkIssued`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: leaf: X509Certificate; issuerPem: string | undefined; at: number
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!issuerPem`; `!leaf.verify(leaf.publicKey)`; `!issuer.ca || !leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey)`; 异常 / errors `new AppError('非自签名的客户端证书须填写直接签发 CA', 409)`; `new AppError('客户端证书不是由所填 CA 直接签发', 409)`.
   */
  const validateIssuer = (leaf: X509Certificate, issuerPem: string | undefined, at: number) => {
    if (!issuerPem) {
      if (!leaf.verify(leaf.publicKey))
        throw new AppError('非自签名的客户端证书须填写直接签发 CA', 409);
      return;
    }
    const issuer = clientCertificate(issuerPem);
    if (!issuer.ca || !leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey))
      throw new AppError('客户端证书不是由所填 CA 直接签发', 409);
    if (Date.parse(issuer.validFrom) > at || Date.parse(issuer.validTo) <= at)
      throw new AppError('客户端证书 CA 在生效时间不处于有效期内', 409);
  };
  if (replacement && current.fingerprint256 === replacement.fingerprint256)
    throw new AppError('替换证书须与当前客户端证书不同', 409);
  const active = rotateAt !== null && rotateAt <= now ? replacement! : current;
  if (Date.parse(active.validFrom) > now || Date.parse(active.validTo) <= now)
    throw new AppError('当前生效的客户端证书不在有效期内', 409);
  if (rotateAt === null || rotateAt > now) {
    validateIssuer(current, policy.currentCaPem, now);
    if (rotateAt !== null) validateIssuer(current, policy.currentCaPem, rotateAt);
  }
  if (replacement)
    validateIssuer(replacement, policy.replacementCaPem, rotateAt! > now ? rotateAt! : now);
  if (rotateAt !== null && rotateAt > now) {
    if (Date.parse(current.validTo) <= rotateAt)
      throw new AppError('当前客户端证书将在轮换前过期', 409);
    if (Date.parse(replacement!.validFrom) > rotateAt || Date.parse(replacement!.validTo) <= rotateAt)
      throw new AppError('替换证书在轮换时间尚未生效或已经过期', 409);
  }
}

/**
 * 入口 / Entry: allowedClient.
 * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` / `false` 供上层消费（`http-ingress.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-ingress.ts`; this entry produces `true` / `false` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
 * 处理：通过 `req.socket.getPeerCertificate`, `clientCertificate` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `req.socket.getPeerCertificate`, `clientCertificate`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!policy`; `!(req.socket instanceof TLSSocket) || !req.socket.authorized`; `!peer.raw`.
 * 输入 / Inputs: req: IncomingMessage; policy: IngressClientAuth | null
 * 输出 / Returns: `true`; `false`; `Date.parse(active.validFrom) <= now && Date.parse(active.validTo) > now && peer.fingerprint256 === active.fingerprint256`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function allowedClient(req: IncomingMessage, policy: IngressClientAuth | null) {
  if (!policy) return true;
  if (!(req.socket instanceof TLSSocket) || !req.socket.authorized) return false;
  const peer = req.socket.getPeerCertificate();
  if (!peer.raw) return false;
  const activePem = policy.rotateAt && Date.now() >= Date.parse(policy.rotateAt)
    ? policy.replacementPem!
    : policy.currentPem;
  const active = clientCertificate(activePem);
  const now = Date.now();
  return Date.parse(active.validFrom) <= now && Date.parse(active.validTo) > now &&
    peer.fingerprint256 === active.fingerprint256;
}

export class HttpIngress {
  private entries: IngressEntry[] = [];
  private listeners = new Map<number, Server>();
  private sockets = new Map<number, Set<Duplex>>();
  private probes = new Set<ClientRequest>();
  private listenerErrors: Record<string, string> = {};
  private health = new Map<string, IngressHealth>();
  private timer?: ScheduleHandle;
  /**
   * 签名 / Signature: HttpIngress.unsubscribe.
   * 功能：为管理本地 HTTP 入口、别名和客户端证书声明 unsubscribe 的输入与结果契约，所属容器为 HttpIngress。
   * Purpose: Declares the input/result contract for unsubscribe in HttpIngress. Module responsibility: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unsubscribe?: () => void;
  private closed = false;
  private file: string;

  /**
   * 入口 / Entry: HttpIngress.constructor.
   * 功能：建立 HttpIngress 的管理本地 HTTP 入口、别名和客户端证书上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HttpIngress context for this module's responsibility: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: string | PluginMetadata default=join(DATA, 'plugins', 'network', 'ingress.json'); certificates: IngressCertificatesV1 optional; networking: NetworkScope default=networkFor('core:http-ingress')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.file`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    file: string | PluginMetadata = join(DATA, 'plugins', 'network', 'ingress.json'),
    private certificates?: IngressCertificatesV1,
    private networking: NetworkScope = networkFor('core:http-ingress'),
  ) { this.file = metadataPath(file); }

  /**
   * 入口 / Entry: HttpIngress.init.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，初始化并核对当前领域状态；处理结果记录到 `this.entries`, `this.unsubscribe`, `this.listenerErrors[String(port)]`（`HttpIngress`）。
   * Purpose: Initializes and verifies current domain state in `HttpIngress`; the outcome is recorded in `this.entries`, `this.unsubscribe`, `this.listenerErrors[String(port)]`. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `storedSchema.parse`, `readStore`, `this.certificates.onChange`, `this.entries.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storedSchema.parse`, `readStore`, `this.certificates.onChange`, `this.entries.map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.certificates`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.listeners.keys`; `this.listeners.set`; `this.listen`; `scheduler.register`; 更新 / updates `this.entries`, `this.unsubscribe`, `this.listenerErrors[String(port)]`, `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `protocols.size !== 1`; `protocols.has('https')`; `!this.certificates`; 异常 / errors `new AppError('同一端口不能混用 HTTP 与 HTTPS', 409)`; `new AppError('HTTPS 证书服务未启用', 503)`.
   * 失败处理：catch 分支执行 `this.machines.reserveHostPorts(OWNER, this.listeners.keys());`; `this.listenerErrors[String(port)] = (error as Error).message;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.machines.reserveHostPorts(OWNER, this.listeners.keys());`; `this.listenerErrors[String(port)] = (error as Error).message;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init() {
    this.entries = storedSchema.parse(await readStore(this.file, () => []));
    if (this.certificates)
      this.unsubscribe = this.certificates.onChange((certificate) => {
        for (const [port, server] of this.listeners)
          if (this.entries.some((entry) => entry.listenPort === port && entry.protocol === 'https'))
            (server as HttpsServer).setSecureContext({
              key: certificate.key, cert: certificate.cert,
              ca: this.trustAnchors(port, this.entries),
            });
      });
    for (const port of new Set(this.entries.map((entry) => entry.listenPort))) {
      try {
        const protocols = new Set(
          this.entries.filter((entry) => entry.listenPort === port).map((entry) => entry.protocol),
        );
        if (protocols.size !== 1) throw new AppError('同一端口不能混用 HTTP 与 HTTPS', 409);
        this.machines.reserveHostPorts(OWNER, [...this.listeners.keys(), port]);
        if (protocols.has('https')) {
          if (!this.certificates) throw new AppError('HTTPS 证书服务未启用', 503);
          await this.certificates.ensure(
            this.entries.some((entry) => entry.listenPort === port && entry.domainAlias),
          );
        }
        this.listeners.set(port, await this.listen(port, [...protocols][0], this.entries));
      } catch (error) {
        this.machines.reserveHostPorts(OWNER, this.listeners.keys());
        this.listenerErrors[String(port)] = (error as Error).message;
      }
    }
    this.timer = scheduler.register({ owner: 'plugin:network', label: 'HTTP 入口健康检查', intervalMs: 15000,
      immediate: true, overlap: 'skip',
      /**
       * 入口 / Entry: HttpIngress.init.run.
       * 功能：把本层请求转交 `this.checkAll`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.checkAll` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.checkAll()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: () => this.checkAll() });
  }

  /**
   * 入口 / Entry: HttpIngress.view.
   * 功能：从当前输入或状态计算 `{ entries: this.entries.map((entry) => ({ ...entry, url: `${entry.protocol}://${entry.domainAlias ? ingressAlias(entry.id) : …`，供调用方后续验证或使用。
   * Purpose: Computes `{ entries: this.entries.map((entry) => ({ ...entry, url: `${entry.protocol}://${entry.domainAlias ? ingressAlias(entry.id) : …` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: IngressView；结果来自 / values from `{ entries: this.entries.map((entry) => ({ ...entry, url: `${entry.protocol}://${entry.domainAlias ? ingressAlias(entry.id) : …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): IngressView {
    return {
      entries: this.entries.map((entry) => ({
        ...entry,
        url: `${entry.protocol}://${entry.domainAlias ? ingressAlias(entry.id) : '127.0.0.1'}:${entry.listenPort}${entry.pathPrefix}`,
        health: this.availability(entry) || this.health.get(entry.id) || { status: 'checking' },
      })),
      listenerErrors: { ...this.listenerErrors },
    };
  }

  /**
   * 入口 / Entry: HttpIngress.aliasNames.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.entries.filter((entry) => entry.domainAlias).map((entry) => ingressAlias(entry.id))` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `this.entries.filter((entry) => entry.domainAlias).map((entry) => ingressAlias(entry.id))` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.entries.filter().map`, `this.entries.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.entries.filter().map`, `this.entries.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.entries.filter((entry) => entry.domainAlias).map((entry) => ingressAlias(entry.id))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  aliasNames() {
    return this.entries.filter((entry) => entry.domainAlias).map((entry) => ingressAlias(entry.id));
  }

  /**
   * 入口 / Entry: HttpIngress.action.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view()` / `this.machines.locked('launch', async () => { if (this.closed) throw new AppError('入口服务正在关闭', 503); let next: IngressEntry[]; …` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `this.view()` / `this.machines.locked('launch', async () => { if (this.closed) throw new AppError('入口服务正在关闭', 503); let next: IngressEntry[]; …` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `ingressActionSchema.parse`, `this.entries.filter`, `Promise.all`, `entries.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ingressActionSchema.parse`, `this.entries.filter`, `Promise.all`, `entries.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: Promise<IngressView>；结果来自 / values from `this.view()`; `this.machines.locked('launch', async () => { if (this.closed) throw new AppError('入口服务正在关闭', 503); let next: IngressEntry[]; …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `action.action === 'check'`; `action.id && !entries.length`; 异常 / errors `new AppError('服务入口不存在', 404)`.
   */
  async action(input: unknown): Promise<IngressView> {
    const action = ingressActionSchema.parse(input) as IngressAction;
    if (action.action === 'check') {
      const entries = action.id ? this.entries.filter((entry) => entry.id === action.id) : this.entries;
      if (action.id && !entries.length) throw new AppError('服务入口不存在', 404);
      await Promise.all(entries.map((entry) => this.check(entry)));
      return this.view();
    }
    /**
     * 入口 / Entry: HttpIngress.action.callback@213.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked / launch）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked / launch).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `this.listeners.has`; 更新 / updates `next`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed`; `action.action === 'delete'`; `!this.entries.some((entry) => entry.id === action.id)`; 异常 / errors `new AppError('入口服务正在关闭', 503)`; `new AppError('服务入口不存在', 404)`.
     */
    return this.machines.locked('launch', async () => {
      if (this.closed) throw new AppError('入口服务正在关闭', 503);
      let next: IngressEntry[];
      if (action.action === 'delete') {
        if (!this.entries.some((entry) => entry.id === action.id)) throw new AppError('服务入口不存在', 404);
        next = this.entries.filter((entry) => entry.id !== action.id);
      } else {
        const input = action.entry;
        const current = input.id ? this.entries.find((entry) => entry.id === input.id) : undefined;
        if (input.id && !current) throw new AppError('服务入口不存在', 404);
        const vm = this.machines.get(input.vmId);
        if (vm.sandbox || vm.rescueOf) throw new AppError('此实例不能发布服务入口', 409);
        if (!vm.forwards.some((forward) => forward.host === input.upstreamPort))
          throw new AppError('上游端口须先在此实例的端口转发中声明', 409);
        if (input.listenPort === PORT) throw new AppError('入口端口不能占用 Sakura 控制端口', 409);
        const timestamp = new Date().toISOString();
        const entry: IngressEntry = {
          ...input,
          id: current?.id || randomUUID(),
          createdAt: current?.createdAt || timestamp,
          updatedAt: timestamp,
        };
        validateClientAuth(entry.clientAuth, entry.protocol);
        next = [...this.entries.filter((item) => item.id !== entry.id), entry];
      }
      if (next.length > 24 || new Set(next.map((entry) => entry.listenPort)).size > 4)
        throw new AppError('最多保存 24 条入口规则和 4 个监听端口', 409);
      const keys = next.map(
        (entry) => `${entry.listenPort}:${entry.domainAlias ? ingressAlias(entry.id) : 'loopback'}:${entry.pathPrefix}`,
      );
      if (new Set(keys).size !== keys.length) throw new AppError('监听端口与路径组合不能重复', 409);
      for (const port of new Set(next.map((entry) => entry.listenPort))) {
        const protocol = new Set(next.filter((entry) => entry.listenPort === port).map((entry) => entry.protocol));
        if (protocol.size !== 1) throw new AppError('同一端口不能混用 HTTP 与 HTTPS', 409);
        const active = this.entries.find((entry) => entry.listenPort === port)?.protocol;
        if (this.listeners.has(port) && active !== [...protocol][0])
          throw new AppError('切换 HTTP/HTTPS 时请先删除旧入口，或使用新的监听端口', 409);
      }
      if (next.some((entry) => entry.protocol === 'https') && !this.certificates)
        throw new AppError('HTTPS 证书服务未启用', 503);
      await this.apply(next);
      return this.view();
    });
  }

  /**
   * 入口 / Entry: HttpIngress.apply.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.entries`, `this.listenerErrors`（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; the outcome is recorded in `this.entries`, `this.listenerErrors`. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.listeners.keys`, `next.map`, `this.machines.reserveHostPorts`, `next.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.listeners.keys`, `next.map`, `this.machines.reserveHostPorts`, `next.some`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `next.some((entry) => entry.protocol === 'https' && entry.domainAlias)`; `this.listeners.has(port)`; `protocol === 'https'`.
   * 输入 / Inputs: next: IngressEntry[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.listeners.keys`; `this.listeners.has`; `added.set`; `this.listen`; `inline.setSecureContext`; 更新 / updates `this.entries`, `this.listenerErrors`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `for (const [port, server] of this.listeners) if (this.entries.some((entry) => entry.listenPort === port && entry.protocol ===…`; `for (const [port, server] of added) await this.closeListener(port, server);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `for (const [port, server] of this.listeners) if (this.entries.some((entry) => entry.listenPort === port && entry.protocol ===…`; `for (const [port, server] of added) await this.closeListener(port, server);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async apply(next: IngressEntry[]) {
    const oldPorts = [...this.listeners.keys()];
    const nextPorts = [...new Set(next.map((entry) => entry.listenPort))];
    const added = new Map<number, Server>();
    this.machines.reserveHostPorts(OWNER, nextPorts);
    try {
      if (next.some((entry) => entry.protocol === 'https' && entry.domainAlias))
        await this.certificates!.ensure(true);
      for (const port of nextPorts) {
        if (this.listeners.has(port)) continue;
        const protocol = next.find((entry) => entry.listenPort === port)!.protocol;
        if (protocol === 'https') await this.certificates!.ensure();
        added.set(port, await this.listen(port, protocol, next));
      }
      for (const [port, server] of this.listeners)
        if (nextPorts.includes(port) && next.find((entry) => entry.listenPort === port)?.protocol === 'https')
          (server as HttpsServer).setSecureContext(this.secureOptions(port, next));
      await writeStore(this.file, next);
    } catch (error) {
      for (const [port, server] of this.listeners)
        if (this.entries.some((entry) => entry.listenPort === port && entry.protocol === 'https'))
          (server as HttpsServer).setSecureContext(this.secureOptions(port, this.entries));
      for (const [port, server] of added) await this.closeListener(port, server);
      this.machines.reserveHostPorts(OWNER, oldPorts);
      throw error;
    }
    this.entries = next;
    for (const [port, server] of added) this.listeners.set(port, server);
    for (const [port, server] of this.listeners) {
      if (nextPorts.includes(port)) continue;
      this.listeners.delete(port);
      await this.closeListener(port, server);
    }
    this.listenerErrors = {};
    this.health.clear();
    void this.checkAll().catch(() => {});
  }

  /**
   * 入口 / Entry: HttpIngress.trustAnchors.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...new Set(entries.filter((entry) => entry.listenPort === port) .flatMap((entry) => entry.clientAuth ? [entry.clientAuth.cur…` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `[...new Set(entries.filter((entry) => entry.listenPort === port) .flatMap((entry) => entry.clientAuth ? [entry.clientAuth.cur…` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `entries.filter().flatMap`, `entries.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `entries.filter().flatMap`, `entries.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: port: number; entries: IngressEntry[]
   * 输出 / Returns: `[...new Set(entries.filter((entry) => entry.listenPort === port) .flatMap((entry) => entry.clientAuth ? [entry.clientAuth.cur…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private trustAnchors(port: number, entries: IngressEntry[]) {
    return [...new Set(entries.filter((entry) => entry.listenPort === port)
      .flatMap((entry) => entry.clientAuth
        ? [entry.clientAuth.currentCaPem || entry.clientAuth.currentPem,
          entry.clientAuth.replacementCaPem || entry.clientAuth.replacementPem]
          .filter((pem): pem is string => !!pem)
        : []))];
  }

  /**
   * 入口 / Entry: HttpIngress.secureOptions.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...this.certificates!.tlsOptions(), ca: this.trustAnchors(port, entries), requestCert: true, rejectUnauthorized: false, }` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `{ ...this.certificates!.tlsOptions(), ca: this.trustAnchors(port, entries), requestCert: true, rejectUnauthorized: false, }` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `inline.tlsOptions`, `this.trustAnchors` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.tlsOptions`, `this.trustAnchors`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: port: number; entries: IngressEntry[]
   * 输出 / Returns: `{ ...this.certificates!.tlsOptions(), ca: this.trustAnchors(port, entries), requestCert: true, rejectUnauthorized: false, }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private secureOptions(port: number, entries: IngressEntry[]) {
    return {
      ...this.certificates!.tlsOptions(),
      ca: this.trustAnchors(port, entries),
      requestCert: true,
      rejectUnauthorized: false,
    };
  }

  /**
   * 入口 / Entry: HttpIngress.listen.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `new Promise<Server>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off(…` 供上层消费（`HttpIngress`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HttpIngress`; this entry produces `new Promise<Server>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off(…` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.networking.createHttpsServer`, `this.secureOptions`, `this.networking.createHttpServer`, `server.on` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.networking.createHttpsServer`, `this.secureOptions`, `this.networking.createHttpServer`, `server.on`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: port: number; protocol: 'http' | 'https'; entries: IngressEntry[]
   * 输出 / Returns: `new Promise<Server>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off(…`.
   * 副作用 / Effects: `this.networking.createHttpsServer`; `this.networking.createHttpServer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private listen(port: number, protocol: 'http' | 'https', entries: IngressEntry[]) {
    /**
     * 入口 / Entry: HttpIngress.listen.listener.
     * 功能：把本层请求转交 `this.proxy`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.proxy` and propagates the provider result or rejection.
     * 输入 / Inputs: req: IncomingMessage; res: ServerResponse
     * 输出 / Returns: `this.proxy(req, res, port)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const listener = (req: IncomingMessage, res: ServerResponse) => this.proxy(req, res, port);
    const server: Server =
      protocol === 'https'
        ? this.networking.createHttpsServer(this.secureOptions(port, entries), listener)
        : this.networking.createHttpServer(listener);
    server.on('error', (error) => {
      this.listenerErrors[String(port)] = error.message;
    });
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head, port));
    server.on('connection', (socket) => this.trackSocket(port, socket));
    return new Promise<Server>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(server);
      });
    });
  }

  /**
   * 入口 / Entry: HttpIngress.trackSocket.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; the calls and state transitions below complete the operation. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.sockets.get`, `sockets.add`, `this.sockets.set`, `socket.once` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sockets.get`, `sockets.add`, `this.sockets.set`, `socket.once`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: port: number; socket: Duplex
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `sockets.add`; `this.sockets.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private trackSocket(port: number, socket: Duplex) {
    const sockets = this.sockets.get(port) || new Set<Duplex>();
    sockets.add(socket);
    this.sockets.set(port, sockets);
    socket.once('close', () => sockets.delete(socket));
  }

  /**
   * 入口 / Entry: HttpIngress.closeListener.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，结束、撤销或清理本次拥有的领域资源；本入口产生 `new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })` 供上层消费（`HttpIngress`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HttpIngress`; this entry produces `new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.sockets.get`, `socket.destroy`, `this.sockets.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sockets.get`, `socket.destroy`, `this.sockets.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: port: number; server: Server
   * 输出 / Returns: `new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); })`.
   * 副作用 / Effects: `socket.destroy`; `this.sockets.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private closeListener(port: number, server: Server) {
    for (const socket of this.sockets.get(port) || []) socket.destroy();
    this.sockets.delete(port);
    return new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }

  /**
   * 入口 / Entry: HttpIngress.aliases.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Set( this.entries .filter((entry) => entry.listenPort === port && entry.domainAlias) .map((entry) => `${ingressAlias(entr…` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `new Set( this.entries .filter((entry) => entry.listenPort === port && entry.domainAlias) .map((entry) => `${ingressAlias(entr…` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.entries.filter().map`, `this.entries.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.entries.filter().map`, `this.entries.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: port: number
   * 输出 / Returns: `new Set( this.entries .filter((entry) => entry.listenPort === port && entry.domainAlias) .map((entry) => `${ingressAlias(entr…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private aliases(port: number) {
    return new Set(
      this.entries
        .filter((entry) => entry.listenPort === port && entry.domainAlias)
        .map((entry) => `${ingressAlias(entry.id)}:${port}`),
    );
  }

  /**
   * 入口 / Entry: HttpIngress.target.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `{ entry, path: `${path}${url.search}` }` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `null` / `{ entry, path: `${path}${url.search}` }` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `raw.startsWith`, `req.headers.host.toLowerCase().replace`, `req.headers.host.toLowerCase`, `this.entries.filter().sort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `raw.startsWith`, `req.headers.host.toLowerCase().replace`, `req.headers.host.toLowerCase`, `this.entries.filter().sort`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!raw.startsWith('/') || raw.startsWith('//')`; `url.origin !== 'http://127.0.0.1'`; `!entry`.
   * 输入 / Inputs: req: IncomingMessage; port: number
   * 输出 / Returns: `null`; `{ entry, path: `${path}${url.search}` }`.
   * 副作用 / Effects: `raw.startsWith`; `req.headers.host.toLowerCase().replace`; 更新 / updates `url`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return null;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return null;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private target(req: IncomingMessage, port: number) {
    const raw = req.url || '/';
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    let url: URL;
    try {
      url = new URL(raw, 'http://127.0.0.1');
    } catch {
      return null;
    }
    // Backslashes and stripped URL whitespace can turn an apparent path into an authority.
    if (url.origin !== 'http://127.0.0.1') return null;
    const host = req.headers.host?.toLowerCase().replace(new RegExp(`:${port}$`), '') || '127.0.0.1';
    const entry = this.entries
      .filter((candidate) =>
        candidate.listenPort === port &&
        matching(url.pathname, candidate.pathPrefix) &&
        (candidate.domainAlias
          ? ingressAlias(candidate.id) === host
          : host === '127.0.0.1' || host === 'localhost'),
      )
      .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0];
    if (!entry) return null;
    const path =
      entry.stripPrefix && entry.pathPrefix !== '/'
        ? url.pathname.slice(entry.pathPrefix.length) || '/'
        : url.pathname;
    return { entry, path: `${path}${url.search}` };
  }

  /**
   * 入口 / Entry: HttpIngress.availability.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] }` / `{ status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] || '监听端口不可用', }` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `{ status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] }` / `{ status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] || '监听端口不可用', }` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.listeners.has`, `this.machines.get`, `vm.forwards.some`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.listeners.has`, `this.machines.get`, `vm.forwards.some`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.listenerErrors[String(entry.listenPort)]`; `!this.listeners.has(entry.listenPort)`; `!vm.forwards.some((forward) => forward.host === entry.upstreamPort)`.
   * 输入 / Inputs: entry: IngressEntry
   * 输出 / Returns: IngressHealth | null；结果来自 / values from `{ status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] }`; `{ status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] || '监听端口不可用', }`; `{ status: 'unconfigured', error: '上游端口转发已移除' }`.
   * 副作用 / Effects: `this.listeners.has`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return { status: 'unconfigured', error: '实例已移除' };`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { status: 'unconfigured', error: '实例已移除' };`; these statements determine whether a failure is absorbed or rejected again.
   */
  private availability(entry: IngressEntry): IngressHealth | null {
    if (this.listenerErrors[String(entry.listenPort)])
      return { status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] };
    if (!this.listeners.has(entry.listenPort))
      return {
        status: 'unhealthy',
        error: this.listenerErrors[String(entry.listenPort)] || '监听端口不可用',
      };
    try {
      const vm = this.machines.get(entry.vmId);
      if (!vm.forwards.some((forward) => forward.host === entry.upstreamPort))
        return { status: 'unconfigured', error: '上游端口转发已移除' };
      if (this.machines.state(entry.vmId) !== 'running') return { status: 'stopped' };
    } catch {
      return { status: 'unconfigured', error: '实例已移除' };
    }
    return null;
  }

  /**
   * 入口 / Entry: HttpIngress.proxy.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `void` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `localClient`, `this.aliases`, `res.writeHead().end`, `res.writeHead` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `localClient`, `this.aliases`, `res.writeHead().end`, `res.writeHead`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!localClient(req, port, this.aliases(port))`; `!target`; `!allowedClient(req, target.entry.clientAuth)`.
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; port: number
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `res.writeHead().end`; `res.writeHead`; 更新 / updates `headers.host`, `headers['x-forwarded-for']`, `headers['x-forwarded-host']`, `headers['x-forwarded-proto']`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private proxy(req: IncomingMessage, res: ServerResponse, port: number) {
    if (!localClient(req, port, this.aliases(port))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const target = this.target(req, port);
    if (!target) {
      res.writeHead(404).end('Not found');
      return;
    }
    if (!allowedClient(req, target.entry.clientAuth)) {
      res.writeHead(403).end('Client certificate required');
      return;
    }
    if (this.availability(target.entry)) {
      res.writeHead(503).end('Upstream unavailable');
      return;
    }
    const headers = cleanHeaders(req.headers);
    headers.host = `127.0.0.1:${target.entry.upstreamPort}`;
    headers['x-forwarded-for'] = '127.0.0.1';
    headers['x-forwarded-host'] = req.headers.host || `127.0.0.1:${port}`;
    headers['x-forwarded-proto'] = target.entry.protocol;
    if (target.entry.pathPrefix !== '/') headers['x-forwarded-prefix'] = target.entry.pathPrefix;
    /**
     * 入口 / Entry: HttpIngress.proxy.callback@439.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.networking.httpRequest）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.networking.httpRequest).
     * 输入 / Inputs: response
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `res.writeHead`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const upstream = this.networking.httpRequest(
      {
        hostname: '127.0.0.1',
        port: target.entry.upstreamPort,
        method: req.method,
        path: target.path,
        headers,
        timeout: 120000,
      },
      (response) => {
        const responseHeaders = cleanHeaders(response.headers);
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.on('aborted', () => res.destroy());
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end('Bad gateway');
      else res.destroy();
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  /**
   * 入口 / Entry: HttpIngress.upgrade.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HttpIngress`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HttpIngress`; this entry produces `void` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `localClient`, `this.aliases`, `socket.end`, `this.target` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `localClient`, `this.aliases`, `socket.end`, `this.target`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!localClient(req, port, this.aliases(port))`; `!target || req.headers.upgrade?.toLowerCase() !== 'websocket'`; `!allowedClient(req, target.entry.clientAuth)`.
   * 输入 / Inputs: req: IncomingMessage; socket: Duplex; head: Buffer; port: number
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `headers.host`, `headers.connection`, `headers.upgrade`, `headers['x-forwarded-for']`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number) {
    if (!localClient(req, port, this.aliases(port))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const target = this.target(req, port);
    if (!target || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (!allowedClient(req, target.entry.clientAuth)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    if (this.availability(target.entry)) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const headers = cleanHeaders(req.headers);
    headers.host = `127.0.0.1:${target.entry.upstreamPort}`;
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
    headers['x-forwarded-for'] = '127.0.0.1';
    headers['x-forwarded-host'] = req.headers.host || `127.0.0.1:${port}`;
    headers['x-forwarded-proto'] = target.entry.protocol;
    const upstream = this.networking.httpRequest({
      hostname: '127.0.0.1',
      port: target.entry.upstreamPort,
      path: target.path,
      method: req.method,
      headers,
      timeout: 30000,
    });
    /**
     * 入口 / Entry: HttpIngress.upgrade.callback@489.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（upstream.on / upgrade）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (upstream.on / upgrade).
     * 输入 / Inputs: response; peer; peerHead
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `lines.push`; `socket.write`; `peer.write`; 更新 / updates `i`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    upstream.on('upgrade', (response, peer, peerHead) => {
      this.trackSocket(port, peer);
      const lines = [
        `HTTP/1.1 ${response.statusCode || 101} ${response.statusMessage || 'Switching Protocols'}`,
      ];
      for (let i = 0; i < response.rawHeaders.length; i += 2)
        lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) peer.write(head);
      if (peerHead.length) socket.write(peerHead);
      peer.pipe(socket).pipe(peer);
    });
    upstream.on('response', (response) => {
      response.resume();
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    upstream.on('error', () => socket.destroy());
    upstream.on('timeout', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.end();
  }

  /**
   * 入口 / Entry: HttpIngress.check.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`HttpIngress`）。
   * Purpose: Checks admission, input or resource ownership in `HttpIngress`; this entry produces `void` for its caller. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `this.availability`, `this.health.set`, `this.entries.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.availability`, `this.health.set`, `this.entries.includes`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `unavailable`; `this.entries.includes(entry)`.
   * 输入 / Inputs: entry: IngressEntry
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.health.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async check(entry: IngressEntry) {
    const unavailable = this.availability(entry);
    if (unavailable) {
      this.health.set(entry.id, unavailable);
      return;
    }
    /**
     * 入口 / Entry: HttpIngress.check.callback@517.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: resolve
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.probes.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const status = await new Promise<IngressHealth>((resolve) => {
      const probe = this.networking.httpRequest(
        {
          hostname: '127.0.0.1',
          port: entry.upstreamPort,
          path: entry.healthPath,
          method: 'GET',
          timeout: 3000,
        },
        (response) => {
          response.resume();
          resolve({
            status: response.statusCode && response.statusCode < 400 ? 'healthy' : 'unhealthy',
            httpStatus: response.statusCode,
            checkedAt: new Date().toISOString(),
          });
        },
      );
      this.probes.add(probe);
      probe.once('close', () => this.probes.delete(probe));
      probe.on('timeout', () => probe.destroy(new Error('健康检查超时')));
      probe.on('error', (error) =>
        resolve({
          status: 'unhealthy',
          error: error.message,
          checkedAt: new Date().toISOString(),
        }),
      );
      probe.end();
    });
    if (this.entries.includes(entry)) this.health.set(entry.id, status);
  }

  /**
   * 入口 / Entry: HttpIngress.checkAll.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`HttpIngress`）。
   * Purpose: Checks admission, input or resource ownership in `HttpIngress`; the calls and state transitions below complete the operation. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `Promise.all`, `this.entries.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all`, `this.entries.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async checkAll() {
    await Promise.all(this.entries.map((entry) => this.check(entry)));
  }

  /**
   * 入口 / Entry: HttpIngress.close.
   * 功能：在管理本地 HTTP 入口、别名和客户端证书中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`HttpIngress`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HttpIngress`; the outcome is recorded in `this.closed`. Module context: Owns local HTTP ingress, aliases and client certificates, coordinating TLS listeners and forwarding lifecycles.
   * 处理：通过 `probe.destroy`, `this.timer.close`, `Promise.all`, `inline.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `probe.destroy`, `this.timer.close`, `Promise.all`, `inline.map`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `hadListeners`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `probe.destroy`; `this.timer.close`; `this.listeners.clear`; `this.networking.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    for (const probe of this.probes) probe.destroy();
    await this.timer?.close();
    const hadListeners = this.listeners.size > 0;
    await Promise.all([...this.listeners].map(([port, server]) => this.closeListener(port, server)));
    this.listeners.clear();
    if (hadListeners) this.machines.reserveHostPorts(OWNER, []);
    this.unsubscribe?.();
    await this.networking.close();
  }
}
