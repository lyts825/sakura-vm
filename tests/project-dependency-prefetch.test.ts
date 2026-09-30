import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-dependency-prefetch-'));
process.env.SAKURA_DATA_DIR = root;
const { npmPrefetchValidation, dependencyDownloadEnvironment, projectDependencyCacheScript } =
  await import('../server/project-dependency-cache.ts');
const { FeatureSuite } = await import('../server/feature-suite.ts');
const { Jobs } = await import('../server/jobs.ts');
after(async () => {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
});
const archive = {
  version: '7.0.0', resolved: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz',
  integrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64'),
};
const manifest = { name: 'locked-project', version: '1.0.0', dependencies: { 'is-number': '7.0.0' } };
const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3,
  packages: { '': manifest, 'node_modules/is-number': archive } };
async function validate(input: object, locked: object = lock) {
  const project = await mkdtemp(join(root, 'project-')), stage = join(project, 'stage');
  await mkdir(stage);
  await writeFile(join(project, 'package.json'), JSON.stringify(input));
  await writeFile(join(project, 'package-lock.json'), JSON.stringify(locked));
  const result = spawnSync(process.execPath, ['-e', npmPrefetchValidation, project, 'package-lock.json', stage],
    { cwd: stage, encoding: 'utf8', windowsHide: true });
  return { result, project, stage };
}

test('npm prefetch reads actual locked registry files and strips executable manifest configuration', async () => {
  const input = { ...manifest, scripts: { preinstall: 'touch shared-network-hook' },
    config: { 'node-options': '--require hook.js' }, engines: { node: '>=18' } };
  const { result, project, stage } = await validate(input);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')), manifest);
  assert.deepEqual(JSON.parse(await readFile(join(stage, 'package-lock.json'), 'utf8')), lock);
  const original = await readFile(join(project, 'package.json'));
  assert.ok((await readFile(join(stage, 'LOCKSUMS'), 'utf8')).includes(
    createHash('sha256').update(original).digest('hex') + '  package.json\n'));
});

test('npm prefetch rejects Git, URL, local and workspace dependencies before running npm', async () => {
  for (const selector of ['file:../escape', '../escape', 'git+https://github.com/example/prepare.git',
    'https://example.com/archive.tgz', 'workspace:*', 'github:example/prepare', 'npm:foo@file:../escape']) {
    const { result } = await validate({ ...manifest, dependencies: { 'is-number': selector } });
    assert.notEqual(result.status, 0, selector);
    assert.match(result.stderr, /共享预取仅支持/);
  }
  const workspace = await validate({ ...manifest, workspaces: ['../escape'] });
  assert.notEqual(workspace.result.status, 0);
});

