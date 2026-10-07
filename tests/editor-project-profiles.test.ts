/**
 * 模块职责：回归验证模块，围绕 `editor-project-profiles` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `editor-project-profiles`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: editor profiles honor saved private siblings and unreadable settings without the IDE plugin; all editor exports share the checked project endpoint and refuse a missing one.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'sakura-editor-profiles-'));
process.env.SAKURA_DATA_DIR = directory;
const { Ide } = await import('../server/ide.ts');
const { runReport } = await import('../server/capability-reports.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  await rm(directory, { recursive: true, force: true });
});
const id = '11111111-1111-4111-8111-111111111111';
const privateId = 'aabbccdd00112233';
const sharedId = 'bbccddee11223344';
const hostPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID3ujUDueum4uXp5BZPubggr+KFDQLX4clTCmmlVQreZ';
const privateProject = {
  ...projectSchema.parse({
    directory: "/workspace/editor alpha's project",
    networkIsolation: 'private',
    environment: { TOKEN: 'do-not-export-project-secret' },
  }),
  _workspace: privateId,
};
const sharedProject = { ...projectSchema.parse({ directory: '/workspace/shared' }), _workspace: sharedId };
const machines: any = {
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id, name: 'test-editor', distro: 'debian' })`）。
   * Result: Return the branch-computed value (`({ id, name: 'test-editor', distro: 'debian' })`).
   */
  get: () => ({ id, name: 'test-editor', distro: 'debian' }),
  live: new Map([[id, { sshPort: 32222 }]]),
  records: new Map(),
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`'running'`）。
   * Result: Return the branch-computed value (`'running'`).
   */
  state: () => 'running',
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  on: () => {},
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  off: () => {},
};
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: project: typeof privateProject | typeof sharedProject。
 * 结果：返回分支计算值（`({ config: async () => project, projects: { current: () => project._workspace },…`）。
 * Result: Return the branch-computed value (`({ config: async () => project, projects: { current: () => project._workspace },…`).
 */
