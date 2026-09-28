import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(resolve(tmpdir(), `sakura-lsp-smoke-`));
const distro = process.env.SAKURA_LSP_DISTRO === 'debian' ? 'debian' : 'alpine';
process.env.SAKURA_DATA_DIR = directory;
process.env.SAKURA_IMAGE_PATH = resolve('.data/images/alpine-3.23.qcow2');
process.env.SAKURA_IMAGE_DIR = resolve('.data/images');
const { Machines } = await import('../server/machines.ts');
const { createRuntime } = await import('../server/runtime.ts');
const { Features } = await import('../server/features.ts');
const { textVersion } = await import('../server/files.ts');
const machines = new Machines(await createRuntime());
await machines.init();
const features = await Features.create(machines, ['code-checks']);
try {
  const vm = await machines.create({ name: 'lsp-smoke', distro, memoryMiB: 1024, cpus: 2, diskGiB: 4 });
  await machines.start(vm.id);
  const deadline = Date.now() + 300000;
  while (machines.state(vm.id) !== 'running') {
    assert.ok(Date.now() < deadline && machines.state(vm.id) === 'starting', machines.logs.get(vm.id));
    await delay(300);
  }
  const mkdir = await machines.exec(vm.id, 'mkdir -p /workspace/app', 10000);
  assert.equal(mkdir.code, 0, mkdir.stderr);
  const source = 'export const flower = 1;\n';
  await machines.writeGuestFile(vm.id, '/workspace/app/a.ts', source, false);
  await machines.writeGuestFile(vm.id, '/workspace/app/b.ts', 'import { flower } from "./a";\nconsole.log(flower);\n', false);
  await machines.writeGuestFile(vm.id, '/workspace/app/tsconfig.json',
    '{"compilerOptions":{"module":"commonjs","target":"es2020","strict":true}}\n', false);
  await machines.writeGuestFile(vm.id, '/workspace/app/main.py', 'import os\nprint(os.path)\n', false);
  await features.workspaces.save(vm.id, { directory: '/workspace/app' });
  const before = await features.languageServices.status(vm.id, '/workspace/app/a.ts');
  console.log('Language server initially installed:', before.installed);
  await features.languageServices.install(vm.id);
  assert.equal((await features.languageServices.status(vm.id, '/workspace/app/a.ts')).installed, true);
  assert.equal((await features.languageServices.status(vm.id, '/workspace/app/main.py')).installed, true);
  const python = await features.languageServices.execute(vm.id, {
    action: 'diagnostics', path: '/workspace/app/main.py', content: 'import os\nprint(missing_name)\n',
  });
  assert.equal(python.received, true, JSON.stringify(python));
  assert.ok(python.diagnostics.some((item) => item.message.includes('missing_name')), JSON.stringify(python));
  const completion = await features.languageServices.execute(vm.id, {
    action: 'completion', path: '/workspace/app/b.ts',
    content: 'import { flower } from "./a";\nconsole.log(flo);\n', position: { line: 1, character: 15 },
  });
  assert.ok(completion.items.some((item) => item.label === 'flower'), JSON.stringify(completion.items.slice(0, 12)));
  const definition = await features.languageServices.execute(vm.id, {
    action: 'definition', path: '/workspace/app/b.ts',
    content: 'import { flower } from "./a";\nconsole.log(flower);\n', position: { line: 1, character: 16 },
  });
  assert.ok(definition.locations.some((item) => item.path.startsWith('/workspace/app/')),
    JSON.stringify(definition.locations));
  const diagnostics = await features.languageServices.execute(vm.id, {
    action: 'diagnostics', path: '/workspace/app/a.ts', content: 'export const flower: number = "wrong";\n',
  });
  assert.equal(diagnostics.received, true, JSON.stringify(diagnostics));
  assert.ok(diagnostics.diagnostics.length, JSON.stringify(diagnostics));
  const preview = await features.languageServices.execute(vm.id, {
    action: 'rename', path: '/workspace/app/a.ts', content: source,
    position: { line: 0, character: 16 }, newName: 'petal', version: textVersion(source),
  });
  assert.ok(preview.files.some((file) => file.path === '/workspace/app/a.ts'));
  assert.ok(preview.files.some((file) => file.path === '/workspace/app/b.ts'), JSON.stringify(preview.files.map((file) => file.path)));
  assert.equal(await machines.readGuestFile(vm.id, '/workspace/app/a.ts'), source);
  await features.languageServices.apply(vm.id, preview.token);
  assert.match(await machines.readGuestFile(vm.id, '/workspace/app/a.ts'), /petal/);
  assert.match(await machines.readGuestFile(vm.id, '/workspace/app/b.ts'), /petal/);
  console.log(`Real ${distro} TypeScript LSP completion, definition, diagnostics and multi-file rename, plus Python diagnostics passed.`);
} finally {
  await features.close();
  await machines.close();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('sakura-lsp-smoke-'));
  await rm(directory, { recursive: true, force: true });
}
