/**
 * 模块职责：回归验证模块，围绕 `project-repository` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-repository`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: first-checkout repository URLs are credential-free HTTPS or guest loopback HTTP; only an applied matching Git scope resolves its separate secret.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: first-checkout repository URLs are credential-free HTTPS or guest loopback HTTP
 * 协作入口 / Collaborators: `assert.equal`, `repositoryUrl.parse`, `projectSchema.parse`, `repositoryUrl.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(repositoryUrl.parse(value), value)`; `assert.equal(projectSchema.parse({ repository: value }).repository, value)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: only an applied matching Git scope resolves its separate secret
 * 状态影响 / State effects: `appliedAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `machines.records.set`, `new Date().toISOString`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(networkSchema.parse({ dependencyDownloads: { git: configuration } }).dependencyDownloads?.git, configuration)`; `assert.equal((await spaces.repositoryDownloadAuthentication(id, 'https://git.example.com/org/one.git'))?.authorization, 'Bearer ow…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('only an applied matching Git scope resolves its separate secret', async () => {
  const machines = new Machines({} as any, fakeVmNetwork), id = randomUUID();
  machines.records.set(id, { id, template: 'none' } as any);
  let appliedAt: string | undefined = new Date().toISOString();
  const configuration = { kind: 'bearer' as const, endpoint: 'https://git.example.com/org/', tokenSecret: 'git-reader' };
  assert.deepEqual(networkSchema.parse({ dependencyDownloads: { git: configuration } }).dependencyDownloads?.git, configuration);
  const calls: string[] = [];
  const spaces = new Workspaces(machines, { network: { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ appliedAt, config: { dependencyDownloads: { git: configuration } } })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ appliedAt, config: { dependencyDownloads: { git: configuration } } })`) through a Promise.
   * 验证场景 / Scenario: only an applied matching Git scope resolves its separate secret
   */
  state: async () => ({ appliedAt, config: { dependencyDownloads: { git: configuration } } }) } as any,
    secrets: { /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; name: string。
     * 结果：返回分支计算值（`'owned-secret'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'owned-secret'`) through a Promise.
     * 验证场景 / Scenario: only an applied matching Git scope resolves its separate secret
     * 协作入口 / Collaborators: `calls.push`.
     */
    value: async (_id: string, name: string) => { calls.push(name); return 'owned-secret'; },
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: only an applied matching Git scope resolves its separate secret
       * 失败 / Failure: `new Error('project secrets must not be resolved here')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: bundle checkout pins the default branch and object hash in a clean project command
 * 协作入口 / Collaborators: `randomUUID`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`, `'a'.repeat`.
 * 检查边界 / Checked boundaries: `assert.match(command, /GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=\/dev\/null GIT_CONFIG_GLOBAL=\/dev\/null/)`; `assert.match(command, /--branch='main'/)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: system Git broker performs real authenticated HTTP and object bundle handoff
 * 协作入口 / Collaborators: `spawnSync`, `resolve`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)`; `assert.match(result.stderr, /Ran 9 tests/)`.
 */
test('system Git broker performs real authenticated HTTP and object bundle handoff', () => {
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    ['-I', '-B', 'tests/project-repository-broker.test.py', resolve('server/project-repository-broker.py')],
    { encoding: 'utf8', windowsHide: true, timeout: 90_000, env: { ...process.env, SAKURA_BROKER_TEST_ROOT: root } });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 9 tests/);
});
