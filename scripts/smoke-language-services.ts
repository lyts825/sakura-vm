import assert from 'node:assert/strict';
import { withOwnedProtocolSmoke, protocolSmokeObserver, protocolLspProbe } from './project-protocol-smoke-support.ts';
const source = 'export const flower = 1;\n';
if (process.argv.includes('--validate-only')) {
  console.log(JSON.stringify({ kind: 'lsp', vmStarted: false, observerBytes: Buffer.byteLength(protocolSmokeObserver),
    uidProbeBytes: Buffer.byteLength(protocolLspProbe), migration: 'explicit preview/apply', fixture: 'fresh owned and retained' }));
} else await withOwnedProtocolSmoke('lsp', async ({ features, machines, vmId, directory, lsp }) => {
  const { textVersion } = await import('../server/files.ts');
  const distro = machines.get(vmId).distro, isolated = process.env.SAKURA_LSP_PRIVATE === '1';
  const before = await features.languageServices.status(vmId, directory + '/a.ts');
  console.log('Language server initially installed:', before.installed);
  if (!before.installed) await features.languageServices.install(vmId);
  assert.equal((await features.languageServices.status(vmId, directory + '/a.ts')).installed, true);
  assert.equal((await features.languageServices.status(vmId, directory + '/main.py')).installed, true);

  const python = await lsp(() => features.languageServices.execute(vmId, {
    action: 'diagnostics', path: directory + '/main.py', content: 'import os\nprint(missing_name)\n',
  }));
  assert.equal(python.received, true, JSON.stringify(python));
  assert.ok(python.diagnostics.some((item) => item.message.includes('missing_name')), JSON.stringify(python));
  const completion = await lsp(() => features.languageServices.execute(vmId, {
    action: 'completion', path: directory + '/b.ts',
    content: 'import { flower } from "./a";\nconsole.log(flo);\n', position: { line: 1, character: 15 },
  }));
  assert.ok(completion.items.some((item) => item.label === 'flower'), JSON.stringify(completion.items.slice(0, 12)));
  const definition = await lsp(() => features.languageServices.execute(vmId, {
    action: 'definition', path: directory + '/b.ts',
    content: 'import { flower } from "./a";\nconsole.log(flower);\n', position: { line: 1, character: 16 },
  }));
  assert.ok(definition.locations.some((item) => item.path.startsWith(directory + '/')),
    JSON.stringify(definition.locations));
  const diagnostics = await lsp(() => features.languageServices.execute(vmId, {
    action: 'diagnostics', path: directory + '/a.ts', content: 'export const flower: number = "wrong";\n',
  }));
  assert.equal(diagnostics.received, true, JSON.stringify(diagnostics));
  assert.ok(diagnostics.diagnostics.length, JSON.stringify(diagnostics));
  const preview = await lsp(() => features.languageServices.execute(vmId, {
    action: 'rename', path: directory + '/a.ts', content: source,
    position: { line: 0, character: 16 }, newName: 'petal', version: textVersion(source),
  }));
  assert.ok(preview.files.some((file) => file.path === directory + '/a.ts'));
  assert.ok(preview.files.some((file) => file.path === directory + '/b.ts'), JSON.stringify(preview.files.map((file) => file.path)));
  assert.equal(await machines.readGuestFile(vmId, directory + '/a.ts'), source);
  await features.languageServices.apply(vmId, preview.token);
  assert.match(await machines.readGuestFile(vmId, directory + '/a.ts'), /petal/);
  assert.match(await machines.readGuestFile(vmId, directory + '/b.ts'), /petal/);
  console.log(`Real ${distro}${isolated ? ' private-network' : ''} TypeScript LSP completion, definition, diagnostics and multi-file rename, plus Python diagnostics passed.`);
}, async (machines, vmId, directory) => {
  await machines.writeGuestFile(vmId, directory + '/a.ts', source, false);
  await machines.writeGuestFile(vmId, directory + '/b.ts', 'import { flower } from "./a";\nconsole.log(flower);\n', false);
  await machines.writeGuestFile(vmId, directory + '/tsconfig.json',
    '{"compilerOptions":{"module":"commonjs","target":"es2020","strict":true}}\n', false);
  await machines.writeGuestFile(vmId, directory + '/main.py', 'import os\nprint(os.path)\n', false);
});
