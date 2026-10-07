/**
 * 模块职责：回归验证模块，围绕 `dependency-downloads` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `dependency-downloads`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: download authentication accepts only named secrets and a fixed HTTPS or loopback endpoint; prefetch resolves only its separately applied download credential, without project secret resolution.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'sakura-dependency-auth-test-'));
process.env.SAKURA_DATA_DIR = root;
const { dependencyDownloadsSchema, resolveDependencyAuthentication, withDependencyAuthentication } =
  await import('../server/dependency-downloads.ts');
const { networkSchema, networkEnvironment } = await import('../server/network-profiles.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { Machines } = await import('../server/machines.ts');
const { projectDependencyCacheScript } = await import('../server/project-dependency-cache.ts');
after(async () => {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  await rm(root, { recursive: true, force: true });
});

const config = {
  npm: { kind: 'bearer' as const, endpoint: 'https://packages.example.com/npm/', tokenSecret: 'npm-read' },
  pip: {
    kind: 'basic' as const,
    endpoint: 'https://packages.example.com/simple/',
    username: 'reader',
    passwordSecret: 'pip-read',
  },
};

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: download authentication accepts only named secrets and a fixed HTTPS or loopback endpoint
 * 协作入口 / Collaborators: `assert.deepEqual`, `dependencyDownloadsSchema.parse`, `assert.equal`, `dependencyDownloadsSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(dependencyDownloadsSchema.parse(config), config)`; `assert.equal( dependencyDownloadsSchema.safeParse({ npm: { ...config.npm, endpoint } }).success, false, endpoint, )`.
 */
