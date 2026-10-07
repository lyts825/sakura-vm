/**
 * 模块职责：管理 OIDC/SAML 身份提供者与登录流程，核对回调来源、接收者和待处理状态。
 * Module purpose: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
 */
import type { AccessControlV1 } from './service-contracts/v1.ts';
import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { AccessControl } from './access-control.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { dpapi, type Protector } from './secrets.ts';
import { networkFor } from './network/index.ts';
import { withOperationCheck } from './operation-context.ts';
const { fetch: managedFetch } = networkFor('core:sso', 'oidc');
/**
 * 入口 / Entry: oidcFetch.
 * 功能：把本层请求转交 `managedFetch`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `managedFetch` and propagates the provider result or rejection.
 * 输入 / Inputs: url; options
 * 输出 / Returns: `managedFetch(url, options as RequestInit)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const oidcFetch: oidc.CustomFetch = (url, options) => managedFetch(url, options as RequestInit);

const provider = z.enum(['oidc', 'saml']);
export type SsoProvider = z.infer<typeof provider>;
/**
 * 入口 / Entry: url.
 * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `parsed.pathname === '/' && clean === parsed.origin ? parsed.origin : parsed.href` 供上层消费（`sso.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sso.ts`; this entry produces `parsed.pathname === '/' && clean === parsed.origin ? parsed.origin : parsed.href` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
 * 处理：通过 `value.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.trim`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string; protocol: default='https:'
 * 输出 / Returns: `parsed.pathname === '/' && clean === parsed.origin ? parsed.origin : parsed.href`.
 * 副作用 / Effects: 更新 / updates `parsed`.
 * 拒绝 / Refusals: 条件 / conditions `parsed.protocol !== protocol || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.href.length > 20…`; 异常 / errors `new AppError('身份提供商地址需要有效的 HTTPS URL')`; `new AppError('身份提供商地址需要无凭证、查询和片段的 HTTPS URL')`.
 * 失败处理：catch 分支执行 `throw new AppError('身份提供商地址需要有效的 HTTPS URL');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('身份提供商地址需要有效的 HTTPS URL');`; these statements determine whether a failure is absorbed or rejected again.
 */
const url = (value: string, protocol = 'https:') => {
  const clean = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new AppError('身份提供商地址需要有效的 HTTPS URL');
  }
  if (
    parsed.protocol !== protocol ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.href.length > 2048
  )
    throw new AppError('身份提供商地址需要无凭证、查询和片段的 HTTPS URL');
  return parsed.pathname === '/' && clean === parsed.origin ? parsed.origin : parsed.href;
};
/**
 * 入口 / Entry: httpsEndpoint.
 * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash` / `false` 供上层消费（`sso.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sso.ts`; this entry produces `endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash` / `false` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash`; `false`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
const httpsEndpoint = (value: string) => {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && !endpoint.hash;
  } catch {
    return false;
  }
};
export const ssoOidcInput = z
  .object({
    issuer: z.string().min(1).max(2048),
    clientId: z.string().trim().min(1).max(256),
    authMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']),
    clientSecret: z.string().max(4096).optional(),
  })
  .strict()
  .refine(
    (value) => (value.authMethod === 'none' ? !value.clientSecret : !!value.clientSecret),
    '机密客户端需要 Client Secret，公开客户端不能保存 Client Secret',
  );
export const ssoSamlInput = z
  .object({
    metadataXml: z
      .string()
      .min(1)
      .max(512 * 1024),
  })
  .strict();
export const ssoBeginInput = z
  .object({ provider, mode: z.enum(['login', 'link']), origin: z.string().max(200) })
  .strict();
const bindingSchema = z
  .object({
    id: z.uuid(),
    provider,
    accountId: z.uuid(),
    issuer: z.string().min(1).max(2048),
    subject: z.string().min(1).max(2048),
    createdAt: z.iso.datetime(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(1),
    oidc: z
      .object({
        issuer: z.url(),
        clientId: z.string(),
        authMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']),
        secret: z.string().optional(),
      })
      .strict()
      .optional(),
    saml: z
      .object({ issuer: z.string().min(1), entryPoint: z.url(), certs: z.array(z.string()).min(1).max(4) })
      .strict()
      .optional(),
    bindings: z.array(bindingSchema).max(100),
  })
  .strict();
type State = z.infer<typeof stateSchema>;
type Attempt = {
  provider: SsoProvider;
  mode: 'login' | 'link';
  origin: string;
  accountId?: string;
  sourceToken?: string;
  expiresAt: number;
  revision: number;
  verifier?: string;
  nonce?: string;
};
type Identity = { issuer: string; subject: string };
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ version: 1, bindings: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, bindings: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: State；结果来自 / values from `({ version: 1, bindings: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): State => ({ version: 1, bindings: [] });
/**
 * 入口 / Entry: digest.
 * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`sso.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sso.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Validates owner-supplied IdP metadata; the owner must obtain it from the intended IdP. */
