import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { WebSocket } from 'ws';
import { generate } from 'selfsigned';
import { SignedXml } from 'xml-crypto';

const data = await mkdtemp(join(tmpdir(), 'sakura-access-vm-'));
assert.ok(resolve(data).startsWith(resolve(tmpdir()) + sep));
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const auditObjects = new Map<string, { body: string; versionId: string; until: string }>();
const auditS3 = createHttpServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.searchParams.has('object-lock')) {
    res.setHeader('content-type', 'application/xml');
    res.end('<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>');
    return;
  }
  if (req.method === 'PUT') {
    assert.equal(req.headers['x-amz-object-lock-mode'], 'COMPLIANCE');
    assert.ok(req.headers['x-amz-checksum-sha256']);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const versionId = `version-${auditObjects.size + 1}`;
    auditObjects.set(url.pathname, { body, versionId,
      until: String(req.headers['x-amz-object-lock-retain-until-date']) });
    res.setHeader('x-amz-version-id', versionId);
    res.end(); return;
  }
  const object = auditObjects.get(url.pathname);
  if (!object || url.searchParams.get('versionId') !== object.versionId) {
    res.writeHead(404).end(); return;
  }
  res.setHeader('x-amz-version-id', object.versionId);
  res.setHeader('x-amz-object-lock-mode', 'COMPLIANCE');
  res.setHeader('x-amz-object-lock-retain-until-date', object.until);
  res.setHeader('content-length', String(Buffer.byteLength(object.body)));
  res.end(req.method === 'HEAD' ? undefined : object.body);
});
await new Promise<void>((done) => auditS3.listen(0, '127.0.0.1', done));
const auditS3Port = (auditS3.address() as { port: number }).port;
const origin = `http://127.0.0.1:${port}`;
const passkeyOrigin = `http://localhost:${port}`;
const password = 'a long administrator password';
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
let server: ReturnType<typeof spawn> | undefined;
let output = '';
const start = async () => {
  server = spawn(process.execPath, ['.sakura-server/index.js'], {
    cwd: resolve('.'),
    env: { ...process.env, SAKURA_DATA_DIR: data, SAKURA_PORT: String(port),
      SAKURA_IMAGE_PATH: resolve('.data/images/alpine-3.23.qcow2'),
      AWS_ACCESS_KEY_ID: 'audit-test-key', AWS_SECRET_ACCESS_KEY: 'audit-test-secret' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  output = '';
  server.stdout?.on('data', (chunk) => { output += chunk; });
  server.stderr?.on('data', (chunk) => { output += chunk; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const response = await fetch(origin + '/api/access/status', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error('账户测试服务未启动：' + output);
};
const stop = async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise<void>((done) => server!.once('exit', () => done()));
  server.kill('SIGTERM');
  await Promise.race([exited, delay(10_000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await exited;
  server = undefined;
};
const request = async (path: string, method = 'GET', token?: string, body?: unknown,
  base = origin, timeoutMs = 20_000) => {
  try {
    const response = await fetch(base + path, {
      method, headers: { ...(token ? { 'x-sakura-token': token } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, body: await response.json() as any };
  } catch (error) { throw new Error(`${method} ${path}: ${String(error)}`); }
};
const wsStatus = async (token: string, path = '/ws/events') => {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + path +
    (path.includes('?') ? '&' : '?') + 'token=' + token,
    { handshakeTimeout: 3000 });
  socket.on('error', () => {});
  return new Promise<number>((done, fail) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume(); socket.terminate(); done(response.statusCode || 0);
    });
    socket.once('open', () => { socket.close(); done(101); });
    socket.once('error', fail);
  });
};

try {
  await start();
  let legacy = (await request('/api/bootstrap')).body.token as string;
  assert.equal(legacy.length, 64);
  assert.equal((await request('/api/plugins', 'PATCH', legacy,
    { kind: 'plugin', id: 'desktop', enabled: true })).status, 200);
  assert.equal((await request('/api/plugins', 'PATCH', legacy,
    { kind: 'plugin', id: 'terminal-workspace', enabled: true })).status, 200);
  assert.equal((await request('/api/plugins', 'PATCH', legacy,
    { kind: 'plugin', id: 'projects', enabled: true })).status, 200);
  assert.equal((await request('/api/plugins', 'PATCH', legacy,
    { kind: 'plugin', id: 'project-search', enabled: true })).status, 200);
  await stop();
  await start();
  legacy = (await request('/api/bootstrap')).body.token as string;
  const created = await request('/api/vms', 'POST', legacy,
    { name: 'access-fixture', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const vmId = created.body.id as string;
  const another = await request('/api/vms', 'POST', legacy,
    { name: 'private-fixture', memoryMiB: 512, cpus: 2, diskGiB: 4 });
  assert.equal(another.status, 201, JSON.stringify(another.body));
  assert.equal((await request('/api/access/enable', 'POST', legacy, { password })).status, 200);
  assert.equal((await request('/api/bootstrap')).status, 401);
  assert.equal((await request('/api/vms', 'GET', legacy)).status, 401);
  const owner = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  const ownerToken = owner.body.token as string;
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 200);
  assert.deepEqual((await request('/api/access/sso/providers')).body,
    { oidc: false, saml: false });
  assert.equal((await request('/api/access/sso')).status, 401);
  const ssoCert = await generate([{ name: 'commonName', value: 'Sakura smoke IdP' }],
    { notBeforeDate: new Date(Date.now() - 60_000),
      notAfterDate: new Date(Date.now() + 86400_000) });
  const ssoCertBody = ssoCert.cert.replace(/-----[^-]+-----|\s/g, '');
  const ssoMetadata = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://id.example.test/saml"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${ssoCertBody}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://id.example.test/login"/></IDPSSODescriptor></EntityDescriptor>`;
  assert.equal((await request('/api/access/sso/saml', 'PUT', undefined,
    { metadataXml: ssoMetadata })).status, 401);
  assert.equal((await request('/api/access/sso/saml', 'PUT', ownerToken,
    { metadataXml: ssoMetadata })).status, 200);
  assert.equal((await request('/api/access/sso/providers')).body.saml, true);
  const ssoStarted = await request('/api/access/sso/start', 'POST', undefined,
    { provider: 'saml', mode: 'login', origin });
  assert.equal(ssoStarted.status, 200, JSON.stringify(ssoStarted.body));
  assert.ok(ssoStarted.body.redirect.startsWith('https://id.example.test/login?'));
  const callback = await fetch(`http://localhost:${port}/api/access/sso/saml/callback`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://id.example.test', 'sec-fetch-site': 'cross-site' },
    body: new URLSearchParams({ SAMLResponse: Buffer.from('<invalid/>').toString('base64'),
      RelayState: ssoStarted.body.state }),
  });
  assert.equal(callback.status, 200);
  assert.match(callback.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.match(await callback.text(), /postMessage/);
  assert.equal((await request('/api/access/sso/saml', 'DELETE', ownerToken)).status, 200);
  assert.equal((await request('/api/audit/remote', 'GET', ownerToken)).body.target, null);
  const auditTarget = { bucket: 'locked-audit-bucket', region: 'us-east-1',
    prefix: 'sakura-test', retentionDays: 7,
    endpoint: `http://127.0.0.1:${auditS3Port}` };
  const auditConfigured = await request('/api/audit/remote', 'POST', ownerToken,
    { action: 'configure', target: auditTarget });
  assert.equal(auditConfigured.status, 200, JSON.stringify(auditConfigured.body));
  const auditSynced = await request('/api/audit/remote', 'POST', ownerToken,
    { action: 'sync' });
  assert.equal(auditSynced.status, 200, JSON.stringify(auditSynced.body));
  assert.ok(auditSynced.body.last.sequence > 0);
  assert.equal(auditObjects.size, 1);
  assert.equal((await request('/api/audit/remote', 'POST', ownerToken,
    { action: 'verify' })).status, 200);
  const viewer = await request('/api/access/users', 'POST', ownerToken, {
    username: 'reader', password: 'a long viewer password', vmIds: [vmId],
    expiresAt: Date.now() + 86_400_000,
  });
  assert.equal(viewer.status, 201, JSON.stringify(viewer.body));
  const loggedIn = await request('/api/access/login', 'POST', undefined,
    { username: 'reader', password: 'a long viewer password' });
  assert.equal(loggedIn.status, 200);
  let viewerToken = loggedIn.body.token as string;
  assert.equal((await request('/api/audit/remote', 'GET', viewerToken)).status, 403);
  const viewerHandoff = await request('/api/access/handoff', 'POST', viewerToken,
    { password: 'a long viewer password' });
  assert.equal(viewerHandoff.status, 200, JSON.stringify(viewerHandoff.body));
  const viewerMoved = await request('/api/access/handoff/redeem', 'POST', undefined,
    { code: viewerHandoff.body.code });
  assert.equal(viewerMoved.status, 200);
  assert.equal(viewerMoved.body.principal.role, 'viewer');
  assert.deepEqual(viewerMoved.body.principal.vmIds, [vmId]);
  assert.equal(viewerMoved.body.principal.expiresAt, loggedIn.body.principal.expiresAt);
  assert.equal((await request('/api/access/view', 'GET', viewerToken)).status, 401);
  viewerToken = viewerMoved.body.token;
  const inventory = await request('/api/access/view', 'GET', viewerToken);
  assert.equal(inventory.status, 200);
  assert.equal(inventory.body.vms.length, 1);
  assert.equal(inventory.body.vms[0].id, vmId);
  assert.equal(inventory.body.desktopAvailable, true);
  assert.ok(!JSON.stringify(inventory.body).includes('id_rsa'));
  for (const path of ['/api/vms', '/api/audit', '/api/graphql-schema'])
    assert.equal((await request(path, 'GET', viewerToken)).status, 403, path);
  assert.equal((await request('/api/vms/' + vmId + '/stop', 'POST', viewerToken, {})).status, 403);
  assert.equal(await wsStatus(viewerToken), 403);
  assert.equal(await wsStatus(viewerToken, '/ws/' + vmId + '/desktop-view'), 101);
  assert.equal(await wsStatus(viewerToken, '/ws/' + vmId + '/desktop'), 403);
  assert.equal(await wsStatus(viewerToken, '/ws/' + another.body.id + '/desktop-view'), 403);
  assert.equal(await wsStatus(ownerToken), 101);

  const member = await request('/api/access/members', 'POST', ownerToken,
    { username: 'developer', password: 'a long member password' });
  assert.equal(member.status, 201, JSON.stringify(member.body));
  const memberLogin = await request('/api/access/login', 'POST', undefined,
    { username: 'developer', password: 'a long member password' });
  assert.equal(memberLogin.status, 200, JSON.stringify(memberLogin.body));
  let memberToken = memberLogin.body.token as string;
  const projectPath = `/api/vms/${vmId}/project?project=default`;
  assert.equal((await request('/api/access/projects', 'GET', memberToken)).body.projects.length, 0);
  assert.equal((await request(projectPath, 'GET', memberToken)).status, 403);
  assert.equal((await request('/api/vms/' + vmId + '/project', 'GET', memberToken)).status, 400);
  assert.equal((await request('/api/vms', 'GET', memberToken)).status, 403);
  assert.equal((await request('/api/access/view', 'GET', memberToken)).status, 403);
  assert.equal((await request('/api/access/terminal-shares', 'GET', memberToken)).status, 403);
  assert.equal(await wsStatus(memberToken), 403);
  assert.equal((await request(projectPath, 'PUT', ownerToken,
    { directory: '/workspace/main' })).status, 200);
  const otherProject = await request(`/api/vms/${vmId}/projects`, 'POST', ownerToken,
    { action: 'create', name: 'other', config: { directory: '/workspace/other' } });
  assert.equal(otherProject.status, 200, JSON.stringify(otherProject.body));
  const otherProjectId = otherProject.body.active as string;
  assert.notEqual(otherProjectId, 'default');
  const originalPolicy = await request('/api/access/project-permissions' +
    `?vmId=${vmId}&projectId=default`, 'GET', ownerToken);
  assert.equal(originalPolicy.status, 200);
  assert.equal(originalPolicy.body.grants.length, 0);
  const policyPath = `/api/access/project-permissions?vmId=${vmId}&projectId=default`;
  const roles = [{ id: 'developer', name: 'Developer', permissions: ['read', 'write'] }];
  assert.equal((await request(`/api/vms/${vmId}/project?project=${otherProjectId}`, 'PUT', ownerToken,
    { directory: '/workspace/main/nested' })).status, 200);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: member.body.id, roleId: 'developer' }] })).status, 409);
  assert.equal((await request(`/api/vms/${vmId}/project?project=${otherProjectId}`, 'PUT', ownerToken,
    { directory: '/workspace/other' })).status, 200);
  assert.equal((await request(projectPath, 'GET', ownerToken)).body.project.directory, '/workspace/main');
  assert.equal((await request(`/api/vms/${vmId}/project?project=${otherProjectId}`,
    'GET', ownerToken)).body.project.directory, '/workspace/other');
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: member.body.id, roleId: 'missing' }] })).status, 400);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: viewer.body.id, roleId: 'developer' }] })).status, 409);
  const grantedPolicy = await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: member.body.id, roleId: 'developer' }] });
  assert.equal(grantedPolicy.status, 200, JSON.stringify(grantedPolicy.body));
  const policyKeys = await request('/api/access/policy-bundles/keys', 'GET', ownerToken);
  assert.equal(policyKeys.status, 200, JSON.stringify(policyKeys.body));
  assert.equal(policyKeys.body.trustedKeys.length, 1);
  assert.ok(!JSON.stringify(policyKeys.body).includes('PRIVATE KEY'));
  assert.equal((await request('/api/access/policy-bundles/keys', 'GET', memberToken)).status, 403);
  assert.equal((await request('/api/access/policy-bundles/export', 'POST', viewerToken,
    { vmId, projectId: 'default' })).status, 403);
  const exportedPolicy = await request('/api/access/policy-bundles/export', 'POST', ownerToken,
    { vmId, projectId: 'default' });
  assert.equal(exportedPolicy.status, 200, JSON.stringify(exportedPolicy.body));
  assert.deepEqual(exportedPolicy.body.bundle.policy.roles, roles);
  assert.equal(exportedPolicy.body.bundle.signature.algorithm, 'Ed25519');
  assert.ok(!JSON.stringify(exportedPolicy.body).includes('PRIVATE KEY'));
  const target = { vmId, projectId: 'default' };
  const policyPreview = await request('/api/access/policy-bundles/preview', 'POST',
    ownerToken, { bundle: exportedPolicy.body.bundle, target });
  assert.equal(policyPreview.status, 200, JSON.stringify(policyPreview.body));
  assert.equal(policyPreview.body.trusted, true);
  assert.equal(policyPreview.body.expectedVersion, grantedPolicy.body.version);
  assert.equal((await request('/api/access/policy-bundles/preview', 'POST', ownerToken,
    { bundle: { ...exportedPolicy.body.bundle,
      policy: { ...exportedPolicy.body.bundle.policy, approvalRequired: true } },
    target })).status, 400, 'Changing a signed policy must invalidate its signature');
  const foreignKeys = generateKeyPairSync('ed25519');
  const foreignUnsigned = { format: exportedPolicy.body.bundle.format,
    source: exportedPolicy.body.bundle.source, policy: exportedPolicy.body.bundle.policy };
  const foreignPublicKey = foreignKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const foreignBundle = { ...foreignUnsigned,
    signature: { algorithm: 'Ed25519', publicKey: foreignPublicKey,
      value: sign(null, Buffer.from('SAKURA01:project-policy-ed25519:v1\n' +
        canonical(foreignUnsigned)), foreignKeys.privateKey).toString('base64') } };
  const foreignPreview = await request('/api/access/policy-bundles/preview',
    'POST', ownerToken, { bundle: foreignBundle, target });
  assert.equal(foreignPreview.status, 200, JSON.stringify(foreignPreview.body));
  assert.equal(foreignPreview.body.trusted, false);
  assert.equal((await request('/api/access/policy-bundles/apply', 'POST', ownerToken,
    { bundle: foreignBundle, target,
      expectedVersion: foreignPreview.body.expectedVersion })).status, 403);
  const trustedPolicyKey = await request('/api/access/policy-bundles/keys', 'POST', ownerToken,
    { action: 'trust', revision: policyKeys.body.revision,
      name: 'External policy signer', publicKey: foreignPublicKey });
  assert.equal(trustedPolicyKey.status, 200, JSON.stringify(trustedPolicyKey.body));
  assert.equal(trustedPolicyKey.body.trustedKeys.length, 2);
  assert.equal((await request('/api/access/policy-bundles/keys', 'POST', ownerToken,
    { action: 'forget', revision: trustedPolicyKey.body.revision,
      fingerprint: policyKeys.body.localKey.fingerprint })).status, 409);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles: [
    { ...roles[0], name: 'Temporary role name' }],
    grants: [{ accountId: member.body.id, roleId: 'developer' }] })).status, 200);
  assert.equal((await request('/api/access/policy-bundles/apply', 'POST', ownerToken,
    { bundle: foreignBundle, target,
      expectedVersion: foreignPreview.body.expectedVersion })).status, 409,
    'A changed target policy invalidates a previously previewed version');
  const freshPreview = await request('/api/access/policy-bundles/preview',
    'POST', ownerToken, { bundle: foreignBundle, target });
  assert.equal(freshPreview.status, 200);
  const restoredPolicy = await request('/api/access/policy-bundles/apply',
    'POST', ownerToken, { bundle: foreignBundle, target,
      expectedVersion: freshPreview.body.expectedVersion });
  assert.equal(restoredPolicy.status, 200, JSON.stringify(restoredPolicy.body));
  assert.deepEqual((await request(policyPath, 'GET', ownerToken)).body.roles, roles);
  assert.equal((await request('/api/access/policy-bundles/apply', 'POST', ownerToken,
    { bundle: foreignBundle, target,
      expectedVersion: freshPreview.body.expectedVersion })).status, 409);
  const forgottenPolicyKey = await request('/api/access/policy-bundles/keys',
    'POST', ownerToken, { action: 'forget', revision: trustedPolicyKey.body.revision,
      fingerprint: foreignPreview.body.signer });
  assert.equal(forgottenPolicyKey.status, 200);
  assert.equal((await request('/api/access/policy-bundles/apply', 'POST', ownerToken,
    { bundle: foreignBundle, target,
      expectedVersion: restoredPolicy.body.policy.version })).status, 403);
  const assigned = (await request('/api/access/projects', 'GET', memberToken)).body.projects;
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].projectId, 'default');
  assert.equal((await request(`/api/vms/${vmId}/project?project=${otherProjectId}`, 'PUT', ownerToken,
    { directory: '/workspace/main/nested' })).status, 200);
  assert.equal((await request(projectPath, 'GET', memberToken)).status, 409);
  assert.equal((await request('/api/access/projects', 'GET', memberToken)).body.projects.length, 0);
  assert.equal((await request(`/api/vms/${vmId}/project?project=${otherProjectId}`, 'PUT', ownerToken,
    { directory: '/workspace/other' })).status, 200);
  const memberRead = await request(projectPath, 'GET', memberToken);
  assert.equal(memberRead.status, 200, JSON.stringify(memberRead.body));
  assert.equal((await request(projectPath, 'PUT', memberToken,
    { ...memberRead.body.project, directory: '/workspace/other' })).status, 403);
  assert.equal((await request(projectPath, 'PUT', memberToken, memberRead.body.project)).status, 200);
  assert.equal((await request(projectPath, 'GET', memberToken)).body.project.directory,
    memberRead.body.project.directory);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: member.body.id, roleId: 'developer' }],
    approvalRequired: true })).status, 200);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: member.body.id, roleId: 'developer' }] })).body.approvalRequired, true);
  assert.equal((await request(projectPath, 'PUT', memberToken, memberRead.body.project)).status, 409);
  assert.equal((await request(projectPath, 'PUT', ownerToken, memberRead.body.project)).status, 409);
  const changedProject = { ...memberRead.body.project, command: 'printf approved-change' };
  assert.equal((await request('/api/access/changes', 'POST', memberToken,
    { vmId, projectId: 'default', summary: 'Wrong base version',
      project: changedProject, expectedVersion: '0'.repeat(64) })).status, 409);
  const proposed = await request('/api/access/changes', 'POST', memberToken,
    { vmId, projectId: 'default', summary: 'Review the project start command',
      project: changedProject, expectedVersion: memberRead.body.version });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.body));
  assert.equal((await request('/api/access/changes', 'GET', memberToken)).body.changes[0].id,
    proposed.body.id);
  assert.equal((await request(`/api/access/changes/${proposed.body.id}/decision`,
    'POST', memberToken, { decision: 'approve' })).status, 403);
  assert.equal((await request(`/api/access/changes/${proposed.body.id}/decision`,
    'POST', viewerToken, { decision: 'approve' })).status, 403);
  const approvalBrowser = await chromium.launch();
  try {
    const approvalPage = await approvalBrowser.newPage();
    await approvalPage.goto(origin);
    await approvalPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await approvalPage.getByLabel('密码').fill(password);
    await approvalPage.getByRole('button', { name: '登录', exact: true }).click();
    await approvalPage.getByRole('button', { name: '系统设置', exact: true }).click();
    await approvalPage.getByRole('button', { name: '提交管理员变更审批' }).waitFor();
    const remoteAuditPanel = approvalPage.getByRole('region', { name: '远程不可变审计' });
    await remoteAuditPanel.getByText(/远端锚点：第/).waitFor();
    await remoteAuditPanel.getByRole('button', { name: '校验远端版本' }).click();
    await remoteAuditPanel.getByText('远程锚点与本地审计链校验通过').waitFor();
    const policyBundlePanel = approvalPage.getByRole('region', { name: '签名项目策略包' });
    await policyBundlePanel.getByRole('button', { name: '导出签名策略包' }).click();
    await policyBundlePanel.getByText('当前项目策略已签名，可复制或下载').waitFor();
    assert.match(await policyBundlePanel.getByLabel('导出的策略包 JSON').inputValue(),
      /"signature"/);
    await policyBundlePanel.getByLabel('导入策略包 JSON')
      .fill(JSON.stringify(exportedPolicy.body.bundle));
    await policyBundlePanel.getByRole('button', { name: '验证并预览' }).click();
    await policyBundlePanel.getByText('签名已验证，请审阅当前策略和拟应用策略').waitFor();
    await policyBundlePanel.getByLabel('已审阅完整策略、成员授权与审批要求').check();
    assert.equal(await policyBundlePanel.getByRole('button', { name: '应用签名策略包' })
      .isEnabled(), true);
    const changePanel = approvalPage.getByRole('region', { name: '项目变更审批' });
    const proposal = changePanel.locator('article').filter({ hasText: 'Review the project start command' });
    await proposal.getByText('Review the project start command').waitFor();
    await proposal.getByText('查看完整项目配置与基线版本').click();
    await proposal.getByLabel('已审阅完整配置').check();
    await proposal.getByRole('button', { name: '批准' }).click();
    await changePanel.getByText('变更已批准').waitFor();
    await approvalPage.setViewportSize({ width: 390, height: 844 });
    const ownerOverflow = await approvalPage.evaluate(() => [...document.querySelectorAll('*')]
      .filter((element) => element.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 12).map((element) => ({ tag: element.tagName,
        className: element.className, width: Math.round(element.getBoundingClientRect().width),
        right: Math.round(element.getBoundingClientRect().right) })));
    assert.equal(await approvalPage.evaluate(() => document.documentElement.scrollWidth), 390,
      JSON.stringify(ownerOverflow));
  } finally { await approvalBrowser.close(); }
  assert.equal((await request('/api/access/changes', 'GET', ownerToken)).body.changes
    .find((item: { id: string }) => item.id === proposed.body.id).status, 'approved');
  assert.equal((await request(`/api/access/changes/${proposed.body.id}/apply`,
    'POST', ownerToken, {})).status, 403);
  const appliedChange = await request(`/api/access/changes/${proposed.body.id}/apply`,
    'POST', memberToken, {});
  assert.equal(appliedChange.status, 200, JSON.stringify(appliedChange.body));
  assert.equal(appliedChange.body.status, 'applied');
  assert.equal((await request(projectPath, 'GET', memberToken)).body.project.command,
    'printf approved-change');
  assert.equal((await request(`/api/access/changes/${proposed.body.id}/apply`,
    'POST', memberToken, {})).status, 409);
  const reviewer = await request('/api/access/members', 'POST', ownerToken,
    { username: 'reviewer', password: 'a second member password' });
  assert.equal(reviewer.status, 201);
  const reviewerRole = { id: 'reviewer', name: 'Reviewer', permissions: ['read', 'approve'] };
  const approvalRoles = [...roles, reviewerRole];
  const approvalGrants = [
    { accountId: member.body.id, roleId: 'developer' },
    { accountId: reviewer.body.id, roleId: 'reviewer' },
  ];
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles: approvalRoles,
    grants: approvalGrants, approvalRequired: true })).status, 200);
  const reviewerLogin = await request('/api/access/login', 'POST', undefined,
    { username: 'reviewer', password: 'a second member password' });
  assert.equal(reviewerLogin.status, 200);
  const reviewerToken = reviewerLogin.body.token as string;
  assert.equal((await request(projectPath, 'PUT', reviewerToken, changedProject)).status, 403);
  const ownerCurrent = await request(projectPath, 'GET', ownerToken);
  const ownerChange = await request('/api/access/changes', 'POST', ownerToken,
    { vmId, projectId: 'default', summary: 'Owner request for second review',
      project: { ...ownerCurrent.body.project, command: 'printf owner-approved' },
      expectedVersion: ownerCurrent.body.version });
  assert.equal(ownerChange.status, 201, JSON.stringify(ownerChange.body));
  assert.equal((await request(`/api/access/changes/${ownerChange.body.id}/decision`,
    'POST', ownerToken, { decision: 'approve' })).status, 403);
  assert.ok((await request('/api/access/changes', 'GET', reviewerToken)).body.changes
    .some((item: { id: string }) => item.id === ownerChange.body.id));
  const reviewerBrowser = await chromium.launch();
  try {
    const reviewerPage = await reviewerBrowser.newPage();
    await reviewerPage.goto(origin);
    await reviewerPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await reviewerPage.getByLabel('账户名').fill('reviewer');
    await reviewerPage.getByLabel('密码').fill('a second member password');
    await reviewerPage.getByRole('button', { name: '登录', exact: true }).click();
    assert.equal(await reviewerPage.getByRole('button', { name: '保存项目配置' }).count(), 0);
    const changePanel = reviewerPage.getByRole('region', { name: '项目变更审批' });
    const proposal = changePanel.locator('article').filter({ hasText: 'Owner request for second review' });
    await proposal.getByText('Owner request for second review').waitFor();
    await proposal.getByText('查看完整项目配置与基线版本').click();
    await proposal.getByLabel('已审阅完整配置').check();
    await proposal.getByRole('button', { name: '批准' }).click();
    await changePanel.getByText('变更已批准').waitFor();
    await reviewerPage.setViewportSize({ width: 390, height: 844 });
    assert.ok(await reviewerPage.evaluate(() => document.documentElement.scrollWidth <= 390));
  } finally { await reviewerBrowser.close(); }
  assert.equal((await request(`/api/access/changes/${ownerChange.body.id}/apply`,
    'POST', ownerToken, {})).status, 200);
  assert.equal((await request(projectPath, 'GET', ownerToken)).body.project.command,
    'printf owner-approved');
  const staleBase = await request(projectPath, 'GET', memberToken);
  const staleChange = await request('/api/access/changes', 'POST', memberToken,
    { vmId, projectId: 'default', summary: 'Reject a stale approved change',
      project: { ...staleBase.body.project, command: 'printf stale-change' },
      expectedVersion: staleBase.body.version });
  assert.equal(staleChange.status, 201);
  assert.equal((await request(`/api/access/changes/${staleChange.body.id}/decision`,
    'POST', reviewerToken, { decision: 'approve' })).status, 200);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles: approvalRoles,
    grants: approvalGrants, approvalRequired: false })).status, 200);
  assert.equal((await request(projectPath, 'PUT', ownerToken,
    { ...staleBase.body.project, command: 'printf newer-change' })).status, 200);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles: approvalRoles,
    grants: approvalGrants, approvalRequired: true })).status, 200);
  assert.equal((await request(`/api/access/changes/${staleChange.body.id}/apply`,
    'POST', memberToken, {})).status, 409);
  assert.equal((await request(projectPath, 'GET', ownerToken)).body.project.command,
    'printf newer-change');
  assert.equal((await request('/api/access/changes', 'GET', ownerToken)).body.changes
    .find((item: { id: string }) => item.id === staleChange.body.id).status, 'failed');
  const revokedBase = await request(projectPath, 'GET', memberToken);
  const revokedChange = await request('/api/access/changes', 'POST', memberToken,
    { vmId, projectId: 'default', summary: 'Reject revoked second approval',
      project: { ...revokedBase.body.project, command: 'printf revoked-change' },
      expectedVersion: revokedBase.body.version });
  assert.equal(revokedChange.status, 201);
  assert.equal((await request(`/api/access/changes/${revokedChange.body.id}/decision`,
    'POST', reviewerToken, { decision: 'approve' })).status, 200);
  assert.equal((await request('/api/access/members/' + reviewer.body.id,
    'DELETE', ownerToken)).status, 200);
  assert.equal((await request('/api/access/changes', 'GET', reviewerToken)).status, 401);
  assert.equal((await request(`/api/access/changes/${revokedChange.body.id}/apply`,
    'POST', memberToken, {})).status, 409);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: member.body.id, roleId: 'developer' }],
    approvalRequired: false })).status, 200);
  const memberBrowser = await chromium.launch();
  try {
    const memberPage = await memberBrowser.newPage();
    await memberPage.goto(origin);
    await memberPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await memberPage.getByLabel('账户名').fill('developer');
    await memberPage.getByLabel('密码').fill('a long member password');
    await memberPage.getByRole('button', { name: '登录', exact: true }).click();
    await memberPage.getByRole('heading', { name: 'Sakura · 项目成员' }).waitFor();
    assert.equal(await memberPage.locator('select').first().inputValue(), `${vmId}:default`);
    assert.equal(await memberPage.getByLabel('项目配置').isEditable(), true);
    await memberPage.getByRole('button', { name: '保存项目配置' }).click();
    await memberPage.getByText('项目配置已保存').waitFor();
    await memberPage.close();
  } finally { await memberBrowser.close(); }
  assert.equal((await request(projectPath, 'POST', memberToken, { action: 'stop' })).status, 403);
  assert.equal((await request(`/api/vms/${vmId}/project?project=${otherProjectId}`,
    'GET', memberToken)).status, 403);
  assert.equal((await request(`/api/vms/${another.body.id}/project?project=default`,
    'GET', memberToken)).status, 403);
  assert.equal((await request(`/api/vms/${vmId}/projects`, 'GET', memberToken)).status, 403);
  assert.equal((await request(`/api/vms/${vmId}/git?project=default`, 'GET', memberToken)).status, 403);
  assert.equal((await request(policyPath, 'PUT', memberToken, { roles, grants: [] })).status, 403);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles: [
    { ...roles[0], permissions: ['read', 'write', 'execute'] }],
    grants: [{ accountId: member.body.id, roleId: 'developer' }] })).status, 200);
  assert.equal((await request(projectPath, 'POST', memberToken, { action: 'stop' })).status, 409,
    'Execution permission reaches the stopped-VM precondition');
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles, grants: [] })).status, 200);
  assert.equal((await request(projectPath, 'GET', memberToken)).status, 403);
  assert.equal((await request(policyPath, 'PUT', ownerToken, { roles,
    grants: [{ accountId: member.body.id, roleId: 'developer' }] })).status, 200);

  assert.equal((await request('/api/access/sso/saml', 'PUT', ownerToken,
    { metadataXml: ssoMetadata })).status, 200);
  const signedSamlResponse = (requestId: string) => {
    const issued = new Date().toISOString();
    const before = new Date(Date.now() - 60_000).toISOString();
    const after = new Date(Date.now() + 5 * 60_000).toISOString();
    const acs = `http://localhost:${port}/api/access/sso/saml/callback`;
    const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_response" Version="2.0" IssueInstant="${issued}" Destination="${acs}" InResponseTo="${requestId}"><saml:Issuer>https://id.example.test/saml</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assertion" Version="2.0" IssueInstant="${issued}"><saml:Issuer>https://id.example.test/saml</saml:Issuer><saml:Subject><saml:NameID>smoke-owner</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" Recipient="${acs}" NotOnOrAfter="${after}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${before}" NotOnOrAfter="${after}"><saml:AudienceRestriction><saml:Audience>urn:sakura:localhost:${port}</saml:Audience></saml:AudienceRestriction></saml:Conditions></saml:Assertion></samlp:Response>`;
    const signer = new SignedXml({ privateKey: ssoCert.private, publicCert: ssoCert.cert,
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
    signer.addReference({ xpath: "/*[local-name()='Response']",
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#'] });
    signer.computeSignature(xml, { location: { reference:
      "/*[local-name()='Response']/*[local-name()='Issuer']", action: 'after' } });
    return Buffer.from(signer.getSignedXml()).toString('base64');
  };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // The fixture VM is stopped; present it as running to exercise the view-only UI path.
    await page.route('**/api/access/view', async (route) => {
      const response = await route.fetch();
      const result = await response.json();
      return route.fulfill({ response, json: { ...result,
        vms: result.vms.map((vm: { status: string }) => ({ ...vm, status: 'running' })) } });
    });
    await page.goto(origin);
    await page.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await page.getByLabel('账户名').fill('reader');
    await page.getByLabel('密码').fill('a long viewer password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '已授权实例' }).waitFor();
    await page.getByText('access-fixture').first().waitFor();
    assert.equal(await page.getByText('终端', { exact: true }).count(), 0);
    const desktopSocket = page.waitForEvent('websocket', {
      predicate: (socket) => socket.url().includes('/ws/' + vmId + '/desktop-view?'),
    });
    await page.getByRole('button', { name: '只读查看桌面' }).click();
    await desktopSocket;
    await page.getByRole('heading', { name: '只读桌面视图' }).waitFor();
    await page.getByRole('button', { name: '关闭桌面视图' }).click();
    const jitForm = page.getByRole('region', { name: '临时操作授权' });
    await jitForm.getByLabel('实例').selectOption({ label: 'access-fixture' });
    await jitForm.getByLabel('原因').fill('Need the shared terminal for a review');
    await jitForm.getByRole('button', { name: '提交申请' }).click();
    await jitForm.getByText('申请已提交').waitFor();
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.getByRole('heading', { name: '登录 Sakura' }).waitFor();

    const passkeyPage = await browser.newPage();
    await passkeyPage.context().route(/^https:\/\/id\.example\.test\/login\?/, async (route) => {
      const target = new URL(route.request().url());
      const requestXml = inflateRawSync(Buffer.from(target.searchParams.get('SAMLRequest')!,
        'base64')).toString('utf8');
      const requestId = /\bID="([^"]+)"/.exec(requestXml)?.[1];
      assert.ok(requestId);
      const state = target.searchParams.get('RelayState');
      assert.ok(state);
      await route.fulfill({ contentType: 'text/html', body:
        `<form method="post" action="http://localhost:${port}/api/access/sso/saml/callback"><input name="SAMLResponse" value="${signedSamlResponse(requestId)}"><input name="RelayState" value="${state}"></form><script>document.forms[0].submit()</script>` });
    });
    const cdp = await passkeyPage.context().newCDPSession(passkeyPage);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true,
    } });
    assert.equal((await request('/api/access/passkeys/login/options', 'POST', undefined, {})).status, 400);
    await passkeyPage.goto(passkeyOrigin);
    await passkeyPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    assert.equal(await passkeyPage.getByLabel('账户名').inputValue(), 'owner');
    await passkeyPage.getByLabel('密码').fill(password);
    const ownerBrowserLogin = passkeyPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/login'));
    await passkeyPage.getByRole('button', { name: '登录', exact: true }).click();
    const ownerBrowserResponse = await ownerBrowserLogin;
    assert.equal(ownerBrowserResponse.status(), 200, await ownerBrowserResponse.text());
    const ownerBrowserData = await ownerBrowserResponse.json();
    assert.equal(ownerBrowserData.principal.role, 'owner');
    assert.equal(ownerBrowserData.token.length, 64);
    await passkeyPage.getByRole('button', { name: '系统设置', exact: true }).waitFor({ timeout: 8000 })
      .catch(async () => { throw new Error('Owner browser login failed: ' +
        await passkeyPage.locator('body').innerText()); });
    await passkeyPage.getByRole('button', { name: '系统设置', exact: true }).click();
    await passkeyPage.getByRole('region', { name: '项目权限管理' }).waitFor();
    const ssoLinks = passkeyPage.getByRole('region', { name: '单点登录身份' });
    await ssoLinks.getByRole('button', { name: '绑定身份' }).click();
    await ssoLinks.getByText('外部身份已绑定').waitFor();
    await passkeyPage.getByRole('button', { name: 'owner · 退出' }).click();
    await passkeyPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await passkeyPage.getByRole('button', { name: '使用 SAML 登录' }).click();
    await passkeyPage.getByRole('button', { name: 'owner · 退出' }).waitFor();
    await passkeyPage.getByRole('button', { name: '系统设置', exact: true }).click();
    const jitApprovals = passkeyPage.getByRole('region', { name: '临时授权审批' });
    await jitApprovals.getByText('Need the shared terminal for a review').waitFor();
    await jitApprovals.getByRole('button', { name: '批准' }).click();
    await jitApprovals.getByText('已批准临时操作').waitFor();
    const manager = passkeyPage.getByRole('region', { name: '通行密钥管理' });
    await manager.getByLabel('通行密钥名称').fill('local-key');
    await manager.getByLabel('当前账户密码').fill(password);
    const registrationVerify = passkeyPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/passkeys/register/verify'));
    await manager.getByRole('button', { name: '登记通行密钥' }).click();
    await manager.getByText('通行密钥已登记').waitFor();
    const registered = await registrationVerify;
    assert.equal(registered.status(), 201);
    const currentOwnerToken = registered.request().headers()['x-sakura-token'];
    assert.ok(currentOwnerToken);
    assert.equal((await request('/api/access/passkeys/register/verify', 'POST',
      currentOwnerToken, registered.request().postDataJSON(), passkeyOrigin)).status, 409);
    const savedKeys = (await request('/api/access/passkeys', 'GET', ownerToken)).body.passkeys;
    assert.equal(savedKeys.length, 1);
    assert.equal(savedKeys[0].name, 'local-key');
    assert.ok(!JSON.stringify(savedKeys).includes('publicKey'));
    await passkeyPage.getByRole('button', { name: 'owner · 退出' }).click();
    await passkeyPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    const loginVerify = passkeyPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/passkeys/login/verify'));
    await passkeyPage.getByRole('button', { name: '使用通行密钥登录' }).click();
    await passkeyPage.getByRole('button', { name: 'owner · 退出' }).waitFor();
    const verified = await loginVerify;
    assert.equal(verified.status(), 200);
    const passkeyLogin = await verified.json();
    assert.equal((await request('/api/vms', 'GET', passkeyLogin.token)).status, 200);
    assert.equal((await request('/api/access/passkeys/login/verify', 'POST', undefined,
      verified.request().postDataJSON(), passkeyOrigin)).status, 409);
    assert.equal((await request('/api/access/passkeys/' + savedKeys[0].id, 'DELETE', ownerToken,
      { password: 'incorrect' })).status, 403);
    assert.equal((await request('/api/access/passkeys/' + savedKeys[0].id, 'DELETE', ownerToken,
      { password })).status, 200);
    assert.equal((await request('/api/vms', 'GET', passkeyLogin.token)).status, 401);
    assert.equal((await request('/api/access/passkeys', 'GET', ownerToken)).body.passkeys.length, 0);
    await passkeyPage.close();

    assert.equal((await request('/api/access/handoff', 'POST', ownerToken,
      { password: 'incorrect' })).status, 403);
    const sourcePage = await browser.newPage();
    await sourcePage.goto(origin);
    await sourcePage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await sourcePage.getByLabel('密码').fill(password);
    const sourceLoginResponse = sourcePage.waitForResponse((response) =>
      response.url().endsWith('/api/access/login'));
    await sourcePage.getByRole('button', { name: '登录', exact: true }).click();
    const sourceLogin = await (await sourceLoginResponse).json();
    await sourcePage.getByRole('button', { name: '系统设置', exact: true }).click();
    const handoffManager = sourcePage.getByRole('region', { name: '会话交接' });
    await handoffManager.getByLabel('当前账户密码').fill(password);
    await handoffManager.getByRole('button', { name: '生成交接码' }).click();
    const handoffCode = await handoffManager.getByRole('status').locator('code').innerText();
    assert.match(handoffCode, /^[A-Za-z0-9_-]{24}$/);
    const targetPage = await browser.newPage();
    await targetPage.goto(origin);
    await targetPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await targetPage.getByLabel('会话交接码').fill(handoffCode);
    const redeemResponse = targetPage.waitForResponse((response) =>
      response.url().endsWith('/api/access/handoff/redeem'));
    await targetPage.getByRole('button', { name: '接收会话' }).click();
    await targetPage.getByRole('button', { name: '系统设置', exact: true }).waitFor();
    const moved = await (await redeemResponse).json();
    assert.equal(moved.principal.role, 'owner');
    assert.equal((await request('/api/vms', 'GET', sourceLogin.token)).status, 401);
    assert.equal((await request('/api/vms', 'GET', moved.token)).status, 200);
    assert.equal((await request('/api/access/handoff/redeem', 'POST', undefined,
      { code: handoffCode })).status, 403);
    await sourcePage.close();
    await targetPage.close();
  } finally { await browser.close(); }

  const invalidJit = await request('/api/access/jit', 'POST', viewerToken,
    { vmId: another.body.id, operation: 'start', reason: 'Need a temporary boot' });
  assert.equal(invalidJit.status, 403);
  const applied = (await request('/api/access/jit', 'GET', viewerToken)).body.requests[0];
  assert.equal(applied.status, 'approved');
  assert.equal((await request('/api/access/jit/' + applied.id + '/decision',
    'POST', viewerToken, { decision: 'approve', minutes: 15 })).status, 403);
  assert.equal((await request('/api/access/jit/' + applied.id + '/decision',
    'POST', ownerToken, { decision: 'approve', minutes: 15 })).status, 409);
  const boot = await request('/api/access/jit/' + applied.id + '/execute',
    'POST', viewerToken, {});
  assert.equal(boot.status, 200, JSON.stringify(boot.body));
  assert.equal(boot.body.status, 'completed');
  assert.equal((await request('/api/access/jit/' + applied.id + '/execute',
    'POST', viewerToken, {})).status, 409);
  assert.equal((await request('/api/vms/' + vmId + '/stop', 'POST', viewerToken, {})).status, 403);
  const bootDeadline = Date.now() + 90_000;
  while ((await request('/api/vms/' + vmId, 'GET', ownerToken)).body.status !== 'running') {
    assert.ok(Date.now() < bootDeadline, '共享终端测试实例启动超时');
    await delay(250);
  }
  const guest = async (command: string) => {
    const result = await request('/api/vms/' + vmId + '/exec', 'POST', ownerToken,
      { command }, origin, 45_000);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body as { stdout: string; stderr: string; code: number };
  };
  assert.equal((await guest('mkdir -p /workspace/main; printf project-only > /workspace/main/sample.txt')).code, 0);
  const searched = await request(`/api/vms/${vmId}/project-files?project=default&q=sample`,
    'GET', memberToken);
  assert.equal(searched.status, 200, JSON.stringify(searched.body));
  assert.ok(searched.body.files.some((item: { path: string }) => item.path === 'sample.txt'));
  assert.equal((await request(`/api/vms/${vmId}/project-files?project=${otherProjectId}&q=sample`,
    'GET', memberToken)).status, 403);
  if ((await guest('command -v tmux >/dev/null')).code !== 0)
    assert.equal((await guest('apk add --no-cache tmux')).code, 0);
  assert.equal((await guest('tmux new-session -d -s sakura-terminal-sharetest')).code, 0);
  const shared = await request('/api/access/terminal-shares', 'POST', ownerToken,
    { vmId, viewerId: viewer.body.id, session: 'sharetest', minutes: 5 });
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  assert.equal((await request('/api/access/terminal-shares', 'GET', viewerToken)).body.grants[0].id,
    shared.body.id);
  const sharedBrowser = await chromium.launch();
  try {
    const ownerSharePage = await sharedBrowser.newPage();
    await ownerSharePage.goto(origin);
    await ownerSharePage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await ownerSharePage.getByLabel('密码').fill(password);
    await ownerSharePage.getByRole('button', { name: '登录', exact: true }).click();
    await ownerSharePage.getByRole('tab', { name: '终端', exact: true }).click();
    const shareControls = ownerSharePage.getByRole('region', { name: '共享终端管理' });
    await shareControls.waitFor();
    await shareControls.getByLabel('只读账户').selectOption({ label: 'reader' });
    assert.equal(await shareControls.getByRole('button', { name: '共享', exact: true }).isEnabled(), true);
    await ownerSharePage.close();
    const sharedPage = await sharedBrowser.newPage();
    await sharedPage.goto(origin);
    await sharedPage.getByRole('heading', { name: '登录 Sakura' }).waitFor();
    await sharedPage.getByLabel('账户名').fill('reader');
    await sharedPage.getByLabel('密码').fill('a long viewer password');
    await sharedPage.getByRole('button', { name: '登录', exact: true }).click();
    await sharedPage.getByRole('button', { name: '只读查看终端' }).waitFor();
    await sharedPage.getByRole('button', { name: '只读查看终端' }).click();
    await sharedPage.getByRole('region', { name: '只读终端视图' }).waitFor();
    await sharedPage.getByText('终端视图已连接', { exact: false }).waitFor();
  } finally { await sharedBrowser.close(); }
  const terminalUrl = origin.replace('http:', 'ws:') + '/ws/' + vmId +
    '/terminal-view?session=sharetest&token=' + viewerToken;
  const openTerminal = async () => {
    const socket = new WebSocket(terminalUrl, { handshakeTimeout: 5000 });
    const messages: { type: string; data: unknown }[] = [];
    socket.on('message', (raw) => { messages.push(JSON.parse(raw.toString())); });
    await new Promise<void>((done, fail) => {
      socket.once('open', () => done()); socket.once('error', fail);
    });
    const deadline = Date.now() + 10_000;
    while (!messages.some((item) => item.type === 'ready') && Date.now() < deadline)
      await delay(100);
    assert.ok(messages.some((item) => item.type === 'ready'), JSON.stringify(messages));
    return { socket, messages };
  };
  const viewed = await openTerminal();
  assert.equal((await guest("tmux send-keys -t =sakura-terminal-sharetest:0 'printf shared-terminal-ws' Enter")).code, 0);
  const outputDeadline = Date.now() + 10_000;
  while (!viewed.messages.some((item) => item.type === 'data' &&
      String(item.data).includes('shared-terminal-ws')) && Date.now() < outputDeadline)
    await delay(100);
  assert.ok(viewed.messages.some((item) => item.type === 'data' &&
    String(item.data).includes('shared-terminal-ws')));
  const rejectedInput = new Promise<number>((done) => viewed.socket.once('close', (code) => done(code)));
  viewed.socket.send(JSON.stringify({ type: 'input', data: 'touch /tmp/share-violation\n' }));
  assert.equal(await rejectedInput, 1008);
  assert.equal((await guest('test ! -e /tmp/share-violation')).code, 0);
  const reopened = await openTerminal();
  const shortenedSocket = new Promise<void>((done) => reopened.socket.once('close', () => done()));
  const shortened = await request('/api/access/terminal-shares', 'POST', ownerToken,
    { vmId, viewerId: viewer.body.id, session: 'sharetest', minutes: 1 });
  assert.equal(shortened.status, 201);
  assert.equal(shortened.body.id, shared.body.id);
  await shortenedSocket;
  const afterShortening = await openTerminal();
  const revokedSocket = new Promise<void>((done) => afterShortening.socket.once('close', () => done()));
  assert.equal((await request('/api/access/terminal-shares/' + shared.body.id,
    'DELETE', ownerToken)).status, 200);
  await revokedSocket;
  assert.equal((await request('/api/access/terminal-shares', 'GET', viewerToken)).body.grants.length, 0);
  assert.equal(await wsStatus(viewerToken, '/ws/' + vmId + '/terminal-view?session=sharetest'), 403);

  assert.equal((await request('/api/access/users/' + viewer.body.id, 'DELETE', ownerToken)).status, 200);
  assert.equal((await request('/api/access/view', 'GET', viewerToken)).status, 401);
  assert.equal((await request('/api/access/login', 'POST', undefined,
    { username: 'reader', password: 'a long viewer password' })).status, 403);
  const audit = await request('/api/audit', 'GET', ownerToken);
  assert.equal(audit.status, 200);
  assert.ok(JSON.stringify(audit.body).includes(owner.body.principal.id));
  const lockPassword = 'a separate control lock password';
  assert.equal((await request('/api/session/settings', 'PATCH', ownerToken,
    { enabled: true, idleMinutes: 15, password: '', newPassword: lockPassword })).status, 200);
  assert.equal((await request('/api/session/lock', 'POST', ownerToken, {})).status, 200);
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 423);
  assert.equal((await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password })).status, 423);
  assert.equal((await request('/api/session/unlock', 'POST', undefined,
    { password: lockPassword })).status, 200);
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 401);
  const afterLock = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password });
  assert.equal(afterLock.status, 200);
  const newPassword = 'a different administrator password';
  assert.equal((await request('/api/access/password', 'POST', afterLock.body.token,
    { password, newPassword })).status, 200);
  assert.equal((await request('/api/vms', 'GET', afterLock.body.token)).status, 401);
  assert.equal((await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password })).status, 403);
  await stop();
  await start();
  assert.equal((await request('/api/session/unlock', 'POST', undefined,
    { password: lockPassword })).status, 200);
  assert.equal((await request('/api/bootstrap')).status, 401);
  assert.equal((await request('/api/vms', 'GET', ownerToken)).status, 401);
  const again = await request('/api/access/login', 'POST', undefined,
    { username: 'owner', password: newPassword });
  assert.equal(again.status, 200);
  assert.equal((await request('/api/vms', 'GET', again.body.token)).status, 200);
  const persistedAudit = await request('/api/audit/remote', 'GET', again.body.token);
  assert.equal(persistedAudit.status, 200);
  assert.equal(persistedAudit.body.last.key, auditSynced.body.last.key);
  assert.equal((await request('/api/audit/remote', 'POST', again.body.token,
    { action: 'verify' })).status, 200);
  const restartedPolicyKeys = await request('/api/access/policy-bundles/keys',
    'GET', again.body.token);
  assert.equal(restartedPolicyKeys.status, 200);
  assert.equal(restartedPolicyKeys.body.localKey.fingerprint,
    policyKeys.body.localKey.fingerprint);
  assert.equal(restartedPolicyKeys.body.trustedKeys.length, 1);
  assert.equal((await request('/api/access/policy-bundles/preview', 'POST',
    again.body.token, { bundle: exportedPolicy.body.bundle, target })).status, 200);
  assert.equal((await request('/api/access/changes', 'GET', again.body.token)).body.changes
    .find((item: { id: string }) => item.id === proposed.body.id).status, 'applied');
  const persistedMember = await request('/api/access/login', 'POST', undefined,
    { username: 'developer', password: 'a long member password' });
  assert.equal(persistedMember.status, 200);
  memberToken = persistedMember.body.token;
  assert.equal((await request(projectPath, 'GET', memberToken)).status, 200);
  assert.equal((await request('/api/access/members/' + member.body.id,
    'DELETE', again.body.token)).status, 200);
  assert.equal((await request('/api/access/projects', 'GET', memberToken)).status, 401);
  assert.equal((await request('/api/access/login', 'POST', undefined,
    { username: 'developer', password: 'a long member password' })).status, 403);
  console.log('Account mode HTTP, WebSocket, browser, revocation and restart validation passed');
} finally {
  await stop();
  await new Promise<void>((done) => auditS3.close(() => done()));
  await rm(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
