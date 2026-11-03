/**
 * 模块职责：回归验证模块，围绕 `project-dependency-prefetch` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-dependency-prefetch`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: npm prefetch reads actual locked registry files and strips executable manifest configuration; npm prefetch rejects Git, URL, local and workspace dependencies before running npm.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-dependency-prefetch-'));
process.env.SAKURA_DATA_DIR = root;
const { npmPrefetchValidation, dependencyDownloadEnvironment, projectDependencyCacheScript,
  projectDependencyCachePlan, pipCachePublication } =
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
/**
 * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
 * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
 * 输入 / Inputs: input: object; locked: object = lock。
 * 结果：返回受控对象，公开字段包括 `result, project, stage`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `result, project, stage`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `mkdir`, `writeFile`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function validate(input: object, locked: object = lock) {
  const project = await mkdtemp(join(root, 'project-')), stage = join(project, 'stage');
  await mkdir(stage);
  await writeFile(join(project, 'package.json'), JSON.stringify(input));
  await writeFile(join(project, 'package-lock.json'), JSON.stringify(locked));
  const result = spawnSync(process.execPath, ['-e', npmPrefetchValidation, project, 'package-lock.json', stage],
    { cwd: stage, encoding: 'utf8', windowsHide: true });
  return { result, project, stage };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: npm prefetch reads actual locked registry files and strips executable manifest configuration
 * 协作入口 / Collaborators: `validate`, `assert.equal`, `assert.deepEqual`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.stderr)`; `assert.deepEqual(JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')), manifest)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: npm prefetch rejects Git, URL, local and workspace dependencies before running npm
 * 协作入口 / Collaborators: `validate`, `assert.notEqual`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.notEqual(result.status, 0, selector)`; `assert.match(result.stderr, /共享预取仅支持/)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: npm prefetch rejects unsafe lock entries, missing integrity and credential-bearing archives
 * 协作入口 / Collaborators: `validate`, `assert.notEqual`, `assert.match`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.notEqual(result.status, 0)`; `assert.match(result.stderr, /共享预取仅支持/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: npm prefetch supports registry aliases, safe overrides, v2 and nested v1 locks
 * 协作入口 / Collaborators: `validate`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(aliases.result.status, 0, aliases.result.stderr)`; `assert.equal(v2.result.status, 0, v2.result.stderr)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: download environment accepts only separate mirrors and proxies
 * 协作入口 / Collaborators: `assert.deepEqual`, `dependencyDownloadEnvironment`, `assert.throws`, `projectDependencyCacheScript`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(dependencyDownloadEnvironment({ NPM_CONFIG_REGISTRY: 'https://registry.example.com', HTTP_PROXY: 'http://127.0.0.…`; `assert.throws(() => dependencyDownloadEnvironment({ PIP_INDEX_URL: value }), /不能包含/)`.
 */
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

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: managed prefetch plans keep each task cleanup outside the published cache
 * 协作入口 / Collaborators: `Array.from`, `assert.equal`, `plans.map`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(new Set(plans.map(plan => plan.temporaryDirectory)).size, plans.length)`; `assert.match(plan.temporaryDirectory!, new RegExp(`^/var/cache/sakura/project-deps/default/\\.staging\\.${manager}\\.[a-f0-9]{32}$…`.
 */
test('managed prefetch plans keep each task cleanup outside the published cache', () => {
  for (const manager of ['npm', 'pip'] as const) {
    const plans = Array.from({ length: 8 }, () => projectDependencyCachePlan(
      '/workspace/project', 'default', manager, 'prefetch-dependencies'));
    assert.equal(new Set(plans.map(plan => plan.temporaryDirectory)).size, plans.length);
    for (const plan of plans) {
      assert.match(plan.temporaryDirectory!, new RegExp(`^/var/cache/sakura/project-deps/default/\\.staging\\.${manager}\\.[a-f0-9]{32}$`));
      assert.ok(plan.command.includes(plan.temporaryDirectory!));
      assert.ok(plan.cleanup!.includes(plan.temporaryDirectory!));
      assert.match(plan.command, /trap .*TERM/);
      assert.match(plan.command, /reserved/);
      assert.match(plan.cleanup!, /rmdir/);
      assert.ok(!plan.cleanup!.includes(`rm -rf -- '/var/cache/sakura/project-deps/default/${manager}'`));
      if (manager === 'pip') {
        assert.ok(plan.command.includes('RENAME_EXCHANGE'));
        assert.ok(!plan.command.includes('previous.$$'));
      }
    }
    const install = projectDependencyCachePlan('/workspace/project', 'default', manager, 'install-cached-dependencies');
    assert.equal(install.cleanup, undefined);
    assert.equal(install.temporaryDirectory, undefined);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: atomic publication refuses an unsupported host before touching any cache path
 * 协作入口 / Collaborators: `spawnSync`, `join`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 2, result.error?.message || result.stderr)`; `assert.match(result.stderr, /缓存原子发布失败/)`.
 */
test('atomic publication refuses an unsupported host before touching any cache path', () => {
  if (process.platform !== 'win32') return;
  const result = spawnSync(process.env.SAKURA_TEST_PYTHON || 'python',
    ['-X', 'utf8', '-I', '-B', '-c', pipCachePublication, join(root, 'absent-stage'), join(root, 'unchanged-cache')],
    { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 2, result.error?.message || result.stderr);
  assert.match(result.stderr, /缓存原子发布失败/);
  assert.ok(!result.stderr.includes('Traceback'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: authenticated plans accept exactly the old and host-selected protected directory shapes
 * 协作入口 / Collaborators: `assert.doesNotThrow`, `'a'.repeat`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.doesNotThrow(() => projectDependencyCachePlan('/workspace/project', 'default', 'pip', 'prefetch-dependencies', {}, { creden…`; `assert.throws(() => projectDependencyCachePlan('/workspace/project', 'default', 'pip', 'prefetch-dependencies', {}, { credentialFi…`.
 */
test('authenticated plans accept exactly the old and host-selected protected directory shapes', () => {
  for (const suffix of ['abcdef123456', '1234567890abcdef1234567890abcdef']) {
    const directory = '/run/sakura-dependency-auth.' + suffix;
    assert.doesNotThrow(() => projectDependencyCachePlan('/workspace/project', 'default', 'pip',
      'prefetch-dependencies', {}, { credentialFile: directory + '/credential.json', brokerFile: directory + '/broker.py' }));
  }
  for (const suffix of ['short', 'a'.repeat(13), 'a'.repeat(31), 'a'.repeat(33), '../owned', 'a'.repeat(31) + '/']) {
    const directory = '/run/sakura-dependency-auth.' + suffix;
    assert.throws(() => projectDependencyCachePlan('/workspace/project', 'default', 'pip',
      'prefetch-dependencies', {}, { credentialFile: directory + '/credential.json', brokerFile: directory + '/broker.py' }), /临时路径/);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
 * 状态影响 / State effects: `suite.jobs`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `suite.dev`, `suite.jobs.wait`, `assert.equal`, `suite.jobs.view`.
 * 检查边界 / Checked boundaries: `assert.equal(suite.jobs.view('vm:dev')?.status, 'done', suite.jobs.view('vm:dev')?.error)`; `assert.equal(resolved, 0)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('shared prefetch never resolves project secrets or exports its executable environment', async () => {
  const commands: string[] = [];
  const project = { directory: '/workspace/private', networkIsolation: 'private',
    environment: { NODE_OPTIONS: '--require /workspace/private/hook.js', PYTHONPATH: '/workspace/private',
      HOME: '/workspace/private', TOKEN: 'project-secret-must-not-download' },
    secrets: { DOWNLOAD_TOKEN: 'missing-provider' } };
  const machines: any = { /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ distro: 'debian' })`）。
   * Result: Return the branch-computed value (`({ distro: 'debian' })`).
   * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
   */
  get: () => ({ distro: 'debian' }), live: new Map(),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
     * 协作入口 / Collaborators: `commands.push`.
     */
    exec: async (_id: string, command: string) => { commands.push(command); return { code: 0, stdout: '', stderr: '' }; } };
  let resolved = 0;
  const spaces: any = { projects: { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'vm'`）。
   * Result: Return the branch-computed value (`'vm'`).
   * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
   */
  key: () => 'vm', /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'default'`）。
   * Result: Return the branch-computed value (`'default'`).
   * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
   */
  current: () => 'default',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; _scope: string; action: () => unknown。
     * 结果：返回分支计算值（`action()`）。
     * Result: Return the branch-computed value (`action()`).
     * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
     * 协作入口 / Collaborators: `action`.
     */
    inScope: (_id: string, _scope: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => unknown) => action() }, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
     */
    config: async () => project,
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
     * 失败 / Failure: `new Error('secrets must not resolve')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    resolvedConfig: async () => { resolved++; throw new Error('secrets must not resolve'); },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ NPM_CONFIG_REGISTRY: 'https://registry.example.com' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ NPM_CONFIG_REGISTRY: 'https://registry.example.com' })`) through a Promise.
     * 验证场景 / Scenario: shared prefetch never resolves project secrets or exports its executable environment
     */
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