test('npm prefetch rejects unsafe lock entries, missing integrity and credential-bearing archives', async () => {
  for (const entry of [{ ...archive, link: true }, { ...archive, integrity: undefined },
    { ...archive, version: 'git+https://github.com/example/prepare.git' },
    { ...archive, resolved: 'git+ssh://git@github.com/example/prepare.git' },
    { ...archive, resolved: 'file:/tmp/prepare' },
    { ...archive, resolved: 'https://user:secret@example.com/archive.tgz' },
    { ...archive, resolved: 'https://example.com/archive.tgz?token=secret' },
    { ...archive, dependencies: { foo: 'git+https://github.com/example/prepare.git' } }]) {
    const { result } = await validate(manifest, { ...lock, packages: { '': manifest, 'node_modules/is-number': entry } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /共享预取仅支持/);
    assert.ok(!result.stderr.includes('user:secret'));
  }
  const invalidPath = await validate(manifest,
    { ...lock, packages: { '': manifest, 'node_modules/../../escape': archive } });
  assert.notEqual(invalidPath.result.status, 0);
  const unsafeRoot = await validate(manifest,
    { ...lock, packages: { ...lock.packages, '': { dependencies: { bad: 'file:../escape' } } } });
  assert.notEqual(unsafeRoot.result.status, 0);
  const unsafeLegacy = await validate(manifest, { ...lock, lockfileVersion: 2,
    dependencies: { 'is-number': { ...archive, version: 'git+https://example.invalid/prepare.git' } } });
  assert.notEqual(unsafeLegacy.result.status, 0);
});

test('npm prefetch supports registry aliases, safe overrides, v2 and nested v1 locks', async () => {
  const aliases = await validate({ ...manifest, dependencies: { 'is-number': 'npm:is-number@^7.0.0' },
    overrides: { other: { '.': '^1.0.0', nested: '>=2.0.0 <3.0.0' } } });
  assert.equal(aliases.result.status, 0, aliases.result.stderr);
  const v2 = await validate(manifest, { ...lock, lockfileVersion: 2 });
  assert.equal(v2.result.status, 0, v2.result.stderr);
  const v1 = await validate(manifest, { name: manifest.name, version: manifest.version, lockfileVersion: 1,
    dependencies: { 'is-number': { ...archive, requires: { nested: '^7.0.0' }, dependencies: { nested: archive } } } });
  assert.equal(v1.result.status, 0, v1.result.stderr);
});

test('download environment accepts only separate mirrors and proxies', () => {
  assert.deepEqual(dependencyDownloadEnvironment({ NPM_CONFIG_REGISTRY: 'https://registry.example.com',
    HTTP_PROXY: 'http://127.0.0.1:7890', NODE_OPTIONS: '--require hook.js', TOKEN: 'secret',
    PATH: '/workspace/bin', PIP_CONFIG_FILE: '/workspace/pip.conf' }), {
    HTTP_PROXY: 'http://127.0.0.1:7890', NPM_CONFIG_REGISTRY: 'https://registry.example.com',
  });
  for (const value of ['https://user:secret@example.com', 'file:///tmp/config', 'https://example.com?token=secret'])
    assert.throws(() => dependencyDownloadEnvironment({ PIP_INDEX_URL: value }), /不能包含/);
  const pip = projectDependencyCacheScript('/workspace/project', 'default', 'pip', 'prefetch-dependencies',
    { PIP_INDEX_URL: 'https://packages.example.com/simple' });
  assert.match(pip, /exec env -i PATH=/);
  assert.match(pip, /python3 -I -m pip --isolated download/);
  assert.match(pip, /packages\.example\.com\/simple/);
});

test('shared prefetch never resolves project secrets or exports its executable environment', async () => {
  const commands: string[] = [];
  const project = { directory: '/workspace/private', networkIsolation: 'private',
    environment: { NODE_OPTIONS: '--require /workspace/private/hook.js', PYTHONPATH: '/workspace/private',
      HOME: '/workspace/private', TOKEN: 'project-secret-must-not-download' },
    secrets: { DOWNLOAD_TOKEN: 'missing-provider' } };
  const machines: any = { get: () => ({ distro: 'debian' }), live: new Map(),
    exec: async (_id: string, command: string) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; } };
  let resolved = 0;
  const spaces: any = { projects: { key: () => 'vm', current: () => 'default' }, config: async () => project,
    resolvedConfig: async () => { resolved++; throw new Error('secrets must not resolve'); },
    networkEnvironment: async () => ({ NPM_CONFIG_REGISTRY: 'https://registry.example.com' }) };
  const suite = new FeatureSuite(machines, spaces); suite.jobs = new Jobs();
  try {
    for (const manager of ['npm', 'pip'] as const) {
      suite.dev('vm', { operation: 'prefetch-dependencies', manager });
      await suite.jobs.wait('vm:dev');
      assert.equal(suite.jobs.view('vm:dev')?.status, 'done', suite.jobs.view('vm:dev')?.error);
    }
    assert.equal(resolved, 0);
    assert.equal(commands.length, 2);
    for (const command of commands) {
      assert.match(command, /exec env -i PATH=/);
      assert.ok(!command.includes('project-secret-must-not-download'));
      assert.ok(!command.includes('--require /workspace/private/hook.js'));
      assert.ok(!command.includes('export PYTHONPATH'));
    }
  } finally { await suite.close(); }
});