const spacesFor = (project: typeof privateProject | typeof sharedProject) =>
  ({
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     */
    config: async () => project,
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project._workspace`）。
     * Result: Return the branch-computed value (`project._workspace`).
     */
    current: () => project._workspace },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     */
    onConfigChange: () => () => {},
  }) as any;
const savedPrivate = { ...privateProject };
delete (savedPrivate as { _workspace?: string })._workspace;
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: spaces: any; editor = 'neovim'; signal = new AbortController().signal; service: InstanceType<typeof Ide>。
 * 结果：返回分支计算值（`runReport(machines, spaces, id, 'editor-profiles', { editor }, signal, service)`）。
 * Result: Return the branch-computed value (`runReport(machines, spaces, id, 'editor-profiles', { editor }, signal, service)`).
 * 协作入口 / Collaborators: `runReport`.
 */
const report = (spaces: any, editor = 'neovim', signal = new AbortController().signal, service?: InstanceType<typeof Ide>) =>
  runReport(machines, spaces, id, 'editor-profiles', { editor }, signal, service);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: editor profiles honor saved private siblings and unreadable settings without the IDE plugin
 * 协作入口 / Collaborators: `mkdir`, `vmDir`, `join`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(report(spacesFor(privateProject)), /启用 IDE 插件/)`; `assert.rejects(report(spacesFor(sharedProject)), /启用 IDE 插件/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('editor profiles honor saved private siblings and unreadable settings without the IDE plugin', async () => {
  await mkdir(vmDir(id), { recursive: true });
  const saved = join(vmDir(id), `project-${privateId}.json`);
  try {
    await assert.rejects(report(spacesFor(privateProject)), /启用 IDE 插件/);
    await writeFile(saved, JSON.stringify(savedPrivate));
    await assert.rejects(report(spacesFor(sharedProject)), /启用 IDE 插件/);
    await writeFile(saved, '{invalid');
    await assert.rejects(report(spacesFor(sharedProject)), /启用 IDE 插件/);
  } finally {
    await rm(saved, { force: true });
  }
  await assert.rejects(report(spacesFor(sharedProject)), /启用 IDE 插件/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all editor exports share the checked project endpoint and refuse a missing one
 * 状态影响 / State effects: `(ide as any).projectSsh`, `endpoint`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `spacesFor`, `join`, `vmDir`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(report(spaces, 'neovim', undefined, ide), /先在项目页配置/)`; `assert.equal(checked, privateProject)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('all editor exports share the checked project endpoint and refuse a missing one', async () => {
  const spaces = spacesFor(privateProject),
    ide = new Ide(machines, spaces, join(directory, 'ssh-client'));
  let endpoint: object | null = null,
    checked: unknown;
  const identity = join(vmDir(id), 'project-ssh', privateId, 'id_rsa');
  (ide as any).projectSsh = {
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _id: string; project: unknown; signal: AbortSignal。
     * 结果：返回分支计算值（`endpoint`），以 Promise 交付。
     * Result: Return the branch-computed value (`endpoint`) through a Promise.
     * 验证场景 / Scenario: all editor exports share the checked project endpoint and refuse a missing one
     * 状态影响 / State effects: `checked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `signal.throwIfAborted`.
     */
    endpoint: async (_id: string, project: unknown, signal: AbortSignal) => {
      signal.throwIfAborted();
      checked = project;
      return endpoint;
    },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: all editor exports share the checked project endpoint and refuse a missing one
     */
    close: async () => {},
  };
  try {
    await assert.rejects(report(spaces, 'neovim', undefined, ide), /先在项目页配置/);
    const knownHosts = join(vmDir(id), 'project-ssh', privateId, 'known_hosts');
    await mkdir(dirname(knownHosts), { recursive: true });
    await writeFile(knownHosts, `sakura-${id}-${privateId} ${hostPublicKey}\n`);
    endpoint = {
      port: 43333,
      identity,
      hostPublicKey,
      knownHosts,
      hostKeyAlias: `sakura-${id}-${privateId}`,
    };
    for (const editor of ['jetbrains', 'neovim', 'vscode']) {
      const value = await report(spaces, editor, undefined, ide);
      assert.equal(checked, privateProject);
      assert.equal(value.editor, editor);
      assert.equal(value.projectScoped, true);
      assert.equal(value.projectId, privateId);
      assert.equal(value.networkIsolation, 'private');
      assert.equal(value.port, 43333);
      assert.equal(value.identityFile, identity);
      if (editor === 'jetbrains') {
        assert.equal(value.hostKeyVerification, 'project-and-endpoint');
        assert.equal(value.knownHostsFile, join(dirname(knownHosts), 'known_hosts.jetbrains'));
        assert.equal(
          await readFile(String(value.knownHostsFile), 'utf8'),
          `sakura-${id}-${privateId} ${hostPublicKey}\n[127.0.0.1]:43333 ${hostPublicKey}\n`,
        );
        assert.match(String(value.instructions), /Gateway 不支持 HostKeyAlias/);
        assert.match(String(value.instructions), /\*_VM_OPTIONS/);
        assert.match(String(value.instructions), /默认任意 Gateway 下载\/启动未验证/);
        assert.match(contentFor(value), /GlobalKnownHostsFile none\n  IdentityAgent none/);
        assert.match(contentFor(value), /PasswordAuthentication no\n  KbdInteractiveAuthentication no/);
      } else assert.equal(value.knownHostsFile, knownHosts);
      const content = (value.download as any).content;
      assert.match(content, /StrictHostKeyChecking yes/);
      assert.match(content, /ForwardAgent no\n  ProxyCommand none\n  ProxyJump none/);
      assert.match(content, new RegExp('HostKeyAlias sakura-' + id + '-' + privateId));
      assert.ok(!content.includes('32222'));
      assert.ok(!JSON.stringify(value).includes('do-not-export-project-secret'));
      assert.equal(value.remotePath, `scp://sakura-${id}-${privateId}//workspace/editor alpha's project/`);
    }
    await writeFile(knownHosts, 'untrusted changed binding\n');
    await assert.rejects(report(spaces, 'jetbrains', undefined, ide), /主机公钥绑定已变化/);
    await writeFile(knownHosts, `sakura-${id}-${privateId} ${hostPublicKey}\n`);
    endpoint = { ...(endpoint as object), port: 43335 };
    const refreshed = await report(spaces, 'jetbrains', undefined, ide);
    const pin = await readFile(String(refreshed.knownHostsFile), 'utf8');
    assert.match(pin, /\[127\.0\.0\.1\]:43335 /);
    assert.ok(!pin.includes(':43333 '), 'old endpoint pin must be replaced after a new bridge port');
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(report(spaces, 'neovim', abort.signal, ide));
  } finally {
    await ide.close();
  }
  await assert.rejects(report(spaces), /启用 IDE 插件/);
});

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: value: Record<string, unknown>。
 * 结果：返回分支计算值（`(value.download as { content: string }).content`）。
 * Result: Return the branch-computed value (`(value.download as { content: string }).content`).
 */
