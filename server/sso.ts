import { createHash, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { AccessControl } from './access-control.ts';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { dpapi, type Protector } from './secrets.ts';

const provider = z.enum(['oidc', 'saml']);
export type SsoProvider = z.infer<typeof provider>;
const url = (value: string, protocol = 'https:') => {
  const clean = value.trim();
  let parsed: URL;
  try { parsed = new URL(clean); }
  catch { throw new AppError('身份提供商地址需要有效的 HTTPS URL'); }
  if (parsed.protocol !== protocol || parsed.username || parsed.password ||
      parsed.search || parsed.hash || parsed.href.length > 2048)
    throw new AppError('身份提供商地址需要无凭证、查询和片段的 HTTPS URL');
  return parsed.pathname === '/' && clean === parsed.origin ? parsed.origin : parsed.href;
};
const httpsEndpoint = (value: string) => {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:' && !endpoint.username &&
      !endpoint.password && !endpoint.hash;
  } catch { return false; }
};
export const ssoOidcInput = z.object({
  issuer: z.string().min(1).max(2048),
  clientId: z.string().trim().min(1).max(256),
  authMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']),
  clientSecret: z.string().max(4096).optional(),
}).strict().refine((value) => value.authMethod === 'none'
  ? !value.clientSecret : !!value.clientSecret,
  '机密客户端需要 Client Secret，公开客户端不能保存 Client Secret');
export const ssoSamlInput = z.object({ metadataXml: z.string().min(1).max(512 * 1024) }).strict();
export const ssoBeginInput = z.object({ provider, mode: z.enum(['login', 'link']),
  origin: z.string().max(200) }).strict();
const bindingSchema = z.object({
  id: z.uuid(), provider, accountId: z.uuid(), issuer: z.string().min(1).max(2048),
  subject: z.string().min(1).max(2048), createdAt: z.iso.datetime(),
}).strict();
const stateSchema = z.object({
  version: z.literal(1),
  oidc: z.object({ issuer: z.url(), clientId: z.string(),
    authMethod: z.enum(['client_secret_basic', 'client_secret_post', 'none']),
    secret: z.string().optional() }).strict().optional(),
  saml: z.object({ issuer: z.string().min(1), entryPoint: z.url(),
    certs: z.array(z.string()).min(1).max(4) }).strict().optional(),
  bindings: z.array(bindingSchema).max(100),
}).strict();
type State = z.infer<typeof stateSchema>;
type Attempt = { provider: SsoProvider; mode: 'login' | 'link'; origin: string;
  accountId?: string; sourceToken?: string; expiresAt: number; revision: number;
  verifier?: string; nonce?: string };
type Identity = { issuer: string; subject: string };
const defaults = (): State => ({ version: 1, bindings: [] });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Validates owner-supplied IdP metadata; the owner must obtain it from the intended IdP. */
export function parseSamlMetadata(xml: string, now = Date.now()) {
  if (Buffer.byteLength(xml) > 512 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)/i.test(xml))
    throw new AppError('SAML 元数据过大或含有禁止的实体声明');
  let invalid = false;
  const doc = new DOMParser({ onError: () => { invalid = true; } })
    .parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (invalid || root?.localName !== 'EntityDescriptor' ||
      root.namespaceURI !== 'urn:oasis:names:tc:SAML:2.0:metadata')
    throw new AppError('需要单个有效的 SAML EntityDescriptor');
  const issuer = root.getAttribute('entityID') || '';
  if (!issuer || issuer.length > 2048 || /[\x00-\x1f]/.test(issuer))
    throw new AppError('SAML Entity ID 无效');
  const descriptors = root.getElementsByTagNameNS(
    'urn:oasis:names:tc:SAML:2.0:metadata', 'IDPSSODescriptor');
  const descriptor = Array.from(descriptors).find((item) =>
    (item.getAttribute('protocolSupportEnumeration') || '').split(/\s+/)
      .includes('urn:oasis:names:tc:SAML:2.0:protocol'));
  if (!descriptor) throw new AppError('元数据没有 SAML 2.0 身份提供商描述');
  const services = descriptor.getElementsByTagNameNS(
    'urn:oasis:names:tc:SAML:2.0:metadata', 'SingleSignOnService');
  const redirect = Array.from(services).find((item) => item.getAttribute('Binding') ===
    'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect');
  if (!redirect) throw new AppError('身份提供商没有 HTTP-Redirect 登录入口');
  const entryPoint = url(redirect.getAttribute('Location') || '');
  const keys = descriptor.getElementsByTagNameNS(
    'urn:oasis:names:tc:SAML:2.0:metadata', 'KeyDescriptor');
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
      try { certificate = new X509Certificate(pem); }
      catch { throw new AppError('SAML 签名证书格式无效'); }
      if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now)
        throw new AppError('SAML 签名证书尚未生效或已过期');
      if (!certs.includes(pem)) certs.push(pem);
    }
  }
  if (!certs.length || certs.length > 4) throw new AppError('需要 1–4 张有效的 SAML 签名证书');
  return { issuer, entryPoint, certs };
}

