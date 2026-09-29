import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex, PassThrough } from 'node:stream';
import { LanguageServices } from '../server/language-services.ts';
import { FileLocks } from '../server/file-locks.ts';
import { textVersion } from '../server/files.ts';
import { applyTextEdits, positionOffset } from '../shared/language-service.ts';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

function pair() {
  const leftToRight = new PassThrough(), rightToLeft = new PassThrough();
  const result = [
    Duplex.from({ readable: rightToLeft, writable: leftToRight }),
    Duplex.from({ readable: leftToRight, writable: rightToLeft }),
  ] as const;
  for (const stream of result) stream.on('error', () => {});
  return result;
}
const frame = (message: unknown) => {
  const data = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${data.length}\r\n\r\n`), data]);
};
function mockLanguageServer(stream: Duplex, renameUri = 'file:///workspace/app/a.ts',
  partialDiagnostics = false) {
  let input = Buffer.alloc(0);
  stream.on('data', (chunk: Buffer) => {
    input = Buffer.concat([input, chunk]);
    while (true) {
      const header = input.indexOf('\r\n\r\n');
      if (header < 0) return;
      const size = Number(/Content-Length: (\d+)/.exec(input.subarray(0, header).toString())?.[1]);
      if (input.length < header + 4 + size) return;
      const message = JSON.parse(input.subarray(header + 4, header + 4 + size).toString());
      input = input.subarray(header + 4 + size);
      if (message.method === 'initialize') {
        const response = frame({ jsonrpc: '2.0', id: message.id, result: { capabilities: {} } });
        stream.write(response.subarray(0, 11));
        stream.write(response.subarray(11));
      } else if (message.method === 'textDocument/didOpen') {
        if (partialDiagnostics) stream.write(frame({ jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics', params: {
            uri: message.params.textDocument.uri, diagnostics: [],
          } }));
        const publish = () =>
        stream.write(frame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
          uri: message.params.textDocument.uri,
          diagnostics: [{ message: 'mock warning', severity: 2, range: { start: { line: 0, character: 2 } } }],
        } }));
        if (partialDiagnostics) setTimeout(publish, 100);
        else publish();
      } else if (message.method === 'textDocument/completion') {
        stream.write(frame({ jsonrpc: '2.0', id: message.id, result: { items: [{ label: 'flower', detail: 'symbol' }] } }));
      } else if (message.method === 'textDocument/definition') {
        stream.write(frame({ jsonrpc: '2.0', id: message.id, result: {
          uri: renameUri, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 6 } },
        } }));
      } else if (message.method === 'textDocument/rename') {
        stream.write(frame({ jsonrpc: '2.0', id: message.id, result: { changes: {
          [renameUri]: [{ range: { start: { line: 0, character: 13 }, end: { line: 0, character: 19 } }, newText: message.params.newName }],
          'file:///workspace/app/b.ts': [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } }, newText: message.params.newName }],
        } } }));
      }
    }
  });
}
function fixture(renameUri?: string, partialDiagnostics = false) {
  const commands: string[] = [];
  const execCommands: string[] = [];
  const files = new Map([
    ['/workspace/app/a.ts', 'export const flower = 1;\n'],
    ['/workspace/app/b.ts', 'import { flower } from "./a";\n'],
  ]);
  const machines = {
    get: () => ({ distro: 'alpine' }),
    connect: async () => {
      const [client, server] = pair();
      mockLanguageServer(server, renameUri, partialDiagnostics);
      return { exec: (command: string, done: (error: Error | undefined, stream?: Duplex) => void) => {
        commands.push(command);
        done(undefined, client);
      },
        end: () => { client.destroy(); server.destroy(); }, destroy: () => { client.destroy(); server.destroy(); } };
    },
    readGuestFile: async (_id: string, path: string) => {
      if (!files.has(path)) throw new Error('missing file');
      return files.get(path)!;
    },
    writeGuestFile: async (_id: string, path: string, content: string, _overwrite: boolean, expected: string) => {
      assert.equal(textVersion(files.get(path)!), expected);
      files.set(path, content);
    },
    exec: async (_id: string, command: string) => {
      execCommands.push(command);
      return { code: 0, stdout: '', stderr: '' };
    },
  } as unknown as Machines;
  const project: { directory: string; networkIsolation?: 'host' | 'private' } = { directory: '/workspace/app' };
  const workspaces = { config: async () => project } as unknown as Workspaces;
  const locks = new FileLocks();
  return { service: new LanguageServices(machines, workspaces, locks), files, locks, project,
    commands, execCommands };
}

test('language service installation provisions Python for Pyright diagnostics', async () => {
  const { service, execCommands } = fixture();
  await service.install('vm');
  assert.match(execCommands[0], /apk add --no-cache --timeout 30 nodejs npm python3/);
  await service.status('vm', '/workspace/app/main.py');
  assert.match(execCommands[1], /command -v python3 >\/dev\/null/);
});

test('private project language server starts inside its network namespace', async () => {
  const { service, files, project, commands } = fixture();
  project.networkIsolation = 'private';
  const result = await service.execute('vm', { action: 'completion',
    path: '/workspace/app/a.ts', content: files.get('/workspace/app/a.ts')!,
    position: { line: 0, character: 16 } });
  assert.equal(result.items[0].label, 'flower');
  assert.match(commands[0], /ip netns exec sk-default sh -lc/);
  assert.match(commands[0], /sakura_ipv4=.*ip -n sk-default/);
});

test('TypeScript diagnostics wait past an initial empty syntax report', async () => {
  const { service, files } = fixture(undefined, true);
  const result = await service.execute('vm', { action: 'diagnostics',
    path: '/workspace/app/a.ts', content: files.get('/workspace/app/a.ts')! });
  assert.equal(result.received, true);
  assert.equal(result.diagnostics[0]?.message, 'mock warning');
});

test('LSP UTF-16 edits validate ranges and reject overlaps', () => {
  assert.equal(positionOffset('a😀b\n', { line: 0, character: 3 }), 3);
  assert.equal(applyTextEdits('abc\ndef', [
    { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, newText: 'ghi' },
    { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, newText: 'B' },
  ]), 'aBc\nghi');
  assert.throws(() => applyTextEdits('abc', [
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, newText: 'a' },
    { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } }, newText: 'b' },
  ]), /重叠/);
});

test('language services run framed LSP completion, definition, diagnostics and previewed multi-file rename', async () => {
  const { service, files, locks } = fixture();
  const content = files.get('/workspace/app/a.ts')!;
  const base = { path: '/workspace/app/a.ts', content, position: { line: 0, character: 16 } };
  const completion = await service.execute('vm', { ...base, action: 'completion' });
  assert.equal(completion.items[0].label, 'flower');
  const definition = await service.execute('vm', { ...base, action: 'definition' });
  assert.equal(definition.locations[0].line, 2);
  const diagnostics = await service.execute('vm', { ...base, action: 'diagnostics' });
  assert.equal(diagnostics.received, true);
  assert.equal(diagnostics.diagnostics[0].severity, 'warning');
  const preview = await service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(content) });
  assert.equal(preview.files.length, 2);
  assert.equal(files.get('/workspace/app/a.ts'), content, 'preview must not write');
  const lease = await locks.acquire('vm', '/workspace/app/a.ts');
  await assert.rejects(service.apply('vm', preview.token), /锁定/);
  const applied = await service.apply('vm', preview.token, lease.token);
  assert.equal(applied.files.length, 2);
  assert.equal(files.get('/workspace/app/a.ts'), 'export const petal = 1;\n');
  assert.equal(files.get('/workspace/app/b.ts'), 'import { petal } from "./a";\n');
  await assert.rejects(service.apply('vm', preview.token, lease.token), /过期/);
});

test('language services reject out-of-project locations and stale rename previews', async () => {
  const { service, files } = fixture('file:///etc/shadow');
  const content = files.get('/workspace/app/a.ts')!;
  const base = { path: '/workspace/app/a.ts', content, position: { line: 0, character: 16 } };
  await assert.rejects(service.execute('vm', { ...base, action: 'definition' }), /相对文件路径|项目目录/);
  await assert.rejects(service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(content) }), /相对文件路径|项目目录/);
  await assert.rejects(service.execute('vm', { ...base, path: '/etc/shadow', action: 'completion' }), /相对文件路径|项目目录/);
  const normal = fixture();
  const before = normal.files.get('/workspace/app/a.ts')!;
  const preview = await normal.service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(before) });
  normal.files.set('/workspace/app/b.ts', 'changed\n');
  await assert.rejects(normal.service.apply('vm', preview.token), /改变/);
  assert.equal(normal.files.get('/workspace/app/a.ts'), before);
  const switched = fixture();
  const another = await switched.service.execute('vm', { ...base, action: 'rename', newName: 'petal', version: textVersion(before) });
  switched.project.directory = '/workspace/other';
  await assert.rejects(switched.service.apply('vm', another.token), /项目已切换/);
  assert.equal(switched.files.get('/workspace/app/a.ts'), before);
});
