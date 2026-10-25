/**
 * 模块职责：回归验证模块，围绕 `openapi` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `openapi`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: all HTTP inputs declare a body protocol and expose query/header contracts without unknown bodies; SDK and typed frontend use the same form, no-body and binary encoding and retain failure identities.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetch as patchedFetch } from 'undici';
import { apiDocument } from '../server/openapi.ts';
import { generateSdk } from '../server/sdk.ts';
import { apiPath } from '../shared/api-document.ts';
import { PLUGINS } from '../shared/plugins.ts';
import { operationEntries } from '../server/operation-catalog.ts';
import { createOperationClient } from '../shared/api-client.ts';
import { encodeOperationBody } from '../shared/http-transport.ts';
import { ControllerSession } from '../src/controller-session.ts';
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: port = 7337。
 * 结果：返回分支计算值（`import( 'data:text/javascript;base64,' + Buffer.from(generateSdk(apiDocument(['c…`），以 Promise 交付。
 * Result: Return the branch-computed value (`import( 'data:text/javascript;base64,' + Buffer.from(generateSdk(apiDocument(['c…`) through a Promise.
 * 协作入口 / Collaborators: `import`, `Buffer.from(generateSdk(apiDocument(['commands'], port))).toString`, `Buffer.from`, `generateSdk`.
 */