test('download authentication accepts only named secrets and a fixed HTTPS or loopback endpoint', () => {
  assert.deepEqual(dependencyDownloadsSchema.parse(config), config);
  for (const endpoint of [
    'https://user:pass@example.com/',
    'https://example.com/?token=secret',
    'https://example.com/#secret',
    'http://example.com/',
    'https://example.com/%2fsecret',
    'https://example.com/%252e%252e/secret',
    'https://example.com/%01secret',
    'https://example.com/..;/secret',
    'file:///tmp/registry',
  ])
    assert.equal(
      dependencyDownloadsSchema.safeParse({ npm: { ...config.npm, endpoint } }).success,
      false,
      endpoint,
    );
  for (const invalid of [
    { npm: { ...config.npm, token: 'plaintext' } },
    { pip: { ...config.pip, password: 'plaintext' } },
    { npm: { ...config.npm, tokenSecret: '${PROJECT_SECRET}' } },
  ])
    assert.equal(dependencyDownloadsSchema.safeParse(invalid).success, false);
  assert.equal(
    dependencyDownloadsSchema.safeParse({ npm: { ...config.npm, endpoint: 'http://127.0.0.1:8080/npm/' } })
      .success,
    true,
  );
  const profile = networkSchema.parse({ dependencyDownloads: config });
  assert.deepEqual(networkEnvironment(profile), {
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
  });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: prefetch resolves only its separately applied download credential, without project secret resolution
 * 状态影响 / State effects: `appliedAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `machines.records.set`, `new Date().toISOString`, `workspaces.dependencyDownloadAuthentication`.
 * 检查边界 / Checked boundaries: `assert.equal(npm?.authorization, 'Bearer owned-download-value')`; `assert.equal( pip?.authorization, 'Basic ' + Buffer.from('reader:owned-download-value').toString('base64'), )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('prefetch resolves only its separately applied download credential, without project secret resolution', async () => {
  const machines = new Machines({} as any, fakeVmNetwork),
    id = randomUUID();
  machines.records.set(id, { id, template: 'none' } as any);
  const calls: string[] = [];
  let appliedAt: string | undefined = new Date().toISOString();
  const workspaces = new Workspaces(machines, {
    network: { /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ config: { dependencyDownloads: config }, appliedAt })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ config: { dependencyDownloads: config }, appliedAt })`) through a Promise.
     * 验证场景 / Scenario: prefetch resolves only its separately applied download credential, without project secret resolution
     */
    state: async () => ({ config: { dependencyDownloads: config }, appliedAt }) } as any,
    secrets: {
      /**
       * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
       * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
       * 输入 / Inputs: _id: string; name: string。
       * 结果：返回分支计算值（`'owned-download-value'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'owned-download-value'`) through a Promise.
       * 验证场景 / Scenario: prefetch resolves only its separately applied download credential, without project secret resolution
       * 协作入口 / Collaborators: `calls.push`.
       */
      value: async (_id: string, name: string) => {
        calls.push(name);
        return 'owned-download-value';
      },
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: prefetch resolves only its separately applied download credential, without project secret resolution
       * 失败 / Failure: `new Error('must not resolve project secrets')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      resolve: async () => {
        throw new Error('must not resolve project secrets');
      },
    } as any,
  });
  try {
    const npm = await workspaces.dependencyDownloadAuthentication(id, 'npm');
    assert.equal(npm?.authorization, 'Bearer owned-download-value');
    const pip = await workspaces.dependencyDownloadAuthentication(id, 'pip');
    assert.equal(
      pip?.authorization,
      'Basic ' + Buffer.from('reader:owned-download-value').toString('base64'),
    );
    assert.deepEqual(calls, ['npm-read', 'pip-read']);
    appliedAt = undefined;
    assert.equal(await workspaces.dependencyDownloadAuthentication(id, 'npm'), undefined);
    assert.deepEqual(calls, ['npm-read', 'pip-read']);
    await assert.rejects(resolveDependencyAuthentication(id, config.npm), /私密配置插件/);
    await assert.rejects(
      resolveDependencyAuthentication(id, config.npm, {
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`'token\r\nAuthorization: bad'`），以 Promise 交付。
         * Result: Return the branch-computed value (`'token\r\nAuthorization: bad'`) through a Promise.
         * 验证场景 / Scenario: prefetch resolves only its separately applied download credential, without project secret resolution
         */
        value: async () => 'token\r\nAuthorization: bad',
      } as any),
      /不支持的字符/,
    );
    const canonical = await resolveDependencyAuthentication(
      id,
      { ...config.npm, endpoint: 'https://PACKAGES.example.com:443/npm/' },
      { /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'owned-download-value'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'owned-download-value'`) through a Promise.
       * 验证场景 / Scenario: prefetch resolves only its separately applied download credential, without project secret resolution
       */
      value: async () => 'owned-download-value' } as any,
    );
    assert.equal(canonical.endpoint, config.npm.endpoint);
    await assert.rejects(
      resolveDependencyAuthentication(id, config.pip, {
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`'多字节'.repeat(2048)`），以 Promise 交付。
         * Result: Return the branch-computed value (`'多字节'.repeat(2048)`) through a Promise.
         * 验证场景 / Scenario: prefetch resolves only its separately applied download credential, without project secret resolution
         * 协作入口 / Collaborators: `'多字节'.repeat`.
         */
        value: async () => '多字节'.repeat(2048),
      } as any),
      /超过认证下载器支持的长度/,
    );
  } finally {
    await workspaces.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation
 * 协作入口 / Collaborators: `resolveDependencyAuthentication`, `withDependencyAuthentication`, `assert.equal`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.equal(await pending, 'done')`; `assert.rejects(pending)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation', async () => {
  const authentication = await resolveDependencyAuthentication('vm', config.npm, {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'owned-value-never-command'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'owned-value-never-command'`) through a Promise.
     * 验证场景 / Scenario: credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation
     */
    value: async () => 'owned-value-never-command',
  } as any);
  for (const outcome of ['success', 'failure', 'cancel']) {
    const commands: string[] = [],
      files = new Map<string, string>();
    const abort = new AbortController(),
      instance = {};
    const machines = {
      live: new Map([['vm', instance]]),
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _id: string; command: string。
       * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
       * 验证场景 / Scenario: credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation
       * 协作入口 / Collaborators: `commands.push`, `command.includes`.
       */
      exec: async (_id: string, command: string) => {
        commands.push(command);
        return {
          code: 0,
          stdout: command.includes('mktemp') ? '/run/sakura-dependency-auth.abcdef123456\n' : '',
          stderr: '',
        };
      },
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; work: Function。
       * 结果：返回分支计算值（`work({ createWriteStream: (path: string, options: any) => { assert.deepEqual(opt…`），以 Promise 交付。
       * Result: Return the branch-computed value (`work({ createWriteStream: (path: string, options: any) => { assert.deepEqual(opt…`) through a Promise.
       * 验证场景 / Scenario: credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation
       * 协作入口 / Collaborators: `work`.
       */
      sftp: async (_id: string, work: Function) =>
        work({
          /**
           * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
           * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
           * 输入 / Inputs: path: string; options: any。
           * 结果：返回分支计算值（`new Writable({ write(chunk, _encoding, next) { files.set(path, (files.get(path) …`）。
           * Result: Return the branch-computed value (`new Writable({ write(chunk, _encoding, next) { files.set(path, (files.get(path) …`).
           * 验证场景 / Scenario: credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation
           * 协作入口 / Collaborators: `assert.deepEqual`.
           * 检查边界 / Checked boundaries: `assert.deepEqual(options, { flags: 'wx', mode: 0o600 })`.
           */
          createWriteStream: (path: string, options: any) => {
            assert.deepEqual(options, { flags: 'wx', mode: 0o600 });
            return new Writable({
              /**
               * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
               * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
               * 输入 / Inputs: chunk; _encoding; next。
               * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
               * Result: No explicit result value; callers observe completion, state changes or an exception.
               * 验证场景 / Scenario: credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation
               * 协作入口 / Collaborators: `files.set`, `files.get`, `next`.
               */
              write(chunk, _encoding, next) {
                files.set(path, (files.get(path) || '') + chunk);
                next();
              },
            });
          },
        }),
    } as any;
    const pending = withDependencyAuthentication(
      machines,
      'vm',
      authentication,
      abort.signal,
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: paths。
       * 结果：返回分支计算值（`'done'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'done'`) through a Promise.
       * 验证场景 / Scenario: credentials use exclusive 0600 SFTP files and are cleaned on success, error and cancellation
       * 失败 / Failure: `new Error('owned failure')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `assert.equal`, `JSON.parse`, `files.get`, `projectDependencyCacheScript`.
       * 检查边界 / Checked boundaries: `assert.equal( JSON.parse(files.get(paths.credentialFile)!).authorization, authentication.authorization, )`; `assert.ok(!script.includes('owned-value-never-command'))`.
       */
      async (paths) => {
        assert.equal(
          JSON.parse(files.get(paths.credentialFile)!).authorization,
          authentication.authorization,
        );
        const script = projectDependencyCacheScript(
          '/workspace/project',
          'default',
          'npm',
          'prefetch-dependencies',
          {},
          paths,
        );
        assert.ok(!script.includes('owned-value-never-command'));
        assert.match(script, /python3 -I .*broker\.py/);
        if (outcome === 'failure') throw new Error('owned failure');
        if (outcome === 'cancel') {
          abort.abort();
          abort.signal.throwIfAborted();
        }
        return 'done';
      },
    );
    if (outcome === 'success') assert.equal(await pending, 'done');
    else await assert.rejects(pending);
    assert.match(commands.at(-1)!, /rmdir --/);
    assert.ok(commands.every((command) => !command.includes('owned-value-never-command')));
  }
  assert.throws(
    () =>
      projectDependencyCacheScript(
        '/workspace',
        'default',
        'npm',
        'prefetch-dependencies',
        {},
        { credentialFile: '/tmp/arbitrary', brokerFile: '/tmp/owned.py' },
      ),
    /临时路径/,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: real Python mirror enforces origin, redirect, metadata and non-reflection constraints
 * 协作入口 / Collaborators: `spawnSync`, `resolve`, `assert.equal`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)`; `assert.match(result.stderr, /Ran 10 tests/)`.
 */
test('real Python mirror enforces origin, redirect, metadata and non-reflection constraints', () => {
  const python = process.env.SAKURA_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(
    python,
    ['-I', '-B', 'tests/dependency-download-broker.test.py', resolve('server/dependency-download-broker.py')],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
      env: { ...process.env, SAKURA_BROKER_TEST_ROOT: root },
    },
  );
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 10 tests/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost preparation receipts and transient cleanup failures retain exact ownership
 * 协作入口 / Collaborators: `resolveDependencyAuthentication`, `withDependencyAuthentication`, `assert.rejects`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /abort/i)`; `assert.equal(writes, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost preparation receipts and transient cleanup failures retain exact ownership', async () => {
  const authentication = await resolveDependencyAuthentication('vm', config.npm, {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'owned-download-value'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'owned-download-value'`) through a Promise.
     * 验证场景 / Scenario: lost preparation receipts and transient cleanup failures retain exact ownership
     */
    value: async () => 'owned-download-value',
  } as any);
  for (const fault of ['lost-mkdir', 'transient-cleanup', 'persistent-cleanup', 'new-boot']) {
    const commands: string[] = [];
    const instance = {},
      live = new Map<string, object>([['vm', instance]]);
    let cleanupAttempts = 0,
      writes = 0;
    const abort = new AbortController();
    const machines = {
      live,
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _id: string; command: string。
       * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
       * 验证场景 / Scenario: lost preparation receipts and transient cleanup failures retain exact ownership
       * 失败 / Failure: `abort.signal.reason`; `new Error('owned control connection failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `commands.push`, `assert.match`, `abort.abort`.
       * 检查边界 / Checked boundaries: `assert.match(command, /mkdir -m 700 -- '\/run\/sakura-dependency-auth\.[a-f0-9]{32}'/)`.
       * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
       * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
       */
      exec: async (_id: string, command: string) => {
        commands.push(command);
        if (commands.length === 1) {
          assert.match(command, /mkdir -m 700 -- '\/run\/sakura-dependency-auth\.[a-f0-9]{32}'/);
          if (fault === 'lost-mkdir') {
            abort.abort();
            throw abort.signal.reason;
          }
        } else {
          cleanupAttempts++;
          if (fault === 'persistent-cleanup' || (fault === 'transient-cleanup' && cleanupAttempts === 1))
            throw new Error('owned control connection failed');
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; work: Function。
       * 结果：返回分支计算值（`work({ createWriteStream: () => new Writable({ write(_chunk, _encoding, next) { …`），以 Promise 交付。
       * Result: Return the branch-computed value (`work({ createWriteStream: () => new Writable({ write(_chunk, _encoding, next) { …`) through a Promise.
       * 验证场景 / Scenario: lost preparation receipts and transient cleanup failures retain exact ownership
       * 协作入口 / Collaborators: `work`.
       */
      sftp: async (_id: string, work: Function) =>
        work({
          /**
           * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
           * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
           * 输入 / Inputs: 无 / none。
           * 结果：返回分支计算值（`new Writable({ write(_chunk, _encoding, next) { writes++; next(); }, })`）。
           * Result: Return the branch-computed value (`new Writable({ write(_chunk, _encoding, next) { writes++; next(); }, })`).
           * 验证场景 / Scenario: lost preparation receipts and transient cleanup failures retain exact ownership
           */
          createWriteStream: () =>
            new Writable({
              /**
               * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
               * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
               * 输入 / Inputs: _chunk; _encoding; next。
               * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
               * Result: No explicit result value; callers observe completion, state changes or an exception.
               * 验证场景 / Scenario: lost preparation receipts and transient cleanup failures retain exact ownership
               * 协作入口 / Collaborators: `next`.
               */
              write(_chunk, _encoding, next) {
                writes++;
                next();
              },
            }),
        }),
    } as any;
    const pending = withDependencyAuthentication(machines, 'vm', authentication, abort.signal, async () => {
      if (fault === 'new-boot') live.set('vm', {});
      return 'done';
    });
    if (fault === 'lost-mkdir') {
      await assert.rejects(pending, /abort/i);
      assert.equal(writes, 0);
      assert.equal(cleanupAttempts, 1);
      assert.ok(!commands.at(-1)!.includes('rm -f'));
    } else if (fault === 'persistent-cleanup') {
      await assert.rejects(pending, /临时目录未能清理/);
      assert.equal(cleanupAttempts, 3);
    } else {
      assert.equal(await pending, 'done');
      assert.equal(cleanupAttempts, fault === 'new-boot' ? 0 : 2);
    }
    const path = commands[0].match(/\/run\/sakura-dependency-auth\.[a-f0-9]{32}/)![0];
    assert.ok(commands.every((command) => command.includes(path)));
  }
});
