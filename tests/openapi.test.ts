import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { apiDocument } from '../server/openapi.ts';
import { generateSdk } from '../server/sdk.ts';
import { apiPath } from '../shared/api-document.ts';
import { PLUGINS } from '../shared/plugins.ts';
const sdk = async (port = 7337) =>
  import(
    'data:text/javascript;base64,' +
      Buffer.from(generateSdk(apiDocument(['commands'], port))).toString('base64')
  );

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
  assert.equal(spec.paths['/api/vms/{vmId}/metrics'].get['x-sakura-enabled'], false);
  assert.ok(
    spec.paths['/api/vms/{vmId}/commands'].get.parameters.some(
      (item) => item.name === 'project' && !item.required,
    ),
  );
  const body = spec.paths['/api/vms'].post.requestBody!.content['application/json'].schema;
  assert.deepEqual(body.required, ['name']);
  assert.deepEqual(spec.paths['/api/bootstrap'].get.security, []);
  assert.deepEqual(spec.paths['/api/session/unlock'].post.security, []);
  assert.equal(spec.paths['/api/session/settings'].patch.security, undefined);
  assert.ok(!spec.paths['/api/images']); // This declaration is a dispatcher prefix, not a POST endpoint.
  assert.ok(spec['x-sakura-route-prefixes'].some((item) => item.path === '/api/images'));
  assert.equal(
    apiPath('/api/vms/{vmId}/commands', { vmId: 'vm' }, { project: 'default', q: 'a&b' }),
    '/api/vms/vm/commands?project=default&q=a%26b',
  );
  assert.throws(() => apiPath('/api/vms/{vmId}', { vmId: '..' }));
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
