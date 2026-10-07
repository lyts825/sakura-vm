/**
 * 回归范围（完整情景见下方用例与断言）：
 * - all HTTP inputs declare a body protocol and expose query/header contracts without unknown bodies
 * - SDK and typed frontend use the same form, no-body and binary encoding and retain failure identities
 * - VM project hints are declared and optional query values encode consistently in SDK and typed clients
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { apiDocument } from '../server/openapi.ts';
import { generateSdk } from '../server/sdk.ts';
import { apiPath } from '../shared/api-document.ts';
import { PLUGINS } from '../shared/plugins.ts';
import { operationEntries } from '../server/operation-catalog.ts';
import { createOperationClient } from '../shared/api-client.ts';
import { encodeOperationBody } from '../shared/http-transport.ts';
import { ControllerSession } from '../src/controller-session.ts';
const sdk = async (port = 7337) =>
  import(
    'data:text/javascript;base64,' +
      Buffer.from(generateSdk(apiDocument(['commands'], port))).toString('base64')
  );

test('all HTTP inputs declare a body protocol and expose query/header contracts without unknown bodies', () => {
  const spec = apiDocument([], 7337);
  for (const entry of operationEntries.filter(entry => entry.declaration.method !== 'UPGRADE')) {
    assert.ok(entry.requestContract, entry.declaration.id);
    assert.ok(entry.declaration.request, entry.declaration.id);
    if (entry.requestContract!.kind !== 'none' && entry.requestContract!.kind !== 'binary') assert.ok(entry.body);
  }
  const saml = spec.paths['/api/access/sso/saml/callback'].post;
  assert.deepEqual(saml.requestBody!.content['application/x-www-form-urlencoded'].schema.required, ['SAMLResponse', 'RelayState']);
  assert.equal(spec.paths['/api/vms/{vmId}/start'].post.requestBody, undefined);
  assert.ok(spec.paths['/api/image-import'].post.requestBody!.content['application/octet-stream']);
  assert.ok(spec.paths['/api/vms/{vmId}/uploads'].put.parameters.some(item => item.in === 'query' && item.name === 'chunk' && item.required));
  assert.ok(spec.paths['/api/vms/{vmId}/uploads'].put.parameters.some(item => item.in === 'header' && item.name === 'x-sakura-file-lock'));
  assert.ok(spec.paths['/api/extension/connect'].post.parameters.some(item => item.in === 'header' && item.name === 'origin' && item.required));
  assert.ok(spec.paths['/api/extension/connect'].post.parameters.some(item => item.in === 'header' && item.name === 'x-sakura-extension-origin' && item.required));
  assert.ok(spec.paths['/api/extension/inventory'].get.parameters.some(item => item.in === 'header' && item.name === 'x-sakura-extension-origin' && item.required));
  assert.ok(spec.paths['/api/extension/connect'].options.parameters.some(item => item.in === 'header' && item.name === 'origin' && item.required));
  assert.equal(spec.paths['/api/extension/connect'].options.parameters.some(item => item.in === 'header' && item.name === 'x-sakura-extension-origin'), false);
  assert.equal(spec['x-sakura-operations']!.filter(entry => entry.method === 'UPGRADE' && entry.contract === 'declared').length, 6);
});

test('SDK and typed frontend use the same form, no-body and binary encoding and retain failure identities', async () => {
  const { SakuraClient } = await sdk();
  const captured: RequestInit[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    captured.push(init!);
    return new Response('<html>callback</html>', { headers: { 'content-type': 'text/html' } });
  };
  const client = new SakuraClient({ fetcher });
  const controller = new ControllerSession(fetcher as typeof fetch);
  const body = { SAMLResponse: 'a+/=& assertion', RelayState: 'relay&state' };
  assert.equal(await client.call('core.access.ssoSamlCallback', { body }), '<html>callback</html>');
  assert.equal(await controller.operation('core.access.ssoSamlCallback', { body }), '<html>callback</html>');
  assert.equal(String(captured[0].body), String(captured[1].body));
  assert.equal(new URLSearchParams(String(captured[0].body)).get('SAMLResponse'), body.SAMLResponse);
  assert.equal(new Headers(captured[0].headers).get('content-type'), 'application/x-www-form-urlencoded; charset=utf-8');
  assert.deepEqual(captured[0].headers, captured[1].headers);
  await assert.rejects(client.call('core.vms.start', { path: { vmId: 'vm' }, body: {} }), /不接受请求体/);
  const bytes = new Uint8Array([0, 255, 1]);
  assert.equal(encodeOperationBody('binary', bytes).body, bytes);
  const transfers: any[] = [];
  const typed = createOperationClient(async (_path, options) => { transfers.push(options); return {}; });
  await typed('files.legacy.put.vms.vmId.uploads', { path: { vmId: 'vm' }, query: { id: 'upload', chunk: '0' }, body: bytes });
  assert.equal(transfers[0].bodyKind, 'binary'); assert.equal(transfers[0].body, bytes);
  const correlationId = '11111111-1111-4111-8111-111111111111';
  const failing = new SakuraClient({ fetcher: async () => Response.json({ error: '响应校验失败', code: 'INVALID_OPERATION_RESPONSE', correlationId,
    operationResult: { correlationId, outcome: 'succeeded', executed: true, query: '/api/operation-results/' + correlationId } }, { status: 502 }) });
  await assert.rejects(failing.call('core.access.ssoSamlCallback', { body }), (error: any) =>
    error.status === 502 && error.code === 'INVALID_OPERATION_RESPONSE' && error.correlationId === correlationId &&
    error.operationResult.outcome === 'succeeded' && error.message.includes(correlationId));
});

test('VM project hints are declared and optional query values encode consistently in SDK and typed clients', async () => {
  const spec = apiDocument(['files'], 7337), id = 'files.legacy.get.vms.vmId.files' as const;
  const entry = operationEntries.find(candidate => candidate.declaration.id === id)!;
  assert.equal(entry.declaration.projectScoped, false);
  assert.equal(entry.declaration.projectBinding, 'none');
  assert.ok(spec.paths['/api/vms/{vmId}/files'].get.parameters.some(item =>
    item.in === 'query' && item.name === 'project' && !item.required));
  const { SakuraClient } = await sdk();
  const sdkPaths: string[] = [], typedPaths: string[] = [];
  const client = new SakuraClient({ fetcher: async (target: string) => {
    const url = new URL(target);
    if (url.pathname === '/api/bootstrap') return Response.json({ token: 'credential' });
    sdkPaths.push(url.pathname + url.search);
    return Response.json([]);
  } });
  const typed = createOperationClient(async path => { typedPaths.push(path); return []; });
  for (const query of [{ path: '/workspace/a&b', project: 'default' }, { path: '', project: undefined },
    { path: undefined, project: undefined }]) {
    await client.call(id, { path: { vmId: 'test-vm' }, query });
    await typed(id, { path: { vmId: 'test-vm' }, query });
    entry.requestContract!.query.parse(query);
  }
  assert.deepEqual(sdkPaths, typedPaths);
  assert.deepEqual(typedPaths, ['/api/vms/test-vm/files?path=%2Fworkspace%2Fa%26b&project=default',
    '/api/vms/test-vm/files?path=', '/api/vms/test-vm/files']);
  for (const candidate of operationEntries.filter(item => item.declaration.method !== 'UPGRADE' &&
    item.declaration.path.includes('{vmId}'))) {
    const field = candidate.requestContract!.query.shape.project;
    assert.ok(field, candidate.declaration.id);
    assert.equal(field.safeParse('default').success, true, candidate.declaration.id);
    assert.equal(field.safeParse(undefined).success, true, candidate.declaration.id);
  }
});

test('OpenAPI describes real core and typed operations, optional defaults, project queries and plugin availability', () => {
  const spec = apiDocument(['commands'], 7337);
  assert.equal(spec.openapi, '3.1.1');
  const ids = new Set();
  for (const [path, methods] of Object.entries(spec.paths))
    for (const operation of Object.values(methods)) {
      assert.ok(!ids.has(operation.operationId));
      ids.add(operation.operationId);
      assert.deepEqual(
        operation.parameters
          .filter((parameter) => parameter.in === 'path')
          .map((parameter) => parameter.name),
        [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
      );
      assert.ok(Object.keys(operation.responses).length);
    }
  for (const plugin of PLUGINS)
    for (const operation of plugin.contributes.operations)
      assert.ok(ids.has(`${plugin.id}.${operation.id}`), `${plugin.id}.${operation.id}`);
  assert.equal(spec.paths['/api/vms/{vmId}/commands'].get['x-sakura-enabled'], true);
  const notebookLink = spec.paths['/api/vms/{vmId}/notebook-link'].get;
  assert.equal(notebookLink.operationId, 'platform.notebook-link');
  assert.deepEqual(notebookLink.responses[200].content!['application/json'].schema.required,
    ['provider', 'url']);
  const browserIdeLink = spec.paths['/api/vms/{vmId}/browser-ide-link'].get;
  assert.equal(browserIdeLink.operationId, 'platform.browser-ide-link');
  assert.deepEqual(browserIdeLink.responses[200].content!['application/json'].schema.required,
    ['url', 'password', 'expiresAt']);
  assert.equal(spec.paths['/api/vms/{vmId}/metrics'].get['x-sakura-enabled'], false);
  assert.ok(
    spec.paths['/api/vms/{vmId}/commands'].get.parameters.some(
      (item) => item.name === 'project' && !item.required,
    ),
  );
  const execution = spec.paths['/api/vms/{vmId}/exec'].post;
  const executionBody = execution.requestBody!.content['application/json'].schema;
  const executionProperties = executionBody.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(executionBody.required, ['command']);
  assert.equal(executionProperties.scope.default, 'project');
  assert.equal(executionProperties.timeoutSeconds.default, 30);
  assert.ok(execution.parameters.some((item) => item.name === 'project' && item.in === 'query' && !item.required));
  const executionBranches = execution.responses[200].content!['application/json'].schema.anyOf as {
    required: string[]; properties: { scope: { const: string } };
  }[];
  assert.deepEqual(executionBranches.map((branch) => branch.properties.scope.const).sort(), ['instance', 'project']);
  for (const branch of executionBranches)
    for (const field of ['stdout', 'stderr', 'code', 'scope']) assert.ok(branch.required.includes(field), field);
  assert.ok(executionBranches.find((branch) => branch.properties.scope.const === 'project')!.required.includes('projectId'));
  const body = spec.paths['/api/vms'].post.requestBody!.content['application/json'].schema;
  assert.deepEqual(body.required, ['name']);
  assert.deepEqual(spec.paths['/api/bootstrap'].get.security, []);
  assert.deepEqual(spec.paths['/api/access/login'].post.security, []);
  assert.deepEqual(spec.paths['/api/access/handoff/redeem'].post.security, []);
  assert.equal(spec.paths['/api/access/handoff'].post.security, undefined);
  assert.equal(spec.paths['/api/access/terminal-shares'].post.security, undefined);
  assert.deepEqual(spec.paths['/api/access/passkeys/login/options'].post.security, []);
  assert.deepEqual(spec.paths['/api/access/passkeys/login/verify'].post.security, []);
  assert.equal(spec.paths['/api/access/passkeys/register/options'].post.security, undefined);
  assert.equal(spec.paths['/api/access/passkeys/{id}'].delete.parameters[0].name, 'id');
  assert.deepEqual(spec.paths['/api/access/status'].get.security, []);
  assert.equal(spec.paths['/api/access/users'].post.security, undefined);
  assert.equal(spec.paths['/api/native-clipboard'].get.operationId, 'core.native-clipboard.get');
  assert.equal(spec.paths['/api/native-clipboard'].post.security, undefined);
  const nativeRequests = spec.paths['/api/native-clipboard'].post.requestBody!.content['application/json']
    .schema.oneOf as any[];
  const controlledStartup = nativeRequests.find((item) => item.properties.action.const === 'launch');
  assert.ok(controlledStartup, 'Controlled startup is available through the same authenticated operation');
  assert.deepEqual(controlledStartup.required, ['action', 'version', 'image', 'sha256', 'args']);
  assert.equal(controlledStartup.additionalProperties, false);
  assert.equal(controlledStartup.properties.args.maxItems, 64);
  assert.equal(controlledStartup.properties.args.items.maxLength, 2048);
  const x11 = spec.paths['/api/vms/{vmId}/x11-clipboard'];
  assert.equal(x11.get.operationId, 'desktop.x11-clipboard-get');
  assert.ok(x11.post.requestBody!.content['application/json'].schema.oneOf);
  assert.ok(x11.post.parameters.some(item => item.name === 'project' && item.in === 'query'));
  const wayland = spec.paths['/api/vms/{vmId}/wayland-clipboard'];
  assert.equal(wayland.get.operationId, 'desktop.wayland-clipboard-get');
  assert.ok(wayland.post.requestBody!.content['application/json'].schema.oneOf);
  assert.ok(wayland.post.parameters.some(item => item.name === 'project' && item.in === 'query'));
  assert.deepEqual(spec.paths['/api/access/changes'].post.requestBody!.content['application/json']
    .schema.required, ['vmId', 'projectId', 'summary', 'project', 'expectedVersion']);
  assert.equal(spec.paths['/api/access/changes/{id}/apply'].post.parameters[0].name, 'id');
  assert.deepEqual(spec.paths['/api/access/policy-bundles/apply'].post.requestBody!
    .content['application/json'].schema.required, ['bundle', 'target', 'expectedVersion']);
  assert.equal(spec.paths['/api/access/policy-bundles/keys'].get.security, undefined);
  assert.equal(spec.paths['/api/audit/remote'].get.security, undefined);
  assert.equal(spec.paths['/api/audit/remote'].post.security, undefined);
  assert.deepEqual(spec.paths['/api/session/unlock'].post.security, []);
  assert.equal(spec.paths['/api/session/settings'].patch.security, undefined);
  assert.ok(spec.paths['/api/images'].get); // Exact read endpoint, never the old dispatcher POST prefix.
  assert.equal(spec.paths['/api/images'].post, undefined);
  assert.ok(spec.paths['/api/images/{imageId}'].post);
  assert.ok(spec['x-sakura-operations']?.some(item => item.method === 'UPGRADE'));
  assert.deepEqual(spec.paths['/api/host-runtime'].get['x-sakura-operation']?.roles, ['owner']);
  assert.ok(spec['x-sakura-route-prefixes'].some((item) => item.path === '/api/images'));
  assert.equal(
    apiPath('/api/vms/{vmId}/commands', { vmId: 'vm' }, { project: 'default', q: 'a&b' }),
    '/api/vms/vm/commands?project=default&q=a%26b',
  );
  assert.throws(() => apiPath('/api/vms/{vmId}', { vmId: '..' }));
});

test('generated SDK logs into account mode, uses the session token and revokes it on logout', async () => {
  const { SakuraClient } = await sdk();
  const token = 'a'.repeat(64);
  const calls: { path: string; method: string; token?: string; body?: string }[] = [];
  const client = new SakuraClient({ fetcher: async (url: string, options: RequestInit) => {
    const path = new URL(url).pathname;
    const headers = options.headers as Record<string, string>;
    calls.push({ path, method: options.method!, token: headers['X-Sakura-Token'],
      body: options.body as string | undefined });
    if (path === '/api/access/login') return Response.json({ token,
      principal: { id: 'viewer-id', username: 'reader', role: 'viewer', vmIds: [],
        expiresAt: Date.now() + 1000 } });
    if (path === '/api/access/logout') return Response.json({ ok: true });
    if (path === '/api/access/view') return Response.json({ vms: [] });
    throw new Error('Unexpected request ' + path);
  } });
  assert.equal((await client.login('reader', 'long private password')).role, 'viewer');
  assert.deepEqual(await client.call('core.access.view'), { vms: [] });
  await client.logout();
  assert.deepEqual(calls.map((item) => item.path),
    ['/api/access/login', '/api/access/view', '/api/access/logout']);
  assert.equal(calls[0].token, undefined);
  assert.equal(calls[1].token, token);
  assert.equal(calls[2].token, token);
  assert.equal(JSON.parse(calls[0].body!).password, 'long private password');
  assert.equal(JSON.stringify(client), '{}');
});

test('generated SDK accepts project member accounts and includes project authorization operations', async () => {
  const { SakuraClient, operations } = await sdk();
  assert.equal(operations['core.access.configureProjectPermissions'].method, 'PUT');
  const token = 'b'.repeat(64);
  const client = new SakuraClient({ fetcher: async (url: string, options: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/api/access/login') return Response.json({ token,
      principal: { id: 'member-id', username: 'developer', role: 'member', vmIds: [],
        expiresAt: Date.now() + 1000 } });
    if (path === '/api/access/projects') {
      assert.equal((options.headers as Record<string, string>)['X-Sakura-Token'], token);
      return Response.json({ projects: [{ vmId: 'vm', projectId: 'default', roleId: 'reader' }] });
    }
    throw new Error('Unexpected request ' + path);
  } });
  assert.equal((await client.login('developer', 'long private password')).role, 'member');
  assert.equal((await client.call('core.access.projects')).projects[0].roleId, 'reader');
});

test('the generated module authenticates against HTTP, sends encoded parameters and JSON, and streams binary replies', async () => {
  const calls: { path: string; method: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/api/bootstrap') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ token: 'private-token' }));
      return;
    }
    assert.equal(req.headers['x-sakura-token'], 'private-token');
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url!, method: req.method!, body });
    if (req.url === '/api/binary') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.end(Buffer.from([0, 255, 1]));
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { SakuraClient } = await sdk((server.address() as any).port);
    const client = new SakuraClient();
    assert.deepEqual(
      await client.call('commands.run', {
        path: { vmId: 'machine-id' },
        query: { project: 'default', q: 'a&b' },
        body: { id: 'preset-id', values: { word: 'hello' } },
      }),
      { ok: true },
    );
    assert.deepEqual(calls[0], {
      path: '/api/vms/machine-id/commands?project=default&q=a%26b',
      method: 'POST',
      body: JSON.stringify({ id: 'preset-id', values: { word: 'hello' } }),
    });
    const response = await client.request('/api/binary');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0, 255, 1]));
    assert.equal(JSON.stringify(client), '{}');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('generated clients reject route escape and external origins, never replay writes, and reauthenticate only on a new explicit call', async () => {
  const { SakuraClient } = await sdk();
  for (const baseUrl of [
    'https://example.com',
    'http://127.0.0.1/path',
    'http://user:password@localhost:7337',
  ])
    assert.throws(() => new SakuraClient({ baseUrl }));
  let authentication = 0,
    writes = 0,
    deny = true;
  const client = new SakuraClient({
    fetcher: async (url: string) => {
      if (url.endsWith('/bootstrap')) {
        authentication++;
        return Response.json({ token: 'token' });
      }
      writes++;
      if (deny) return Response.json({ error: 'expired', code: 'UNAUTHORIZED' }, { status: 401 });
      return Response.json({ ok: true });
    },
  });
  await assert.rejects(
    () => client.call('core.vms.start', { path: { vmId: '../outside' } }),
    /Invalid path parameter/,
  );
  for (const path of [
    '/api/../escape',
    '/api/%2e%2e/escape',
    '//outside/api/test',
    '/api/x?token=secret',
    '/api/x\\outside',
  ])
    await assert.rejects(() => client.request(path));
  assert.equal(authentication, 0);
  await assert.rejects(
    () => client.call('core.vms.start', { path: { vmId: 'vm' } }),
    (error: any) => error.status === 401,
  );
  assert.equal(writes, 1);
  assert.equal(authentication, 1);
  deny = false;
  await client.call('core.vms.start', { path: { vmId: 'vm' } });
  assert.equal(writes, 2);
  assert.equal(authentication, 2);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => client.call('core.vms.start', { path: { vmId: 'vm' }, signal: abort.signal }));
  assert.equal(writes, 2);
  const broken = new SakuraClient({
    fetcher: async (url: string) => {
      if (url.endsWith('/bootstrap')) return Response.json({ token: 'token' });
      writes++;
      throw new TypeError('Connection lost after submission');
    },
  });
  await assert.rejects(
    () => broken.call('core.vms.stop', { path: { vmId: 'vm' }, body: { force: false } }),
    /Connection lost/,
  );
  assert.equal(writes, 3);
});