function contentFor(value: Record<string, unknown>) {
  return (value.download as { content: string }).content;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a host-network project exports its own SSH service even without private siblings
 * 状态影响 / State effects: `(ide as any).projectSsh`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `spacesFor`, `join`, `report`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(checked, sharedProject)`; `assert.equal(value.projectId, sharedId)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('a host-network project exports its own SSH service even without private siblings', async () => {
  const spaces = spacesFor(sharedProject),
    ide = new Ide(machines, spaces, join(directory, 'shared-client'));
  let checked: unknown;
  (ide as any).projectSsh = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; project: unknown。
     * 结果：返回受控对象，公开字段包括 `port, identity, knownHosts, hostKeyAlias`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `port, identity, knownHosts, hostKeyAlias`; the actual branch determines its shape.
     * 验证场景 / Scenario: a host-network project exports its own SSH service even without private siblings
     * 状态影响 / State effects: `checked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `join`, `vmDir`.
     */
    endpoint: async (_id: string, project: unknown) => {
      checked = project;
      return {
        port: 43334,
        identity: join(vmDir(id), 'project-ssh', sharedId, 'id_rsa'),
        knownHosts: join(vmDir(id), 'project-ssh', sharedId, 'known_hosts'),
        hostKeyAlias: `sakura-${id}-${sharedId}`,
      };
    },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: a host-network project exports its own SSH service even without private siblings
     */
    close: async () => {},
  };
  try {
    const value = await report(spaces, 'neovim', undefined, ide);
    assert.equal(checked, sharedProject);
    assert.equal(value.projectId, sharedId);
    assert.equal(value.networkIsolation, 'host');
    assert.equal(value.projectScoped, true);
    assert.equal(value.port, 43334);
  } finally {
    await ide.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends
 * 状态影响 / State effects: `(ide as any).projectSsh`, `endpoint`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `spacesFor`, `join`, `ide.view`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(view.supported, true)`; `assert.equal(view.vscodeSupported, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends', async () => {
  const alpine = { ...machines, /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id, name: 'test-editor', distro: 'alpine' })`）。
   * Result: Return the branch-computed value (`({ id, name: 'test-editor', distro: 'alpine' })`).
   * 验证场景 / Scenario: Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends
   */
  get: () => ({ id, name: 'test-editor', distro: 'alpine' }) };
  const spaces = spacesFor(privateProject),
    ide = new Ide(alpine, spaces, join(directory, 'alpine-client'));
  let endpoint: object | null = null;
  (ide as any).projectSsh = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ present: false, running: false, valid: false, processes: 0, reason: null })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ present: false, running: false, valid: false, processes: 0, reason: null })`) through a Promise.
     * 验证场景 / Scenario: Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends
     */
    status: async () => ({ present: false, running: false, valid: false, processes: 0, reason: null }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`endpoint`），以 Promise 交付。
     * Result: Return the branch-computed value (`endpoint`) through a Promise.
     * 验证场景 / Scenario: Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends
     */
    endpoint: async () => endpoint,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 验证场景 / Scenario: Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends
     */
    entries: async () => [],
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: Alpine project profiles require a checked SSH endpoint and refuse unsupported IDE backends
     */
    close: async () => {},
  };
  try {
    const view = await ide.view(id);
    assert.equal(view.supported, true);
    assert.equal(view.vscodeSupported, false);
    assert.equal(view.projectScoped, true);
    assert.equal(view.command, '');
    assert.equal(view.url, '');
    assert.equal(view.sshCommand, '');
    await assert.rejects(
      runReport(alpine, spaces, id, 'editor-profiles', { editor: 'neovim' }, new AbortController().signal, ide),
      /先在项目页配置/,
    );
    endpoint = {
      port: 43335,
      identity: join(vmDir(id), 'project-ssh', privateId, 'id_rsa'),
      knownHosts: join(vmDir(id), 'project-ssh', privateId, 'known_hosts'),
      hostKeyAlias: `sakura-${id}-${privateId}`,
    };
    const connected = await ide.view(id);
    assert.equal(connected.sshCommand, `ssh sakura-${id}-${privateId}`);
    assert.equal(connected.command, '');
    assert.equal(connected.url, '');
    const profile = await runReport(
      alpine,
      spaces,
      id,
      'editor-profiles',
      { editor: 'neovim' },
      new AbortController().signal,
      ide,
    );
    assert.equal(profile.projectScoped, true);
    assert.equal(profile.port, 43335);
    assert.match((profile.download as any).content, /StrictHostKeyChecking yes/);
    assert.ok(!(profile.download as any).content.includes('32222'));
    assert.match(String(profile.instructions), /packadd netrw/);
    assert.equal(profile.relativeRemotePath, `scp://sakura-${id}-${privateId}/./`);
    for (const editor of ['vscode', 'jetbrains'])
      await assert.rejects(
        runReport(alpine, spaces, id, 'editor-profiles', { editor }, new AbortController().signal),
        /Debian 或 Ubuntu/,
      );
  } finally {
    await ide.close();
  }
});
