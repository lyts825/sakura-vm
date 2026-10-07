/**
 * 模块职责：回归验证模块，围绕 `sso` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `sso`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: OIDC login binds an existing account, validates PKCE and ID Token, and revokes on unlink; SAML metadata requires a valid signing certificate and callback page escapes identity data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import * as oidc from 'openid-client';
import { generate } from 'selfsigned';
import { SignedXml } from 'xml-crypto';
import { AccessControl } from '../server/access-control.ts';
import { SingleSignOn, parseSamlMetadata, ssoCallbackPage } from '../server/sso.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: OIDC login binds an existing account, validates PKCE and ID Token, and revokes on unlink
 * 状态影响 / State effects: `configuration[oidc.customFetch]`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 失败 / Failure: `new Error('OIDC login did not issue a session')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `access.init`.
 * 检查边界 / Checked boundaries: `assert.equal(sso.providers().oidc, true)`; `assert.ok(!JSON.stringify(sso.view()).includes('test-access-token'))`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('OIDC login binds an existing account, validates PKCE and ID Token, and revokes on unlink',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sakura-sso-'));
    const access = new AccessControl(join(directory, 'access.json'));
    await access.init();
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
    const issuer = 'https://id.example.test/';
    const configuration = new oidc.Configuration({ issuer,
      authorization_endpoint: issuer + 'authorize', token_endpoint: issuer + 'token',
      jwks_uri: issuer + 'jwks', response_types_supported: ['code'],
      id_token_signing_alg_values_supported: ['RS256'] },
    'sakura-test', { token_endpoint_auth_method: 'none' }, oidc.None());
    let nonce = '';
    let tokenCalls = 0;
    configuration[oidc.customFetch] = /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: input; init。
     * 结果：返回分支计算值（`new Response(JSON.stringify({ keys: [key] }), { headers: { 'content-type': 'appl… / new Response(JSON.stringify({ access_token: 'test-access-token', token_type: 'Be…`），以 Promise 交付。
     * Result: Return the branch-computed value (`new Response(JSON.stringify({ keys: [key] }), { headers: { 'content-type': 'appl… / new Response(JSON.stringify({ access_token: 'test-access-token', token_type: 'Be…`) through a Promise.
     * 验证场景 / Scenario: OIDC login binds an existing account, validates PKCE and ID Token, and revokes on unlink
     * 协作入口 / Collaborators: `String`, `JSON.stringify`, `assert.equal`, `form.get`.
     * 检查边界 / Checked boundaries: `assert.equal(uri.pathname, '/token')`; `assert.equal(form.get('code'), 'test-code')`.
     */
    async (input, init) => {
      const uri = new URL(String(input));
      if (uri.pathname === '/jwks') return new Response(JSON.stringify({ keys: [key] }),
        { headers: { 'content-type': 'application/json' } });
      assert.equal(uri.pathname, '/token');
      tokenCalls++;
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('code'), 'test-code');
      assert.ok((form.get('code_verifier') || '').length >= 43);
      assert.equal(form.get('redirect_uri'),
        'http://localhost:7337/api/access/sso/oidc/callback');
      const issued = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ iss: issuer, sub: 'external-user',
        aud: 'sakura-test', iat: issued, exp: issued + 300, nonce })).toString('base64url');
      const content = header + '.' + claims;
      const idToken = content + '.' + sign('RSA-SHA256', Buffer.from(content), privateKey)
        .toString('base64url');
      return new Response(JSON.stringify({ access_token: 'test-access-token',
        token_type: 'Bearer', id_token: idToken }),
      { headers: { 'content-type': 'application/json' } });
    };
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`configuration`），以 Promise 交付。
     * Result: Return the branch-computed value (`configuration`) through a Promise.
     * 验证场景 / Scenario: OIDC login binds an existing account, validates PKCE and ID Token, and revokes on unlink
     */
    const discover: typeof oidc.discovery = async () => configuration;
    const ssoFile = join(directory, 'sso.json');
    const sso = new SingleSignOn(access, 7337, ssoFile,
      async (_operation, value) => value, discover);
    try {
      await access.enable({ password: 'correct horse battery staple' });
      const owner = await access.login({ username: 'owner',
        password: 'correct horse battery staple' });
      await sso.init();
      await sso.configureOidc({ issuer, clientId: 'sakura-test', authMethod: 'none' });
      assert.equal(sso.providers().oidc, true);
      assert.ok(!JSON.stringify(sso.view()).includes('test-access-token'));
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: mode: 'link' | 'login'; token: string。
       * 结果：返回分支计算值（`new URL(`http://localhost:7337/api/access/sso/oidc/callback?code=test-code&state…`），以 Promise 交付。
       * Result: Return the branch-computed value (`new URL(`http://localhost:7337/api/access/sso/oidc/callback?code=test-code&state…`) through a Promise.
       * 验证场景 / Scenario: OIDC login binds an existing account, validates PKCE and ID Token, and revokes on unlink
       * 状态影响 / State effects: `nonce`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `sso.begin`, `redirect.searchParams.get`, `assert.equal`.
       * 检查边界 / Checked boundaries: `assert.equal(redirect.searchParams.get('state'), begun.state)`; `assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256')`.
       */
      const start = async (mode: 'link' | 'login', token?: string) => {
        const begun = await sso.begin({ provider: 'oidc', mode,
          origin: 'http://127.0.0.1:7337' }, token);
        const redirect = new URL(begun.redirect);
        nonce = redirect.searchParams.get('nonce') || '';
        assert.equal(redirect.searchParams.get('state'), begun.state);
        assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
        return new URL(`http://localhost:7337/api/access/sso/oidc/callback?code=test-code&state=${begun.state}`);
      };
      await assert.rejects(sso.begin({ provider: 'oidc', mode: 'login',
        origin: 'https://attacker.example' }), /本机窗口/);
      const linkCallback = await start('link', owner.token);
      const link = await sso.completeOidc(linkCallback);
      assert.equal('linked' in link.result && link.result.linked, true);
      assert.equal(sso.view(owner.principal.id).bindings.length, 1);
      await assert.rejects(sso.completeOidc(linkCallback), /已过期或已使用/);
      const loginCallback = await start('login');
      const login = await sso.completeOidc(loginCallback);
      assert.ok('token' in login.result);
      if (!('token' in login.result)) throw new Error('OIDC login did not issue a session');
      const federatedToken = login.result.token;
      assert.equal(access.authorize(federatedToken).id, owner.principal.id);
      assert.equal(tokenCalls, 2);
      assert.ok((await readFile(ssoFile, 'utf8')).includes('external-user'));
      assert.equal((await sso.unlink(owner.principal.id, 'oidc')).removed, 1);
      assert.throws(() => access.authorize(federatedToken), /访问凭证/);
      const unbound = await start('login');
      await assert.rejects(sso.completeOidc(unbound), /尚未关联/);
      assert.equal(tokenCalls, 3);
    } finally {
      await sso.close();
      await access.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SAML metadata requires a valid signing certificate and callback page escapes identity data
 * 协作入口 / Collaborators: `generate`, `Date.now`, `certificate.cert.replace`, `parseSamlMetadata`.
 * 检查边界 / Checked boundaries: `assert.equal(parsed.issuer, 'https://id.example.test/saml')`; `assert.equal(parsed.certs.length, 1)`.
 */
test('SAML metadata requires a valid signing certificate and callback page escapes identity data',
  async () => {
    const certificate = await generate([{ name: 'commonName', value: 'Sakura IdP test' }],
      { notBeforeDate: new Date(Date.now() - 60_000),
        notAfterDate: new Date(Date.now() + 2 * 86400_000) });
    const encoded = certificate.cert.replace(/-----[^-]+-----|\s/g, '');
    const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://id.example.test/saml"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${encoded}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://id.example.test/login"/></IDPSSODescriptor></EntityDescriptor>`;
    const parsed = parseSamlMetadata(metadata);
    assert.equal(parsed.issuer, 'https://id.example.test/saml');
    assert.equal(parsed.certs.length, 1);
    assert.throws(() => parseSamlMetadata('<!DOCTYPE x><EntityDescriptor/>'), /实体声明/);
    assert.throws(() => parseSamlMetadata(metadata.replace('https://id.example.test/login',
      'http://id.example.test/login')), /HTTPS/);
    const page = ssoCallbackPage('http://localhost:7337', 'state',
      { subject: '</script><script>alert(1)</script>' });
    assert.ok(!page.html.includes('</script><script>alert(1)'));
    assert.ok(page.html.includes('\\u003c/script>'));
  });

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SAML accepts a signed solicited assertion and rejects an incorrect ACS recipient
 * 失败 / Failure: `new Error('SAML login did not issue a session')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `generate`.
 * 检查边界 / Checked boundaries: `assert.ok('linked' in linked.result && linked.result.linked)`; `assert.ok('token' in session.result)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('SAML accepts a signed solicited assertion and rejects an incorrect ACS recipient', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-saml-'));
  const access = new AccessControl(join(directory, 'access.json'));
  const sso = new SingleSignOn(access, 7337, join(directory, 'sso.json'));
  const certificate = await generate([{ name: 'commonName', value: 'Sakura SAML IdP test' }],
    { notBeforeDate: new Date(Date.now() - 60_000),
      notAfterDate: new Date(Date.now() + 2 * 86400_000) });
  const certBody = certificate.cert.replace(/-----[^-]+-----|\s/g, '');
  const issuer = 'https://id.example.test/saml';
  const callback = 'http://localhost:7337/api/access/sso/saml/callback';
  const metadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${issuer}"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${certBody}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://id.example.test/login"/></IDPSSODescriptor></EntityDescriptor>`;
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: requestId: string; recipient = callback。
   * 结果：返回分支计算值（`Buffer.from(signature.getSignedXml()).toString('base64')`）。
   * Result: Return the branch-computed value (`Buffer.from(signature.getSignedXml()).toString('base64')`).
   * 验证场景 / Scenario: SAML accepts a signed solicited assertion and rejects an incorrect ACS recipient
   * 协作入口 / Collaborators: `new Date().toISOString`, `new Date(Date.now() - 60_000).toISOString`, `Date.now`, `new Date(Date.now() + 5 * 60_000).toISOString`.
   */
  const response = (requestId: string, recipient = callback) => {
    const now = new Date().toISOString();
    const before = new Date(Date.now() - 60_000).toISOString();
    const after = new Date(Date.now() + 5 * 60_000).toISOString();
    const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response" Version="2.0" IssueInstant="${now}" Destination="${callback}" InResponseTo="${requestId}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assertion" Version="2.0" IssueInstant="${now}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID>external-saml-user</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="${recipient}" NotOnOrAfter="${after}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${before}" NotOnOrAfter="${after}"><saml:AudienceRestriction><saml:Audience>urn:sakura:localhost:7337</saml:Audience></saml:AudienceRestriction></saml:Conditions></saml:Assertion></samlp:Response>`;
    const signature = new SignedXml({ privateKey: certificate.private,
      publicCert: certificate.cert,
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
    signature.addReference({ xpath: "/*[local-name()='Response']",
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#'] });
    signature.computeSignature(xml, { location: { reference:
      "/*[local-name()='Response']/*[local-name()='Issuer']", action: 'after' } });
    return Buffer.from(signature.getSignedXml()).toString('base64');
  };
  try {
    await access.init();
    await access.enable({ password: 'correct horse battery staple' });
    const owner = await access.login({ username: 'owner',
      password: 'correct horse battery staple' });
    await sso.init();
    await sso.configureSaml({ metadataXml: metadata });
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: mode: 'link' | 'login'; token: string。
     * 结果：返回受控对象，公开字段包括 `state, id`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `state, id`; the actual branch determines its shape.
     * 验证场景 / Scenario: SAML accepts a signed solicited assertion and rejects an incorrect ACS recipient
     * 协作入口 / Collaborators: `sso.begin`, `assert.equal`, `target.searchParams.get`, `inflateRawSync(Buffer.from(target.searchParams.get('SAMLRequest')!, 'base64…`.
     * 检查边界 / Checked boundaries: `assert.equal(target.searchParams.get('RelayState'), begin.state)`; `assert.ok(id)`.
     */
    const start = async (mode: 'link' | 'login', token?: string) => {
      const begin = await sso.begin({ provider: 'saml', mode,
        origin: 'http://localhost:7337' }, token);
      const target = new URL(begin.redirect);
      assert.equal(target.searchParams.get('RelayState'), begin.state);
      const request = inflateRawSync(Buffer.from(target.searchParams.get('SAMLRequest')!, 'base64'))
        .toString('utf8');
      const id = /\bID="([^"]+)"/.exec(request)?.[1];
      assert.ok(id);
      return { state: begin.state, id };
    };
    const link = await start('link', owner.token);
    const linked = await sso.completeSaml({ SAMLResponse: response(link.id),
      RelayState: link.state });
    assert.ok('linked' in linked.result && linked.result.linked);
    const login = await start('login');
    const session = await sso.completeSaml({ SAMLResponse: response(login.id),
      RelayState: login.state });
    assert.ok('token' in session.result);
    if (!('token' in session.result)) throw new Error('SAML login did not issue a session');
    assert.equal(access.authorize(session.result.token).id, owner.principal.id);
    const bad = await start('login');
    await assert.rejects(sso.completeSaml({ SAMLResponse: response(bad.id,
      'http://attacker.example/acs'), RelayState: bad.state }), /ACS 地址/);
    await assert.rejects(sso.completeSaml({ SAMLResponse: response(login.id),
      RelayState: login.state }), /已过期或已使用/);
  } finally {
    await sso.close();
    await access.close();
    await rm(directory, { recursive: true, force: true });
  }
});
