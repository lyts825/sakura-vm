/**
 * 模块职责：提供同源和令牌比对基础检查，供 HTTP 入口验证请求来源及访问凭据。
 * Module purpose: Supplies origin and token comparisons for HTTP source/credential validation.
 */
import type { IncomingHttpHeaders } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
/**
 * 入口 / Entry: sameOrigin.
 * 功能：在提供同源和令牌比对基础检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `( hosts.includes(headers.host || '') && headers['sec-fetch-site'] !== 'cross-site' && (!headers.origin || hosts.some((h) => `…` 供上层消费（`security.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `security.ts`; this entry produces `( hosts.includes(headers.host || '') && headers['sec-fetch-site'] !== 'cross-site' && (!headers.origin || hosts.some((h) => `…` for its caller. Module context: Supplies origin and token comparisons for HTTP source/credential validation.
 * 处理：通过 `hosts.includes`, `hosts.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hosts.includes`, `hosts.some`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: headers: IncomingHttpHeaders; port: number
 * 输出 / Returns: `( hosts.includes(headers.host || '') && headers['sec-fetch-site'] !== 'cross-site' && (!headers.origin || hosts.some((h) => `…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function sameOrigin(headers: IncomingHttpHeaders, port: number) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return (
    hosts.includes(headers.host || '') &&
    headers['sec-fetch-site'] !== 'cross-site' &&
    (!headers.origin || hosts.some((h) => `http://${h}` === headers.origin))
  );
}
/**
 * 入口 / Entry: tokenMatches.
 * 功能：在提供同源和令牌比对基础检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `a.length === b.length && timingSafeEqual(a, b)` 供上层消费（`security.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `security.ts`; this entry produces `false` / `a.length === b.length && timingSafeEqual(a, b)` for its caller. Module context: Supplies origin and token comparisons for HTTP source/credential validation.
 * 处理：通过 `timingSafeEqual` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `timingSafeEqual`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `typeof value !== 'string'`.
 * 输入 / Inputs: value: unknown; token: string
 * 输出 / Returns: `false`; `a.length === b.length && timingSafeEqual(a, b)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function tokenMatches(value: unknown, token: string) {
  if (typeof value !== 'string') return false;
  const a = Buffer.from(value),
    b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
