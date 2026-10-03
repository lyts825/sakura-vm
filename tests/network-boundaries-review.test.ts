import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { networkBoundaryErrors } from '../scripts/network-boundaries.ts';

const check = (code: string, file = 'server/example.ts') =>
  networkBoundaryErrors(file, ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true));

test('network guard rejects module loaders, reexports and aliased socket constructors', () => {
  for (const code of [
    "import { request as send } from 'node:https'; send(url);",
    "export { connect } from 'net';",
    "import network = require('node:net');",
    'await import(`node:https`);',
    "require('node:' + 'net');",
    "module.require('http');",
    "process.getBuiltinModule('net');",
    "import { createRequire } from 'node:module'; const load = createRequire(import.meta.url); load('node:net');",
    "import WS from 'ws'; new WS(url);",
    "import { WebSocket as WS } from 'ws'; const Transport = WS; new Transport(url);",
    "import * as sockets from 'ws'; new sockets.WebSocket(url);",
    "export { WebSocket as Outgoing } from 'ws';",
    "import { TLSSocket as TLS } from 'node:tls'; new TLS(stream);",
    "import { Client as SSH } from 'ssh2'; new SSH();",
    "import { WebSocketServer as Listener } from 'ws'; new Listener({port: 8080});",
    'const { WebSocket: WS } = globalThis; new WS(url);',
  ])
    assert.ok(check(code).length, code);
});

test('network guard follows lexical fetch references without file-wide exemptions', () => {
  for (const code of [
    'const send = fetch; send(url);',
    'const context = { fetch };',
    'function local(fetch) { fetch(url); } fetch(url);',
    'function local() { const { fetch } = networkFor("owner"); } fetch(url);',
    'const { fetch: send } = globalThis;',
    'const ambient = globalThis; ambient["f" + "etch"](url);',
    'global.fetch(url);',
    'const source = new EventSource(url);',
  ])
    assert.ok(check(code).length, code);
  for (const code of [
    'const { fetch } = networkFor("owner"); const send = fetch; send(url);',
    'function local(fetch: typeof globalThis.fetch) { return fetch(url); }',
    'const options = { fetch: managedFetch }; options.fetch(url);',
    "import type { Socket } from 'node:net'; export { type Server } from 'node:http';",
    "import { isIP } from 'node:net'; import { createSecureContext, TLSSocket } from 'node:tls'; isIP(host); socket instanceof TLSSocket;",
    "import { WebSocket, WebSocketServer } from 'ws'; const state = WebSocket.OPEN; new WebSocketServer({ noServer: true });",
  ])
    assert.deepEqual(check(code), [], code);
});

test('network guard requires managed S3 transports and explicit credentials under aliases', () => {
  const prefix = "import { S3Client as Store } from '@aws-sdk/client-s3'; ";
  for (const options of [
    '{}',
    '{requestHandler: undefined, credentials: value}',
    '{requestHandler: scope.requestHandler()}',
    '{requestHandler: scope.requestHandler(), credentials: undefined}',
  ])
    assert.ok(check(prefix + `new Store(${options});`).length, options);
  assert.deepEqual(
    check(prefix + 'new Store({requestHandler: scope.requestHandler(), credentials: value});'),
    [],
  );
  assert.deepEqual(check(prefix + 'new Store({requestHandler: scope.requestHandler(), credentials});'), []);
  assert.deepEqual(
    check(
      prefix + 'const requestHandler = scope.requestHandler(); new Store({requestHandler, credentials});',
    ),
    [],
  );
  assert.deepEqual(check("import { createConnection } from 'node:net';", 'server/network/host-pool.ts'), []);
});

test('architecture gate checks lazy plugin helpers and all packaged script dependencies', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sakura-network-boundaries-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    await rm(root, { recursive: true, force: true });
  });
  for (const folder of ['server', 'src', 'shared', 'plugins/example', 'scripts'])
    await mkdir(join(root, folder), { recursive: true });
  const write = (file: string, code: string) => writeFile(join(root, file), code);
  const run = () =>
    spawnSync(
      process.execPath,
      ['--import', import.meta.resolve('tsx'), resolve('scripts/check-architecture.ts')],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 },
    );
  await write('plugins/example/server.ts', 'export const load = () => import("./helper.mjs");');
  await write('plugins/example/helper.mjs', 'export const send = fetch;');
  let result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /plugins\/example\/helper.mjs.*Unmanaged/);
  await write('plugins/example/helper.mjs', 'export const safe = true;');
  await write('scripts/package-release.mjs', "for (const file of ['custom-runtime.mjs']) copy(file);");
  await write('scripts/custom-runtime.mjs', "import './runtime-helper.mjs';");
  await write('scripts/runtime-helper.mjs', "import https from 'node:https';");
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scripts\/runtime-helper.mjs.*Direct network/);
  await write('scripts/runtime-helper.mjs', 'export const safe = true;');
  result = run();
  assert.equal(result.status, 0, result.stderr);
});
