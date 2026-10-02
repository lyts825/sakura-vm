import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'sakura-repo-'));
process.env.SAKURA_DATA_DIR = root;
const { repositoryUrl, repositoryAuthorizationScope, repositoryCheckoutCommand } = await import('../server/project-repository.ts');
const { Workspaces, projectSchema } = await import('../server/workspaces.ts');
const { Machines } = await import('../server/machines.ts');
const { networkSchema } = await import('../server/network-profiles.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.match(basename(owned), /^sakura-repo-/);
  await rm(owned, { recursive: true, force: true });
});

test('first-checkout repository URLs are credential-free HTTPS or guest loopback HTTP', () => {
  for (const value of ['https://git.example.com/org/repo.git', 'http://127.0.0.1:8899/repo.git', 'http://[::1]:8899/repo.git']) {
    assert.equal(repositoryUrl.parse(value), value);
    assert.equal(projectSchema.parse({ repository: value }).repository, value);
  }
  for (const value of ['http://git.example.com/repo.git', 'https://reader:secret@git.example.com/repo.git',
    'https://git.example.com/repo.git?token=secret', 'https://git.example.com/repo.git#secret',
    'https://git.example.com/a/../secret', 'https://git.example.com/a/%2e%2e/secret',
    'https://git.example.com/%2frepo.git', 'https://git.example.com/a//b', 'https://git.example.com/%ZZ'])
    assert.equal(repositoryUrl.safeParse(value).success, false, value);
  assert.equal(repositoryAuthorizationScope('https://GIT.example.com:443/org/repo.git', 'https://git.example.com/org/'), true);
  assert.equal(repositoryAuthorizationScope('https://git.example.com/org-other/repo.git', 'https://git.example.com/org/'), false);
  assert.equal(repositoryAuthorizationScope('https://foreign.example.com/org/repo.git', 'https://git.example.com/org/'), false);
});

test('only an applied matching Git scope resolves its separate secret', async () => {
  const machines = new Machines({} as any), id = randomUUID();
  machines.records.set(id, { id, template: 'none' } as any);
  let appliedAt: string | undefined = new Date().toISOString();
  const configuration = { kind: 'bearer' as const, endpoint: 'https://git.example.com/org/', tokenSecret: 'git-reader' };
  assert.deepEqual(networkSchema.parse({ dependencyDownloads: { git: configuration } }).dependencyDownloads?.git, configuration);
  const calls: string[] = [];
  const spaces = new Workspaces(machines, { network: { state: async () => ({ appliedAt, config: { dependencyDownloads: { git: configuration } } }) } as any,
    secrets: { value: async (_id: string, name: string) => { calls.push(name); return 'owned-secret'; },
      resolve: async () => { throw new Error('project secrets must not be resolved here'); } } as any });
  try {
    assert.equal((await spaces.repositoryDownloadAuthentication(id, 'https://git.example.com/org/one.git'))?.authorization, 'Bearer owned-secret');
    assert.equal(await spaces.repositoryDownloadAuthentication(id, 'https://git.example.com/org-other/one.git'), undefined);
    assert.equal(await spaces.repositoryDownloadAuthentication(id, 'https://foreign.example.com/org/one.git'), undefined);
    appliedAt = undefined;
    assert.equal(await spaces.repositoryDownloadAuthentication(id, 'https://git.example.com/org/one.git'), undefined);
    assert.deepEqual(calls, ['git-reader']);
  } finally { await spaces.close(); }
});

test('bundle checkout pins the default branch and object hash in a clean project command', () => {
  const identityId = randomUUID();
  const identity = { version: 1 as const, phase: 'active' as const, registryId: randomUUID(), projectId: 'default', identityId,
    revision: 1, account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20000, gid: 20000,
    home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace/owned', directoryDevice: '1', directoryInode: '2',
    homeDevice: '1', homeInode: '3', networkIsolation: 'private' as const };
  const download = { version: 1 as const, head: 'refs/heads/main', commit: 'a'.repeat(40), bundleSha256: 'b'.repeat(64), bundleBytes: 1024, device: '1', inode: '55' };
  const command = repositoryCheckoutCommand('https://git.example.com/org/repo.git', '/run/sakura-repository-download.' + 'c'.repeat(32), download, identity);
  assert.match(command, /GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=\/dev\/null GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(command, /--branch='main'/);
  assert.match(command, /sha256sum/);
  assert.ok(command.includes(download.bundleSha256));
  assert.match(command, /protocol.allow=never -c protocol.file.allow=always/);
  assert.match(command, /remote set-url -- origin 'https:\/\/git.example.com\/org\/repo.git'/);
  assert.equal(command.includes('submodule update'), false);
  assert.throws(() => repositoryCheckoutCommand('https://git.example.com/repo.git', '/workspace/user', download, identity));
  assert.throws(() => repositoryCheckoutCommand('https://git.example.com/repo.git', '/run/sakura-repository-download.' + 'c'.repeat(32), { ...download, bundleSha256: null }, identity));
});

test('system Git broker performs real authenticated HTTP and object bundle handoff', () => {
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['-I', '-B', 'tests/project-repository-broker.test.py', resolve('server/project-repository-broker.py')],
    { encoding: 'utf8', windowsHide: true, timeout: 90_000, env: { ...process.env, SAKURA_BROKER_TEST_ROOT: root } });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 9 tests/);
});