/**
 * 入口 / Entry: parseSamlMetadata.
 * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ issuer, entryPoint, certs }` 供上层消费（`sso.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `sso.ts`; this entry produces `{ issuer, entryPoint, certs }` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
 * 处理：通过 `inline.test`, `DOMParser.parseFromString`, `root.getAttribute`, `root.getElementsByTagNameNS` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `DOMParser.parseFromString`, `root.getAttribute`, `root.getElementsByTagNameNS`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `key.getAttribute('use') && key.getAttribute('use') !== 'signing'`; `!certs.includes(pem)`.
 * 输入 / Inputs: xml: string; now: default=Date.now()
 * 输出 / Returns: `{ issuer, entryPoint, certs }`.
 * 副作用 / Effects: `inline.replace`; `certs.push`; 更新 / updates `certificate`.
 * 拒绝 / Refusals: 条件 / conditions `Buffer.byteLength(xml) > 512 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)`; `invalid || root?.localName !== 'EntityDescriptor' || root.namespaceURI !== 'urn:oasis:names:tc:SAML:2.0:metadata'`; `!issuer || issuer.length > 2048 || /[\x00-\x1f]/.test(issuer)`; 异常 / errors `new AppError('SAML 元数据过大或含有禁止的实体声明')`; `new AppError('需要单个有效的 SAML EntityDescriptor')`.
 * 失败处理：catch 分支执行 `throw new AppError('SAML 签名证书格式无效');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `throw new AppError('SAML 签名证书格式无效');`; these statements determine whether a failure is absorbed or rejected again.
 */
export function parseSamlMetadata(xml: string, now = Date.now()) {
  if (Buffer.byteLength(xml) > 512 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))
    throw new AppError('SAML 元数据过大或含有禁止的实体声明');
  let invalid = false;
  const doc = new DOMParser({
    /**
     * 入口 / Entry: parseSamlMetadata.onError.
     * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`sso.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `sso.ts`; the calls and state transitions below complete the operation. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `invalid`.
     */
    onError: () => {
      invalid = true;
    },
  }).parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (
    invalid ||
    root?.localName !== 'EntityDescriptor' ||
    root.namespaceURI !== 'urn:oasis:names:tc:SAML:2.0:metadata'
  )
    throw new AppError('需要单个有效的 SAML EntityDescriptor');
  const issuer = root.getAttribute('entityID') || '';
  if (!issuer || issuer.length > 2048 || /[\x00-\x1f]/.test(issuer))
    throw new AppError('SAML Entity ID 无效');
  const descriptors = root.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:metadata', 'IDPSSODescriptor');
  const descriptor = Array.from(descriptors).find((item) =>
    (item.getAttribute('protocolSupportEnumeration') || '')
      .split(/\s+/)
      .includes('urn:oasis:names:tc:SAML:2.0:protocol'),
  );
  if (!descriptor) throw new AppError('元数据没有 SAML 2.0 身份提供商描述');
  const services = descriptor.getElementsByTagNameNS(
    'urn:oasis:names:tc:SAML:2.0:metadata',
    'SingleSignOnService',
  );
  const redirect = Array.from(services).find(
    (item) => item.getAttribute('Binding') === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
  );
  if (!redirect) throw new AppError('身份提供商没有 HTTP-Redirect 登录入口');
  const entryPoint = url(redirect.getAttribute('Location') || '');
  const keys = descriptor.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:metadata', 'KeyDescriptor');
  const certs: string[] = [];
  for (const key of Array.from(keys)) {
    if (key.getAttribute('use') && key.getAttribute('use') !== 'signing') continue;
    const nodes = key.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'X509Certificate');
    for (const node of Array.from(nodes)) {
      const encoded = (node.textContent || '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 16384)
        throw new AppError('SAML 签名证书格式无效');
      const pem = `-----BEGIN CERTIFICATE-----\n${encoded.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;
      let certificate: X509Certificate;
      try {
        certificate = new X509Certificate(pem);
      } catch {
        throw new AppError('SAML 签名证书格式无效');
      }
      if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now)
        throw new AppError('SAML 签名证书尚未生效或已过期');
      if (!certs.includes(pem)) certs.push(pem);
    }
  }
  if (!certs.length || certs.length > 4) throw new AppError('需要 1–4 张有效的 SAML 签名证书');
  return { issuer, entryPoint, certs };
}

/**
 * 入口 / Entry: ssoCallbackPage.
 * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ html, nonce }` 供上层消费（`sso.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `sso.ts`; this entry produces `{ html, nonce }` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
 * 处理：通过 `randomBytes().toString`, `randomBytes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `randomBytes().toString`, `randomBytes`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: origin: string | null; state: string; result: unknown optional; error: string optional
 * 输出 / Returns: `{ html, nonce }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function ssoCallbackPage(origin: string | null, state: string, result?: unknown, error?: string) {
  const nonce = randomBytes(18).toString('base64url');
  const payload = JSON.stringify({ type: 'sakura-sso', state, ...(error ? { error } : { result }) })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const target = JSON.stringify(origin).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Sakura 单点登录</title><body><p id="status">正在返回 Sakura…</p><script nonce="${nonce}">const target=${target};const payload=${payload};const status=document.getElementById('status');if(target&&window.opener){window.opener.postMessage(payload,target);status.textContent=payload.error||'登录已完成，可以关闭此窗口。';window.close()}else{status.textContent=payload.error||'登录窗口已关闭，请返回 Sakura 重试。'}</script></body></html>`;
  return { html, nonce };
}

/**
 * 入口 / Entry: requireSamlRecipient.
 * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`sso.ts`）。
 * Purpose: Checks admission, input or resource ownership in `sso.ts`; the calls and state transitions below complete the operation. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
 * 处理：通过 `DOMParser.parseFromString`, `document.getElementsByTagNameNS` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `DOMParser.parseFromString`, `document.getElementsByTagNameNS`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: assertionXml: string; requestId: string; callbackUrl: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!valid`; 异常 / errors `new AppError('SAML 断言未绑定本次登录与 ACS 地址', 403)`.
 */
export function requireSamlRecipient(assertionXml: string, requestId: string, callbackUrl: string) {
  const document = new DOMParser().parseFromString(assertionXml, 'application/xml');
  const confirmations = document.getElementsByTagNameNS(
    'urn:oasis:names:tc:SAML:2.0:assertion',
    'SubjectConfirmation',
  );
  const valid = Array.from(confirmations).some((confirmation) => {
    if (confirmation.getAttribute('Method') !== 'urn:oasis:names:tc:SAML:2.0:cm:bearer') return false;
    const data = confirmation.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion',
      'SubjectConfirmationData',
    )[0];
    return data?.getAttribute('Recipient') === callbackUrl && data.getAttribute('InResponseTo') === requestId;
  });
  if (!valid) throw new AppError('SAML 断言未绑定本次登录与 ACS 地址', 403);
}

