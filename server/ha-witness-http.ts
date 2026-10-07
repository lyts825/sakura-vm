/**
 * 模块职责：发送有界见证 HTTPS 请求并分类上游错误，拒绝 URL 内嵌凭据。
 * Module purpose: Sends bounded witness HTTPS requests and classifies upstream failures, refusing credentials embedded in URLs.
 */
import { networkFor } from './network/index.ts';
import { X509Certificate } from 'node:crypto';

import type { TLSSocket } from 'node:tls';
import { AppError } from '../shared/errors.ts';

const { httpsRequest } = networkFor('core:ha-witness-http');

type HttpsOptions = {
  bearer?: string; basic?: { username: string; password: string };
  fingerprint?: string; ca?: Buffer; timeoutMs?: number; maxResponseBytes?: number;
};

/** Keep the authenticated HTTP status available without forwarding upstream bodies. */
export class HaWitnessHttpError extends AppError {
  /**
   * 入口 / Entry: HaWitnessHttpError.constructor.
   * 功能：建立 HaWitnessHttpError 的发送有界见证 HTTPS 请求并分类上游错误上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HaWitnessHttpError context for this module's responsibility: Sends bounded witness HTTPS requests and classifies upstream failures, refusing credentials embedded in URLs. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: upstreamStatus: number
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(readonly upstreamStatus: number) {
    super(`见证上游返回 HTTP ${upstreamStatus}`, 502);
  }
}

/** JSON/empty HTTPS request with bounded bodies and either PKI or an exact certificate pin. */
/**
 * 入口 / Entry: haHttpsRequest.
 * 功能：在发送有界见证 HTTPS 请求并分类上游错误中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Promise((resolve, reject) => { const request = httpsRequest(url, { method, agent: false, signal: AbortSignal.timeout(opti…` 供上层消费（`ha-witness-http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-http.ts`; this entry produces `new Promise((resolve, reject) => { const request = httpsRequest(url, { method, agent: false, signal: AbortSignal.timeout(opti…` for its caller. Module context: Sends bounded witness HTTPS requests and classifies upstream failures, refusing credentials embedded in URLs.
 * 输入 / Inputs: urlText: string; method: 'GET' | 'POST'; payload: unknown; options: HttpsOptions default={}
 * 输出 / Returns: Promise<unknown>；结果来自 / values from `new Promise((resolve, reject) => { const request = httpsRequest(url, { method, agent: false, signal: AbortSignal.timeout(opti…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `url.protocol !== 'https:' || url.username || url.password`; `body && Buffer.byteLength(body) > 4096`; 异常 / errors `new AppError('见证服务只接受不含 URL 凭据的 HTTPS 地址')`; `new AppError('见证请求过大')`.
 */
export function haHttpsRequest(urlText: string, method: 'GET' | 'POST',
  payload: unknown, options: HttpsOptions = {}): Promise<unknown> {
  const url = new URL(urlText);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new AppError('见证服务只接受不含 URL 凭据的 HTTPS 地址');
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  if (body && Buffer.byteLength(body) > 4096) throw new AppError('见证请求过大');
  /**
   * 入口 / Entry: haHttpsRequest.callback@32.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `AbortSignal.timeout`; `request.once`; `request.on`; `request.end`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise((resolve, reject) => {
    /**
     * 入口 / Entry: haHttpsRequest.callback@44.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（httpsRequest）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (httpsRequest).
     * 输入 / Inputs: response
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const request = httpsRequest(url, {
      method, agent: false, signal: AbortSignal.timeout(options.timeoutMs || 10_000),
      rejectUnauthorized: !options.fingerprint,
      ...(options.ca ? { ca: options.ca } : {}),
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json',
          'content-length': Buffer.byteLength(body) }),
        ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
        ...(options.basic ? { authorization: `Basic ${Buffer.from(
          `${options.basic.username}:${options.basic.password}`).toString('base64')}` } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (options.maxResponseBytes || 64 * 1024))
          request.destroy(new AppError('见证响应过大', 502));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
            throw new HaWitnessHttpError(response.statusCode || 0);
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : null);
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    if (options.fingerprint)
    /**
     * 入口 / Entry: haHttpsRequest.callback@63.
     * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（request.once / socket）。
     * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (request.once / socket).
     * 输入 / Inputs: socket
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    request.once('socket', (socket) => {
      socket.once('secureConnect', () => {
        try {
          const raw = (socket as TLSSocket).getPeerCertificate(true)?.raw;
          const cert = raw ? new X509Certificate(raw) : null;
          if (!cert || cert.fingerprint256 !== options.fingerprint ||
              Date.parse(cert.validFrom) > Date.now() ||
              Date.parse(cert.validTo) <= Date.now())
            throw new AppError('见证上游证书指纹无效', 409);
          request.end(body);
        } catch (error) { request.destroy(error as Error); }
      });
    });
    request.on('error', reject);
    if (!options.fingerprint) request.end(body);
  });
}