const sdk = async (port = 7337) =>
  import(
    'data:text/javascript;base64,' +
      Buffer.from(generateSdk(apiDocument(['commands'], port))).toString('base64')
  );

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all HTTP inputs declare a body protocol and expose query/header contracts without unknown bodies
 * 协作入口 / Collaborators: `apiDocument`, `operationEntries.filter`, `assert.ok`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.ok(entry.requestContract, entry.declaration.id)`; `assert.ok(entry.declaration.request, entry.declaration.id)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SDK and typed frontend use the same form, no-body and binary encoding and retain failure identities
 * 协作入口 / Collaborators: `sdk`, `assert.equal`, `client.call`, `controller.operation`.
 * 检查边界 / Checked boundaries: `assert.equal(await client.call('core.access.ssoSamlCallback', { body }), '<html>callback</html>')`; `assert.equal(await controller.operation('core.access.ssoSamlCallback', { body }), '<html>callback</html>')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SDK and typed frontend use the same form, no-body and binary encoding and retain failure identities', async () => {
  const { SakuraClient } = await sdk();
  const captured: RequestInit[] = [];
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _url: string | URL | Request; init: RequestInit。
   * 结果：返回分支计算值（`new Response('<html>callback</html>', { headers: { 'content-type': 'text/html' }…`），以 Promise 交付。
   * Result: Return the branch-computed value (`new Response('<html>callback</html>', { headers: { 'content-type': 'text/html' }…`) through a Promise.
   * 验证场景 / Scenario: SDK and typed frontend use the same form, no-body and binary encoding and retain failure identities
   * 协作入口 / Collaborators: `captured.push`.
   */
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
  const failing = new SakuraClient({ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`Response.json({ error: '响应校验失败', code: 'INVALID_OPERATION_RESPONSE', correlation…`），以 Promise 交付。
   * Result: Return the branch-computed value (`Response.json({ error: '响应校验失败', code: 'INVALID_OPERATION_RESPONSE', correlation…`) through a Promise.
   * 验证场景 / Scenario: SDK and typed frontend use the same form, no-body and binary encoding and retain failure identities
   * 协作入口 / Collaborators: `Response.json`.
   */
  fetcher: async () => Response.json({ error: '响应校验失败', code: 'INVALID_OPERATION_RESPONSE', correlationId,
    operationResult: { correlationId, outcome: 'succeeded', executed: true, query: '/api/operation-results/' + correlationId } }, { status: 502 }) });
  await assert.rejects(failing.call('core.access.ssoSamlCallback', { body }), (error: any) =>
    error.status === 502 && error.code === 'INVALID_OPERATION_RESPONSE' && error.correlationId === correlationId &&
    error.operationResult.outcome === 'succeeded' && error.message.includes(correlationId));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: VM project hints are declared and optional query values encode consistently in SDK and typed clients
 * 协作入口 / Collaborators: `apiDocument`, `operationEntries.find`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(entry.declaration.projectScoped, false)`; `assert.equal(entry.declaration.projectBinding, 'none')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('VM project hints are declared and optional query values encode consistently in SDK and typed clients', async () => {
  const spec = apiDocument(['files'], 7337), id = 'files.legacy.get.vms.vmId.files' as const;
  const entry = operationEntries.find(candidate => candidate.declaration.id === id)!;
  assert.equal(entry.declaration.projectScoped, false);
  assert.equal(entry.declaration.projectBinding, 'none');
  assert.ok(spec.paths['/api/vms/{vmId}/files'].get.parameters.some(item =>
    item.in === 'query' && item.name === 'project' && !item.required));
  const { SakuraClient } = await sdk();
  const sdkPaths: string[] = [], typedPaths: string[] = [];
  const client = new SakuraClient({ /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: target: string。
   * 结果：返回分支计算值（`Response.json({ token: 'credential' }) / Response.json([])`），以 Promise 交付。
   * Result: Return the branch-computed value (`Response.json({ token: 'credential' }) / Response.json([])`) through a Promise.
   * 验证场景 / Scenario: VM project hints are declared and optional query values encode consistently in SDK and typed clients
   * 协作入口 / Collaborators: `Response.json`, `sdkPaths.push`.
   */
  fetcher: async (target: string) => {
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: OpenAPI describes real core and typed operations, optional defaults, project queries and plugin availability
 * 协作入口 / Collaborators: `apiDocument`, `assert.equal`, `Object.entries`, `Object.values`.
 * 检查边界 / Checked boundaries: `assert.equal(spec.openapi, '3.1.1')`; `assert.ok(!ids.has(operation.operationId))`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: generated SDK logs into account mode, uses the session token and revokes it on logout
 * 协作入口 / Collaborators: `sdk`, `'a'.repeat`, `assert.equal`, `client.login`.
 * 检查边界 / Checked boundaries: `assert.equal((await client.login('reader', 'long private password')).role, 'viewer')`; `assert.deepEqual(await client.call('core.access.view'), { vms: [] })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('generated SDK logs into account mode, uses the session token and revokes it on logout', async () => {
  const { SakuraClient } = await sdk();
  const token = 'a'.repeat(64);
  const calls: { path: string; method: string; token?: string; body?: string }[] = [];
  const client = new SakuraClient({ /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: url: string; options: RequestInit。
   * 结果：返回分支计算值（`Response.json({ token, principal: { id: 'viewer-id', username: 'reader', role: '… / Response.json({ ok: true })`），以 Promise 交付。
   * Result: Return the branch-computed value (`Response.json({ token, principal: { id: 'viewer-id', username: 'reader', role: '… / Response.json({ ok: true })`) through a Promise.
   * 验证场景 / Scenario: generated SDK logs into account mode, uses the session token and revokes it on logout
   * 失败 / Failure: `new Error('Unexpected request ' + path)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `calls.push`, `Response.json`, `Date.now`.
   * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
   * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
   */
  fetcher: async (url: string, options: RequestInit) => {
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: generated SDK accepts project member accounts and includes project authorization operations
 * 协作入口 / Collaborators: `sdk`, `assert.equal`, `'b'.repeat`, `client.login`.
 * 检查边界 / Checked boundaries: `assert.equal(operations['core.access.configureProjectPermissions'].method, 'PUT')`; `assert.equal((await client.login('developer', 'long private password')).role, 'member')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('generated SDK accepts project member accounts and includes project authorization operations', async () => {
  const { SakuraClient, operations } = await sdk();
  assert.equal(operations['core.access.configureProjectPermissions'].method, 'PUT');
  const token = 'b'.repeat(64);
  const client = new SakuraClient({ /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: url: string; options: RequestInit。
   * 结果：返回分支计算值（`Response.json({ token, principal: { id: 'member-id', username: 'developer', role… / Response.json({ projects: [{ vmId: 'vm', projectId: 'default', roleId: 'reader' …`），以 Promise 交付。
   * Result: Return the branch-computed value (`Response.json({ token, principal: { id: 'member-id', username: 'developer', role… / Response.json({ projects: [{ vmId: 'vm', projectId: 'default', roleId: 'reader' …`) through a Promise.
   * 验证场景 / Scenario: generated SDK accepts project member accounts and includes project authorization operations
   * 失败 / Failure: `new Error('Unexpected request ' + path)`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `Response.json`, `Date.now`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal((options.headers as Record<string, string>)['X-Sakura-Token'], token)`.
   */
  fetcher: async (url: string, options: RequestInit) => {
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: the generated module authenticates against HTTP, sends encoded parameters and JSON, and streams binary replies
 * 协作入口 / Collaborators: `createServer`, `sdk`, `server.address`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( await client.call('commands.run', { path: { vmId: 'machine-id' }, query: { project: 'default', q: 'a&b' }, body:…`; `assert.deepEqual(calls[0], { path: '/api/vms/machine-id/commands?project=default&q=a%26b', method: 'POST', body: JSON.stringify({ …`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('the generated module authenticates against HTTP, sends encoded parameters and JSON, and streams binary replies', async () => {
  const calls: { path: string; method: string; body: string }[] = [];
  const server = createServer(/**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: req; res。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: the generated module authenticates against HTTP, sends encoded parameters and JSON, and streams binary replies
   * 状态影响 / State effects: `body`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `res.setHeader`, `res.end`, `JSON.stringify`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(req.headers['x-sakura-token'], 'private-token')`.
   */
  async (req, res) => {
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
    const client = new SakuraClient({ fetcher: patchedFetch });
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: generated clients reject route escape and external origins, never replay writes, and reauthenticate only on a new explicit call
 * 状态影响 / State effects: `deny`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `sdk`, `assert.throws`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.throws(() => new SakuraClient({ baseUrl }))`; `assert.rejects( () => client.call('core.vms.start', { path: { vmId: '../outside' } }), /Invalid path parameter/, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: url: string。
     * 结果：返回分支计算值（`Response.json({ token: 'token' }) / Response.json({ error: 'expired', code: 'UNAUTHORIZED' }, { status: 401 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`Response.json({ token: 'token' }) / Response.json({ error: 'expired', code: 'UNAUTHORIZED' }, { status: 401 })`) through a Promise.
     * 验证场景 / Scenario: generated clients reject route escape and external origins, never replay writes, and reauthenticate only on a new explicit call
     * 协作入口 / Collaborators: `url.endsWith`, `Response.json`.
     */
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
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: url: string。
     * 结果：返回分支计算值（`Response.json({ token: 'token' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`Response.json({ token: 'token' })`) through a Promise.
     * 验证场景 / Scenario: generated clients reject route escape and external origins, never replay writes, and reauthenticate only on a new explicit call
     * 失败 / Failure: `new TypeError('Connection lost after submission')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `url.endsWith`, `Response.json`.
     */
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