export class SingleSignOn {
  private state: State = defaults();
  private attempts = new Map<string, Attempt>();
  private revision = 0;
  private oidcConfig?: Promise<oidc.Configuration>;
  private saml?: SAML;
  private writes = Promise.resolve();
  /**
   * 入口 / Entry: SingleSignOn.constructor.
   * 功能：建立 SingleSignOn 的管理 OIDC/SAML 身份提供者与登录流程上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SingleSignOn context for this module's responsibility: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: access: AccessControlV1; port: number; file: default=join(DATA, 'sso.json'); protect: Protector default=dpapi; discover: typeof oidc.discovery default=oidc.discovery; now: default=Date.now; onRevoke: default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private access: AccessControlV1,
    private port: number,
    private file = join(DATA, 'sso.json'),
    private protect: Protector = dpapi,
    private discover: typeof oidc.discovery = oidc.discovery,
    private now = Date.now,
    private onRevoke = () => {},
  ) {}
  /**
   * 入口 / Entry: SingleSignOn.init.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`SingleSignOn`）。
   * Purpose: Initializes and verifies current domain state in `SingleSignOn`; the outcome is recorded in `this.state`. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `stateSchema.parse`, `readStore`, `this.state.bindings.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `this.state.bindings.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(keys).size !== keys.length`; 异常 / errors `new AppError('SSO 目录包含重复外部身份', 503)`.
   */
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    const keys = this.state.bindings.map((item) => `${item.provider}\0${item.issuer}\0${item.subject}`);
    if (new Set(keys).size !== keys.length) throw new AppError('SSO 目录包含重复外部身份', 503);
  }
  /**
   * 入口 / Entry: SingleSignOn.revokeCredential.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; the calls and state transitions below complete the operation. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.access.revokeFederatedCredential`, `this.onRevoke` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.access.revokeFederatedCredential`, `this.onRevoke`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.access.revokeFederatedCredential(id)`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private revokeCredential(id: string) {
    if (this.access.revokeFederatedCredential(id)) this.onRevoke();
  }
  /**
   * 入口 / Entry: SingleSignOn.serial.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `result` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `result.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `result.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const result = this.writes.catch(() => {}).then(work);
    this.writes = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  /**
   * 入口 / Entry: SingleSignOn.invalidate.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.oidcConfig`, `this.saml`（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; the outcome is recorded in `this.oidcConfig`, `this.saml`. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.attempts.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.attempts.clear`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `providerId === 'oidc'`.
   * 输入 / Inputs: providerId: SsoProvider
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.attempts.clear`; 更新 / updates `this.oidcConfig`, `this.saml`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private invalidate(providerId: SsoProvider) {
    this.revision++;
    this.attempts.clear();
    if (providerId === 'oidc') this.oidcConfig = undefined;
    else this.saml = undefined;
  }
  /**
   * 入口 / Entry: SingleSignOn.cancelPending.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; the calls and state transitions below complete the operation. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.attempts.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.attempts.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.attempts.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  cancelPending() {
    this.revision++;
    this.attempts.clear();
  }
  /**
   * 入口 / Entry: SingleSignOn.pendingOrigin.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `attempt?.provider === providerId && attempt.expiresAt > this.now() && attempt.revision === this.revision ? attempt.origin : n…` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `null` / `attempt?.provider === providerId && attempt.expiresAt > this.now() && attempt.revision === this.revision ? attempt.origin : n…` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `inline.test`, `this.attempts.get`, `digest`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.test`, `this.attempts.get`, `digest`, `this.now`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!/^[A-Za-z0-9_-]{40,60}$/.test(state)`.
   * 输入 / Inputs: providerId: SsoProvider; state: string
   * 输出 / Returns: `null`; `attempt?.provider === providerId && attempt.expiresAt > this.now() && attempt.revision === this.revision ? attempt.origin : n…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  pendingOrigin(providerId: SsoProvider, state: string) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(state)) return null;
    const attempt = this.attempts.get(digest(state));
    return attempt?.provider === providerId &&
      attempt.expiresAt > this.now() &&
      attempt.revision === this.revision
      ? attempt.origin
      : null;
  }
  /**
   * 入口 / Entry: SingleSignOn.save.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，校验并提交领域状态变更；处理结果记录到 `this.state`（`SingleSignOn`）。
   * Purpose: Validates and commits a domain state change in `SingleSignOn`; the outcome is recorded in `this.state`. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `writeStore`, `this.state.bindings.filter`, `this.revokeCredential`, `this.invalidate` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`, `this.state.bindings.filter`, `this.revokeCredential`, `this.invalidate`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `providerId`.
   * 输入 / Inputs: next: State; providerId: SsoProvider optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(next: State, providerId?: SsoProvider) {
    await writeStore(this.file, next);
    if (providerId) {
      for (const item of this.state.bindings.filter((binding) => binding.provider === providerId))
        this.revokeCredential(item.id);
    }
    this.state = next;
    if (providerId) this.invalidate(providerId);
  }
  /**
   * 入口 / Entry: SingleSignOn.providers.
   * 功能：从当前输入或状态计算 `{ oidc: !!this.state.oidc, saml: !!this.state.saml }`，供调用方后续验证或使用。
   * Purpose: Computes `{ oidc: !!this.state.oidc, saml: !!this.state.saml }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ oidc: !!this.state.oidc, saml: !!this.state.saml }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  providers() {
    return { oidc: !!this.state.oidc, saml: !!this.state.saml };
  }
  /**
   * 入口 / Entry: SingleSignOn.view.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ oidc: this.state.oidc && { issuer: this.state.oidc.issuer, clientId: this.state.oidc.clientId, authMethod: this.state.oidc.…` 供上层消费（`SingleSignOn`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SingleSignOn`; this entry produces `{ oidc: this.state.oidc && { issuer: this.state.oidc.issuer, clientId: this.state.oidc.clientId, authMethod: this.state.oidc.…` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.state.saml.certs.map`, `this.state.bindings.filter().map`, `this.state.bindings.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.saml.certs.map`, `this.state.bindings.filter().map`, `this.state.bindings.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: accountId: string optional
   * 输出 / Returns: `{ oidc: this.state.oidc && { issuer: this.state.oidc.issuer, clientId: this.state.oidc.clientId, authMethod: this.state.oidc.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(accountId?: string) {
    return {
      oidc: this.state.oidc && {
        issuer: this.state.oidc.issuer,
        clientId: this.state.oidc.clientId,
        authMethod: this.state.oidc.authMethod,
        hasSecret: !!this.state.oidc.secret,
      },
      saml: this.state.saml && {
        issuer: this.state.saml.issuer,
        entryPoint: this.state.saml.entryPoint,
        fingerprints: this.state.saml.certs.map((cert) => new X509Certificate(cert).fingerprint256),
      },
      callbackUrl: `http://localhost:${this.port}/api/access/sso/oidc/callback`,
      samlCallbackUrl: `http://localhost:${this.port}/api/access/sso/saml/callback`,
      serviceProviderId: `urn:sakura:localhost:${this.port}`,
      bindings: this.state.bindings
        .filter((item) => !accountId || item.accountId === accountId)
        .map(({ id, provider, accountId, issuer, subject, createdAt }) => ({
          id,
          provider,
          accountId,
          issuer,
          subject,
          createdAt,
        })),
    };
  }
  /**
   * 入口 / Entry: SingleSignOn.configuration.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.oidcConfig` / `discover` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `this.oidcConfig` / `discover` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `inline`, `discover.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline`, `discover.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `cache && this.oidcConfig`; `!cache`.
   * 输入 / Inputs: setting: default=this.state.oidc; cache: default=true
   * 输出 / Returns: `this.oidcConfig`; `discover`.
   * 副作用 / Effects: 更新 / updates `this.oidcConfig`.
   * 拒绝 / Refusals: 条件 / conditions `!setting`; 异常 / errors `new AppError('OIDC 尚未配置', 409)`.
   */
  private async configuration(setting = this.state.oidc, cache = true) {
    if (!setting) throw new AppError('OIDC 尚未配置', 409);
    if (cache && this.oidcConfig) return this.oidcConfig;
    /**
     * 入口 / Entry: SingleSignOn.configuration.callback@301.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `config`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `metadata.issuer !== setting.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri || […`; 异常 / errors `new AppError('OIDC 元数据的签发方或 HTTPS 端点无效', 409)`.
     */
    const discover = (async () => {
      const secret = setting.secret
        ? Buffer.from(await this.protect('unprotect', setting.secret), 'base64').toString('utf8')
        : undefined;
      const authentication =
        setting.authMethod === 'none'
          ? oidc.None()
          : setting.authMethod === 'client_secret_post'
            ? oidc.ClientSecretPost(secret)
            : oidc.ClientSecretBasic(secret);
      const config = await this.discover(
        new URL(setting.issuer),
        setting.clientId,
        { token_endpoint_auth_method: setting.authMethod },
        authentication,
        { timeout: 10, [oidc.customFetch]: oidcFetch },
      );
      const metadata = config.serverMetadata();
      if (
        metadata.issuer !== setting.issuer ||
        !metadata.authorization_endpoint ||
        !metadata.token_endpoint ||
        !metadata.jwks_uri ||
        [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri].some(
          (value) => !httpsEndpoint(value),
        ) ||
        !metadata.response_types_supported?.includes('code') ||
        !metadata.id_token_signing_alg_values_supported?.some(
          (alg) => alg !== 'none' && !alg.startsWith('HS'),
        ) ||
        (metadata.code_challenge_methods_supported &&
          !metadata.code_challenge_methods_supported.includes('S256')) ||
        (metadata.token_endpoint_auth_methods_supported &&
          !metadata.token_endpoint_auth_methods_supported.includes(setting.authMethod))
      )
        throw new AppError('OIDC 元数据的签发方或 HTTPS 端点无效', 409);
      return config;
    })();
    if (!cache) return discover;
    this.oidcConfig = discover.catch((error) => {
      this.oidcConfig = undefined;
      throw error;
    });
    return this.oidcConfig;
  }
  /**
   * 入口 / Entry: SingleSignOn.configureOidc.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，校验并提交领域状态变更；本入口产生 `this.serial(async () => { const secret = input.clientSecret ? await this.protect('protect', Buffer.from(input.clientSecret).t…` 供上层消费（`SingleSignOn`）。
   * Purpose: Validates and commits a domain state change in `SingleSignOn`; this entry produces `this.serial(async () => { const secret = input.clientSecret ? await this.protect('protect', Buffer.from(input.clientSecret).t…` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `ssoOidcInput.parse`, `url`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ssoOidcInput.parse`, `url`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.serial(async () => { const secret = input.clientSecret ? await this.protect('protect', Buffer.from(input.clientSecret).t…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async configureOidc(raw: unknown) {
    const input = ssoOidcInput.parse(raw);
    const issuer = url(input.issuer);
    /**
     * 入口 / Entry: SingleSignOn.configureOidc.callback@349.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `this.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.serial(async () => {
      const secret = input.clientSecret
        ? await this.protect('protect', Buffer.from(input.clientSecret).toString('base64'))
        : undefined;
      const next: State = {
        ...this.state,
        oidc: {
          issuer,
          clientId: input.clientId,
          authMethod: input.authMethod,
          ...(secret ? { secret } : {}),
        },
        bindings: this.state.bindings.filter((item) => item.provider !== 'oidc'),
      };
      await this.configuration(next.oidc, false);
      await this.save(next, 'oidc');
      return this.view();
    });
  }
  /**
   * 入口 / Entry: SingleSignOn.configureSaml.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，校验并提交领域状态变更；本入口产生 `this.serial(async () => { const next: State = { ...this.state, saml: metadata, bindings: this.state.bindings.filter((item) =>…` 供上层消费（`SingleSignOn`）。
   * Purpose: Validates and commits a domain state change in `SingleSignOn`; this entry produces `this.serial(async () => { const next: State = { ...this.state, saml: metadata, bindings: this.state.bindings.filter((item) =>…` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `ssoSamlInput.parse`, `parseSamlMetadata`, `this.now`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ssoSamlInput.parse`, `parseSamlMetadata`, `this.now`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.serial(async () => { const next: State = { ...this.state, saml: metadata, bindings: this.state.bindings.filter((item) =>…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async configureSaml(raw: unknown) {
    const input = ssoSamlInput.parse(raw);
    const metadata = parseSamlMetadata(input.metadataXml, this.now());
    return this.serial(async () => {
      const next: State = {
        ...this.state,
        saml: metadata,
        bindings: this.state.bindings.filter((item) => item.provider !== 'saml'),
      };
      await this.save(next, 'saml');
      return this.view();
    });
  }
  /**
   * 入口 / Entry: SingleSignOn.disable.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const next: State = { ...this.state, bindings: this.state.bindings.filter((item) => item.provider !…` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `this.serial(async () => { const next: State = { ...this.state, bindings: this.state.bindings.filter((item) => item.provider !…` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `provider.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `provider.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: providerId: SsoProvider
   * 输出 / Returns: `this.serial(async () => { const next: State = { ...this.state, bindings: this.state.bindings.filter((item) => item.provider !…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async disable(providerId: SsoProvider) {
    provider.parse(providerId);
    /**
     * 入口 / Entry: SingleSignOn.disable.callback@383.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `this.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.serial(async () => {
      const next: State = {
        ...this.state,
        bindings: this.state.bindings.filter((item) => item.provider !== providerId),
      };
      delete next[providerId];
      await this.save(next, providerId);
      return this.view();
    });
  }
  /**
   * 入口 / Entry: SingleSignOn.samlClient.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.saml` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `this.saml` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.saml`.
   * 副作用 / Effects: 更新 / updates `this.saml`.
   * 拒绝 / Refusals: 条件 / conditions `!setting`; `Date.parse(x509.validTo) <= this.now()`; 异常 / errors `new AppError('SAML 尚未配置', 409)`; `new AppError('SAML 签名证书已过期，请更新元数据', 409)`.
   */
  private samlClient() {
    const setting = this.state.saml;
    if (!setting) throw new AppError('SAML 尚未配置', 409);
    for (const cert of setting.certs) {
      const x509 = new X509Certificate(cert);
      if (Date.parse(x509.validTo) <= this.now())
        throw new AppError('SAML 签名证书已过期，请更新元数据', 409);
    }
    this.saml ||= new SAML({
      idpCert: setting.certs,
      issuer: `urn:sakura:localhost:${this.port}`,
      callbackUrl: `http://localhost:${this.port}/api/access/sso/saml/callback`,
      entryPoint: setting.entryPoint,
      idpIssuer: setting.issuer,
      audience: `urn:sakura:localhost:${this.port}`,
      validateInResponseTo: ValidateInResponseTo.always,
      wantAuthnResponseSigned: false,
      wantAssertionsSigned: false,
      acceptedClockSkewMs: 30_000,
      requestIdExpirationPeriodMs: 5 * 60_000,
    });
    return this.saml;
  }
  /**
   * 入口 / Entry: SingleSignOn.begin.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ redirect, state, expiresAt: attempt.expiresAt }` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `{ redirect, state, expiresAt: attempt.expiresAt }` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `ssoBeginInput.parse`, `this.access.authorize`, `inline.includes`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ssoBeginInput.parse`, `this.access.authorize`, `inline.includes`, `this.now`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `attempt.expiresAt <= this.now()`; `input.provider === 'oidc'`; `this.attempts.get(key) === attempt`.
   * 输入 / Inputs: raw: unknown; sourceToken: string optional
   * 输出 / Returns: `{ redirect, state, expiresAt: attempt.expiresAt }`.
   * 副作用 / Effects: `this.attempts.delete`; `this.attempts.set`; 更新 / updates `accountId`, `attempt.verifier`, `attempt.nonce`, `redirect`.
   * 拒绝 / Refusals: 条件 / conditions `!this.access.enabled`; `input.mode === 'link'`; `!sourceToken`; 异常 / errors `new AppError('请先启用账户模式', 409)`; `new AppError('需要登录后绑定外部身份', 401)`.
   * 失败处理：catch 分支执行 `if (this.attempts.get(key) === attempt) this.attempts.delete(key);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (this.attempts.get(key) === attempt) this.attempts.delete(key);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async begin(raw: unknown, sourceToken?: string) {
    const input = ssoBeginInput.parse(raw);
    if (!this.access.enabled) throw new AppError('请先启用账户模式', 409);
    let accountId: string | undefined;
    if (input.mode === 'link') {
      if (!sourceToken) throw new AppError('需要登录后绑定外部身份', 401);
      accountId = this.access.authorize(sourceToken).id;
    }
    if (input.mode === 'login' && sourceToken) throw new AppError('已登录账户请使用绑定操作', 409);
    if (![`http://localhost:${this.port}`, `http://127.0.0.1:${this.port}`].includes(input.origin))
      throw new AppError('SSO 仅接受本机窗口', 403);
    for (const [key, attempt] of this.attempts)
      if (attempt.expiresAt <= this.now()) this.attempts.delete(key);
    if (this.attempts.size >= 64) throw new AppError('待完成的登录过多，请稍后再试', 429);
    const state = randomBytes(32).toString('base64url');
    const attempt: Attempt = {
      provider: input.provider,
      mode: input.mode,
      origin: input.origin,
      ...(accountId ? { accountId, sourceToken } : {}),
      expiresAt: this.now() + 5 * 60_000,
      revision: this.revision,
    };
    const key = digest(state);
    // Reserve admission before discovery or request construction can yield to another start.
    this.attempts.set(key, attempt);
    try {
      let redirect: string;
      if (input.provider === 'oidc') {
        const config = await this.configuration();
        attempt.verifier = oidc.randomPKCECodeVerifier();
        attempt.nonce = oidc.randomNonce();
        redirect = oidc.buildAuthorizationUrl(config, {
          redirect_uri: `http://localhost:${this.port}/api/access/sso/oidc/callback`,
          scope: 'openid',
          state,
          nonce: attempt.nonce,
          code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier),
          code_challenge_method: 'S256',
        }).href;
      } else redirect = await this.samlClient().getAuthorizeUrlAsync(state, undefined, {});
      if (attempt.revision !== this.revision || this.attempts.get(key) !== attempt)
        throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409);
      if (attempt.expiresAt <= this.now()) throw new AppError('SSO 登录已过期，请重新登录', 403);
      return { redirect, state, expiresAt: attempt.expiresAt };
    } catch (error) {
      if (this.attempts.get(key) === attempt) this.attempts.delete(key);
      throw error;
    }
  }
  /**
   * 入口 / Entry: SingleSignOn.take.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `attempt` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `attempt` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `inline.test`, `digest`, `this.attempts.get`, `this.attempts.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.test`, `digest`, `this.attempts.get`, `this.attempts.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: state: string; providerId: SsoProvider
   * 输出 / Returns: `attempt`.
   * 副作用 / Effects: `this.attempts.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!/^[A-Za-z0-9_-]{40,60}$/.test(state)`; `!attempt || attempt.provider !== providerId || attempt.expiresAt <= this.now() || attempt.revision !== this.revision`; 异常 / errors `new AppError('SSO 状态无效', 403)`; `new AppError('SSO 登录已过期或已使用', 403)`.
   */
  private take(state: string, providerId: SsoProvider) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(state)) throw new AppError('SSO 状态无效', 403);
    const key = digest(state);
    const attempt = this.attempts.get(key);
    this.attempts.delete(key);
    if (
      !attempt ||
      attempt.provider !== providerId ||
      attempt.expiresAt <= this.now() ||
      attempt.revision !== this.revision
    )
      throw new AppError('SSO 登录已过期或已使用', 403);
    return attempt;
  }
  /**
   * 入口 / Entry: SingleSignOn.complete.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (attempt.revision !== this.revision) throw new AppError('SSO 配置或控制面状态已变化，请重新绑定', 409); if (this.…` / `this.serial(async () => { if (attempt.revision !== this.revision) throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409); const bin…` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `this.serial(async () => { if (attempt.revision !== this.revision) throw new AppError('SSO 配置或控制面状态已变化，请重新绑定', 409); if (this.…` / `this.serial(async () => { if (attempt.revision !== this.revision) throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409); const bin…` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serial`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `attempt.mode === 'link'`.
   * 输入 / Inputs: attempt: Attempt; identity: Identity
   * 输出 / Returns: `this.serial(async () => { if (attempt.revision !== this.revision) throw new AppError('SSO 配置或控制面状态已变化，请重新绑定', 409); if (this.…`; `this.serial(async () => { if (attempt.revision !== this.revision) throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409); const bin…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `attempt.revision !== this.revision`; `!identity.issuer || !identity.subject || identity.subject.length > 2048`; 异常 / errors `new AppError('SSO 配置或控制面状态已变化，请重新登录', 409)`; `new AppError('身份提供商没有返回有效的主体标识', 403)`.
   */
  private async complete(attempt: Attempt, identity: Identity) {
    if (attempt.revision !== this.revision) throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409);
    if (!identity.issuer || !identity.subject || identity.subject.length > 2048)
      throw new AppError('身份提供商没有返回有效的主体标识', 403);
    if (attempt.mode === 'link') {
      const accountId = attempt.accountId!;
      /**
       * 入口 / Entry: SingleSignOn.complete.callback@486.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ linked: true, binding }`.
       * 副作用 / Effects: 更新 / updates `this.state`.
       * 拒绝 / Refusals: 条件 / conditions `attempt.revision !== this.revision`; `this.access.authorize(attempt.sourceToken).id !== accountId`; `collision`; 异常 / errors `new AppError('SSO 配置或控制面状态已变化，请重新绑定', 409)`; `new AppError('关联账户已失效', 401)`.
       */
      return this.serial(async () => {
        if (attempt.revision !== this.revision)
          throw new AppError('SSO 配置或控制面状态已变化，请重新绑定', 409);
        if (this.access.authorize(attempt.sourceToken).id !== accountId)
          throw new AppError('关联账户已失效', 401);
        const collision = this.state.bindings.find(
          (item) =>
            item.provider === attempt.provider &&
            item.issuer === identity.issuer &&
            item.subject === identity.subject &&
            item.accountId !== accountId,
        );
        if (collision) throw new AppError('该外部身份已关联另一账户', 409);
        const previous = this.state.bindings.find(
          (item) => item.provider === attempt.provider && item.accountId === accountId,
        );
        const binding = {
          id: randomUUID(),
          provider: attempt.provider,
          accountId,
          ...identity,
          createdAt: new Date(this.now()).toISOString(),
        };
        const next: State = {
          ...this.state,
          bindings: [...this.state.bindings.filter((item) => item !== previous), binding],
        };
        if (next.bindings.length > 100) throw new AppError('外部身份数量已达上限', 409);
        await withOperationCheck(async () => {
          if (attempt.revision !== this.revision)
            throw new AppError('SSO 配置或控制面状态已变化，请重新绑定', 409);
          if (this.access.authorize(attempt.sourceToken).id !== accountId)
            throw new AppError('关联账户已失效', 401);
        }, () => writeStore(this.file, next));
        this.state = next;
        if (previous) this.revokeCredential(previous.id);
        return { linked: true, binding };
      });
    }
    /**
     * 入口 / Entry: SingleSignOn.complete.callback@525.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `login`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `attempt.revision !== this.revision`; `!binding`; 异常 / errors `new AppError('SSO 配置或控制面状态已变化，请重新登录', 409)`; `new AppError('该外部身份尚未关联 Sakura 账户', 403)`.
     */
    return this.serial(async () => {
      if (attempt.revision !== this.revision)
        throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409);
      const binding = this.state.bindings.find(
        (item) =>
          item.provider === attempt.provider &&
          item.issuer === identity.issuer &&
          item.subject === identity.subject,
      );
      if (!binding) throw new AppError('该外部身份尚未关联 Sakura 账户', 403);
      const login = await this.access.completeFederatedLogin(binding.accountId, binding.id);
      if (attempt.revision !== this.revision) {
        this.access.logout(login.token);
        throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409);
      }
      return login;
    });
  }
  /**
   * 入口 / Entry: SingleSignOn.completeOidc.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ origin: attempt.origin, state, result: await this.complete(attempt, { issuer: claims.iss, subject: claims.sub }), }` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `{ origin: attempt.origin, state, result: await this.complete(attempt, { issuer: claims.iss, subject: claims.sub }), }` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `callback.searchParams.get`, `this.take`, `this.configuration`, `oidc.authorizationCodeGrant` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `callback.searchParams.get`, `this.take`, `this.configuration`, `oidc.authorizationCodeGrant`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: callback: URL
   * 输出 / Returns: `{ origin: attempt.origin, state, result: await this.complete(attempt, { issuer: claims.iss, subject: claims.sub }), }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!claims || claims.iss !== this.state.oidc?.issuer || typeof claims.sub !== 'string'`; 异常 / errors `new AppError('OIDC ID Token 的签发方或主体无效', 403)`.
   */
  async completeOidc(callback: URL) {
    const state = callback.searchParams.get('state') || '';
    const attempt = this.take(state, 'oidc');
    const config = await this.configuration();
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: attempt.verifier,
      expectedState: state,
      expectedNonce: attempt.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims || claims.iss !== this.state.oidc?.issuer || typeof claims.sub !== 'string')
      throw new AppError('OIDC ID Token 的签发方或主体无效', 403);
    return {
      origin: attempt.origin,
      state,
      result: await this.complete(attempt, { issuer: claims.iss, subject: claims.sub }),
    };
  }
  /**
   * 入口 / Entry: SingleSignOn.completeSaml.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ origin: attempt.origin, state, result: await this.complete(attempt, { issuer: profile.issuer, subject: profile.nameID }), }` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `{ origin: attempt.origin, state, result: await this.complete(attempt, { issuer: profile.issuer, subject: profile.nameID }), }` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.take`, `this.samlClient().validatePostResponseAsync`, `this.samlClient`, `requireSamlRecipient` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.take`, `this.samlClient().validatePostResponseAsync`, `this.samlClient`, `requireSamlRecipient`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: { SAMLResponse: string; RelayState: string }
   * 输出 / Returns: `{ origin: attempt.origin, state, result: await this.complete(attempt, { issuer: profile.issuer, subject: profile.nameID }), }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!input.SAMLResponse || input.SAMLResponse.length > 1024 * 1024`; `loggedOut || !profile?.nameID || profile.issuer !== this.state.saml?.issuer`; `typeof profile.inResponseTo !== 'string' || typeof profile.getAssertionXml !== 'function'`; 异常 / errors `new AppError('SAML 响应无效或过大', 403)`; `new AppError('SAML 断言的签发方或主体无效', 403)`.
   */
  async completeSaml(input: { SAMLResponse: string; RelayState: string }) {
    const state = input.RelayState || '';
    const attempt = this.take(state, 'saml');
    if (!input.SAMLResponse || input.SAMLResponse.length > 1024 * 1024)
      throw new AppError('SAML 响应无效或过大', 403);
    const { profile, loggedOut } = await this.samlClient().validatePostResponseAsync(input);
    if (loggedOut || !profile?.nameID || profile.issuer !== this.state.saml?.issuer)
      throw new AppError('SAML 断言的签发方或主体无效', 403);
    if (typeof profile.inResponseTo !== 'string' || typeof profile.getAssertionXml !== 'function')
      throw new AppError('SAML 断言未绑定本次登录', 403);
    requireSamlRecipient(
      profile.getAssertionXml(),
      profile.inResponseTo,
      `http://localhost:${this.port}/api/access/sso/saml/callback`,
    );
    return {
      origin: attempt.origin,
      state,
      result: await this.complete(attempt, { issuer: profile.issuer, subject: profile.nameID }),
    };
  }
  /**
   * 入口 / Entry: SingleSignOn.unlink.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const removed = this.state.bindings.filter( (item) => item.accountId === accountId && item.provider…` 供上层消费（`SingleSignOn`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SingleSignOn`; this entry produces `this.serial(async () => { const removed = this.state.bindings.filter( (item) => item.accountId === accountId && item.provider…` for its caller. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `provider.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `provider.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: accountId: string; providerId: SsoProvider
   * 输出 / Returns: `this.serial(async () => { const removed = this.state.bindings.filter( (item) => item.accountId === accountId && item.provider…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async unlink(accountId: string, providerId: SsoProvider) {
    provider.parse(providerId);
    /**
     * 入口 / Entry: SingleSignOn.unlink.callback@585.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ removed: removed.length }`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.serial(async () => {
      const removed = this.state.bindings.filter(
        (item) => item.accountId === accountId && item.provider === providerId,
      );
      const next: State = {
        ...this.state,
        bindings: this.state.bindings.filter((item) => !removed.includes(item)),
      };
      await writeStore(this.file, next);
      this.state = next;
      for (const item of removed) this.revokeCredential(item.id);
      return { removed: removed.length };
    });
  }
  /**
   * 入口 / Entry: SingleSignOn.close.
   * 功能：在管理 OIDC/SAML 身份提供者与登录流程中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`SingleSignOn`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SingleSignOn`; the calls and state transitions below complete the operation. Module context: Owns OIDC/SAML providers and login flow, checking callback origins, recipients and pending state.
   * 处理：通过 `this.attempts.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.attempts.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.attempts.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.attempts.clear();
    await this.writes;
  }
}