export function ssoCallbackPage(origin: string | null, state: string,
  result?: unknown, error?: string) {
  const nonce = randomBytes(18).toString('base64url');
  const payload = JSON.stringify({ type: 'sakura-sso', state,
    ...(error ? { error } : { result }) }).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const target = JSON.stringify(origin).replace(/</g, '\\u003c');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Sakura 单点登录</title><body><p id="status">正在返回 Sakura…</p><script nonce="${nonce}">const target=${target};const payload=${payload};const status=document.getElementById('status');if(target&&window.opener){window.opener.postMessage(payload,target);status.textContent=payload.error||'登录已完成，可以关闭此窗口。';window.close()}else{status.textContent=payload.error||'登录窗口已关闭，请返回 Sakura 重试。'}</script></body></html>`;
  return { html, nonce };
}

export function requireSamlRecipient(assertionXml: string, requestId: string, callbackUrl: string) {
  const document = new DOMParser().parseFromString(assertionXml, 'application/xml');
  const confirmations = document.getElementsByTagNameNS(
    'urn:oasis:names:tc:SAML:2.0:assertion', 'SubjectConfirmation');
  const valid = Array.from(confirmations).some((confirmation) => {
    if (confirmation.getAttribute('Method') !==
        'urn:oasis:names:tc:SAML:2.0:cm:bearer') return false;
    const data = confirmation.getElementsByTagNameNS(
      'urn:oasis:names:tc:SAML:2.0:assertion', 'SubjectConfirmationData')[0];
    return data?.getAttribute('Recipient') === callbackUrl &&
      data.getAttribute('InResponseTo') === requestId;
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
  private onRevoke = () => {};
  constructor(private access: AccessControl, private port: number,
    private file = join(DATA, 'sso.json'), private protect: Protector = dpapi,
    private discover: typeof oidc.discovery = oidc.discovery,
    private now = Date.now) {}
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    const keys = this.state.bindings.map((item) => `${item.provider}\0${item.issuer}\0${item.subject}`);
    if (new Set(keys).size !== keys.length) throw new AppError('SSO 目录包含重复外部身份', 503);
  }
  setRevocationHandler(handler: () => void) { this.onRevoke = handler; }
  private revokeCredential(id: string) {
    if (this.access.revokeFederatedCredential(id)) this.onRevoke();
  }
  private serial<T>(work: () => Promise<T>) {
    const result = this.writes.catch(() => {}).then(work);
    this.writes = result.then(() => {}, () => {});
    return result;
  }
  private invalidate(providerId: SsoProvider) {
    this.revision++;
    this.attempts.clear();
    if (providerId === 'oidc') this.oidcConfig = undefined;
    else this.saml = undefined;
  }
  cancelPending() { this.revision++; this.attempts.clear(); }
  pendingOrigin(providerId: SsoProvider, state: string) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(state)) return null;
    const attempt = this.attempts.get(digest(state));
    return attempt?.provider === providerId && attempt.expiresAt > this.now() &&
      attempt.revision === this.revision ? attempt.origin : null;
  }
  private async save(next: State, providerId?: SsoProvider) {
    await writeStore(this.file, next);
    if (providerId) {
      for (const item of this.state.bindings.filter((binding) => binding.provider === providerId))
        this.revokeCredential(item.id);
    }
    this.state = next;
    if (providerId) this.invalidate(providerId);
  }
  providers() { return { oidc: !!this.state.oidc, saml: !!this.state.saml }; }
  view(accountId?: string) {
    return {
      oidc: this.state.oidc && { issuer: this.state.oidc.issuer,
        clientId: this.state.oidc.clientId, authMethod: this.state.oidc.authMethod,
        hasSecret: !!this.state.oidc.secret },
      saml: this.state.saml && { issuer: this.state.saml.issuer,
        entryPoint: this.state.saml.entryPoint,
        fingerprints: this.state.saml.certs.map((cert) => new X509Certificate(cert).fingerprint256) },
      callbackUrl: `http://localhost:${this.port}/api/access/sso/oidc/callback`,
      samlCallbackUrl: `http://localhost:${this.port}/api/access/sso/saml/callback`,
      serviceProviderId: `urn:sakura:localhost:${this.port}`,
      bindings: this.state.bindings.filter((item) => !accountId || item.accountId === accountId)
        .map(({ id, provider, accountId, issuer, subject, createdAt }) =>
          ({ id, provider, accountId, issuer, subject, createdAt })),
    };
  }
  private async configuration(setting = this.state.oidc, cache = true) {
    if (!setting) throw new AppError('OIDC 尚未配置', 409);
    if (cache && this.oidcConfig) return this.oidcConfig;
    const discover = (async () => {
      const secret = setting.secret ? Buffer.from(await this.protect('unprotect', setting.secret),
        'base64').toString('utf8') : undefined;
      const authentication = setting.authMethod === 'none' ? oidc.None() :
        setting.authMethod === 'client_secret_post' ? oidc.ClientSecretPost(secret) :
          oidc.ClientSecretBasic(secret);
      const config = await this.discover(new URL(setting.issuer), setting.clientId,
        { token_endpoint_auth_method: setting.authMethod }, authentication, { timeout: 10 });
      const metadata = config.serverMetadata();
      if (metadata.issuer !== setting.issuer || !metadata.authorization_endpoint ||
          !metadata.token_endpoint || !metadata.jwks_uri ||
          [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]
            .some((value) => !httpsEndpoint(value)) ||
          !metadata.response_types_supported?.includes('code') ||
          !metadata.id_token_signing_alg_values_supported?.some((alg) =>
            alg !== 'none' && !alg.startsWith('HS')) ||
          (metadata.code_challenge_methods_supported &&
            !metadata.code_challenge_methods_supported.includes('S256')) ||
          (metadata.token_endpoint_auth_methods_supported &&
            !metadata.token_endpoint_auth_methods_supported.includes(setting.authMethod)))
        throw new AppError('OIDC 元数据的签发方或 HTTPS 端点无效', 409);
      return config;
    })();
    if (!cache) return discover;
    this.oidcConfig = discover.catch((error) => { this.oidcConfig = undefined; throw error; });
    return this.oidcConfig;
  }
  async configureOidc(raw: unknown) {
    const input = ssoOidcInput.parse(raw);
    const issuer = url(input.issuer);
    return this.serial(async () => {
      const secret = input.clientSecret ? await this.protect('protect',
        Buffer.from(input.clientSecret).toString('base64')) : undefined;
      const next: State = { ...this.state, oidc: { issuer, clientId: input.clientId,
        authMethod: input.authMethod, ...(secret ? { secret } : {}) },
        bindings: this.state.bindings.filter((item) => item.provider !== 'oidc') };
      await this.configuration(next.oidc, false);
      await this.save(next, 'oidc');
      return this.view();
    });
  }
  async configureSaml(raw: unknown) {
    const input = ssoSamlInput.parse(raw);
    const metadata = parseSamlMetadata(input.metadataXml, this.now());
    return this.serial(async () => {
      const next: State = { ...this.state, saml: metadata,
        bindings: this.state.bindings.filter((item) => item.provider !== 'saml') };
      await this.save(next, 'saml');
      return this.view();
    });
  }
  async disable(providerId: SsoProvider) {
    provider.parse(providerId);
    return this.serial(async () => {
      const next: State = { ...this.state, bindings: this.state.bindings.filter((item) =>
        item.provider !== providerId) };
      delete next[providerId];
      await this.save(next, providerId);
      return this.view();
    });
  }
  private samlClient() {
    const setting = this.state.saml;
    if (!setting) throw new AppError('SAML 尚未配置', 409);
    for (const cert of setting.certs) {
      const x509 = new X509Certificate(cert);
      if (Date.parse(x509.validTo) <= this.now())
        throw new AppError('SAML 签名证书已过期，请更新元数据', 409);
    }
    this.saml ||= new SAML({ idpCert: setting.certs,
      issuer: `urn:sakura:localhost:${this.port}`,
      callbackUrl: `http://localhost:${this.port}/api/access/sso/saml/callback`,
      entryPoint: setting.entryPoint, idpIssuer: setting.issuer,
      audience: `urn:sakura:localhost:${this.port}`,
      validateInResponseTo: ValidateInResponseTo.always,
      wantAuthnResponseSigned: false, wantAssertionsSigned: false,
      acceptedClockSkewMs: 30_000, requestIdExpirationPeriodMs: 5 * 60_000,
    });
    return this.saml;
  }
  async begin(raw: unknown, sourceToken?: string) {
    const input = ssoBeginInput.parse(raw);
    if (!this.access.enabled) throw new AppError('请先启用账户模式', 409);
    let accountId: string | undefined;
    if (input.mode === 'link') {
      if (!sourceToken) throw new AppError('需要登录后绑定外部身份', 401);
      accountId = this.access.authorize(sourceToken).id;
    }
    if (input.mode === 'login' && sourceToken)
      throw new AppError('已登录账户请使用绑定操作', 409);
    if (![ `http://localhost:${this.port}`, `http://127.0.0.1:${this.port}` ]
      .includes(input.origin)) throw new AppError('SSO 仅接受本机窗口', 403);
    for (const [key, attempt] of this.attempts)
      if (attempt.expiresAt <= this.now()) this.attempts.delete(key);
    if (this.attempts.size >= 64) throw new AppError('待完成的登录过多，请稍后再试', 429);
    const state = randomBytes(32).toString('base64url');
    const attempt: Attempt = { provider: input.provider, mode: input.mode,
      origin: input.origin, ...(accountId ? { accountId, sourceToken } : {}),
      expiresAt: this.now() + 5 * 60_000, revision: this.revision };
    let redirect: string;
    if (input.provider === 'oidc') {
      const config = await this.configuration();
      attempt.verifier = oidc.randomPKCECodeVerifier();
      attempt.nonce = oidc.randomNonce();
      redirect = oidc.buildAuthorizationUrl(config, {
        redirect_uri: `http://localhost:${this.port}/api/access/sso/oidc/callback`,
        scope: 'openid', state, nonce: attempt.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(attempt.verifier),
        code_challenge_method: 'S256',
      }).href;
    } else redirect = await this.samlClient().getAuthorizeUrlAsync(state, undefined, {});
    this.attempts.set(digest(state), attempt);
    return { redirect, state, expiresAt: attempt.expiresAt };
  }
  private take(state: string, providerId: SsoProvider) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(state)) throw new AppError('SSO 状态无效', 403);
    const key = digest(state);
    const attempt = this.attempts.get(key);
    this.attempts.delete(key);
    if (!attempt || attempt.provider !== providerId || attempt.expiresAt <= this.now() ||
        attempt.revision !== this.revision)
      throw new AppError('SSO 登录已过期或已使用', 403);
    return attempt;
  }
  private async complete(attempt: Attempt, identity: Identity) {
    if (attempt.revision !== this.revision)
      throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409);
    if (!identity.issuer || !identity.subject || identity.subject.length > 2048)
      throw new AppError('身份提供商没有返回有效的主体标识', 403);
    if (attempt.mode === 'link') {
      const accountId = attempt.accountId!;
      return this.serial(async () => {
        if (attempt.revision !== this.revision)
          throw new AppError('SSO 配置或控制面状态已变化，请重新绑定', 409);
        if (this.access.authorize(attempt.sourceToken).id !== accountId)
          throw new AppError('关联账户已失效', 401);
        const collision = this.state.bindings.find((item) =>
          item.provider === attempt.provider && item.issuer === identity.issuer &&
          item.subject === identity.subject && item.accountId !== accountId);
        if (collision) throw new AppError('该外部身份已关联另一账户', 409);
        const previous = this.state.bindings.find((item) =>
          item.provider === attempt.provider && item.accountId === accountId);
        const binding = { id: randomUUID(), provider: attempt.provider, accountId,
          ...identity, createdAt: new Date(this.now()).toISOString() };
        const next: State = { ...this.state, bindings: [
          ...this.state.bindings.filter((item) => item !== previous), binding ] };
        if (next.bindings.length > 100) throw new AppError('外部身份数量已达上限', 409);
        await writeStore(this.file, next);
        this.state = next;
        if (previous) this.revokeCredential(previous.id);
        return { linked: true, binding };
      });
    }
    return this.serial(async () => {
      if (attempt.revision !== this.revision)
        throw new AppError('SSO 配置或控制面状态已变化，请重新登录', 409);
      const binding = this.state.bindings.find((item) => item.provider === attempt.provider &&
        item.issuer === identity.issuer && item.subject === identity.subject);
      if (!binding) throw new AppError('该外部身份尚未关联 Sakura 账户', 403);
      return this.access.completeFederatedLogin(binding.accountId, binding.id);
    });
  }
  async completeOidc(callback: URL) {
    const state = callback.searchParams.get('state') || '';
    const attempt = this.take(state, 'oidc');
    const config = await this.configuration();
    const tokens = await oidc.authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: attempt.verifier, expectedState: state,
      expectedNonce: attempt.nonce, idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims || claims.iss !== this.state.oidc?.issuer || typeof claims.sub !== 'string')
      throw new AppError('OIDC ID Token 的签发方或主体无效', 403);
    return { origin: attempt.origin, state,
      result: await this.complete(attempt, { issuer: claims.iss, subject: claims.sub }) };
  }
  async completeSaml(input: { SAMLResponse: string; RelayState: string }) {
    const state = input.RelayState || '';
    const attempt = this.take(state, 'saml');
    if (!input.SAMLResponse || input.SAMLResponse.length > 1024 * 1024)
      throw new AppError('SAML 响应无效或过大', 403);
    const { profile, loggedOut } = await this.samlClient().validatePostResponseAsync(input);
    if (loggedOut || !profile?.nameID || profile.issuer !== this.state.saml?.issuer)
      throw new AppError('SAML 断言的签发方或主体无效', 403);
    if (typeof profile.inResponseTo !== 'string' ||
        typeof profile.getAssertionXml !== 'function')
      throw new AppError('SAML 断言未绑定本次登录', 403);
    requireSamlRecipient(profile.getAssertionXml(), profile.inResponseTo,
      `http://localhost:${this.port}/api/access/sso/saml/callback`);
    return { origin: attempt.origin, state,
      result: await this.complete(attempt, { issuer: profile.issuer, subject: profile.nameID }) };
  }
  async unlink(accountId: string, providerId: SsoProvider) {
    provider.parse(providerId);
    return this.serial(async () => {
      const removed = this.state.bindings.filter((item) =>
        item.accountId === accountId && item.provider === providerId);
      const next: State = { ...this.state, bindings: this.state.bindings.filter((item) =>
        !removed.includes(item)) };
      await writeStore(this.file, next);
      this.state = next;
      for (const item of removed) this.revokeCredential(item.id);
      return { removed: removed.length };
    });
  }
  async close() { this.attempts.clear(); await this.writes; }
}
