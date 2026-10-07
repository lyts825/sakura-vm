/**
 * 模块职责：回归验证模块，围绕 `x11-clipboard` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `x11-clipboard`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: X11 settings reject traversal, shell bodies, privilege bypass options and extra rule fields; X11 launch journals its owner, preserves project scope and sends environment hashes without private values.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { X11Clipboard, x11ClipboardRequest } from '../server/x11-clipboard.ts';
import { WaylandClipboard } from '../server/wayland-clipboard.ts';
import { waylandAssetNames } from '../server/wayland-clipboard-assets.ts';
import { x11AssetNames } from '../server/x11-clipboard-assets.ts';
import { desktopControlProofSchema } from '../server/desktop-project-control.ts';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { X11ClipboardSession } from '../shared/x11-clipboard.ts';

const image = '/usr/bin/editor',
  hash = 'a'.repeat(64),
  launcher = 'b'.repeat(64);
const projectId = 'abcdefabcdefabcd', identityId = '11111111-1111-4111-8111-111111111111',
  runId = '22222222-2222-4222-8222-222222222222', bootId = '33333333-3333-4333-8333-333333333333';
const identity = { version: 1 as const, phase: 'active' as const, projectId, registryId: bootId, identityId, revision: 3,
  account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20001, gid: 20001,
  home: '/var/lib/sakura-project-homes/' + identityId, directory: '/workspace/private',
  directoryDevice: '12', directoryInode: '101', homeDevice: '12', homeInode: '102', networkIsolation: 'private' as const };
const run = { version: 1 as const, phase: 'active' as const, mode: 'inherit-current' as const, projectId, registryId: bootId,
  identityId, revision: 3, runId, bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '1000',
  cgroupDevice: '29', cgroupInode: '1001', cgroupName: 'sakura-service-' + runId, namespace: 'sk-' + projectId };
const desktop = { version: 1 as const, identity, run, record: { version: 1 as const, projectId, name: 'desktop' as const,
  session: 'sakura-desktop-' + projectId, runId, bootId, scopeName: run.cgroupName, inode: run.cgroupInode,
  binding: 'b'.repeat(64), phase: 'running' as const, sessionId: '$1', paneId: '%1', panePid: 3456, paneStartTicks: '4567' },
  sha256: launcher, runtime: '/run/sakura-desktop-uid/20001/' + runId,
  endpoint: { plasmaPid: 1234, plasmaCreated: '2345', vncPid: 2345, vncCreated: '3456', runtimeDevice: '12',
    runtimeInode: '2001', xauthDevice: '12', xauthInode: '2002', xauthSha256: 'c'.repeat(64), readyDevice: '12', readyInode: '2003' } };
desktopControlProofSchema.parse({ ...desktop, build: run.build });
const rule = { ...defaultClipboardRule(), copy: false };
const sessionId = '44444444-4444-4444-8444-444444444444';
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: any; transport: 'x11' | 'wayland' = 'x11'。
 * 结果：返回受控对象，公开字段包括 `directory, assets, file, build, service, machines, secret, row, calls`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `directory, assets, file, build, service, machines, secret, row, calls`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: any, transport: 'x11' | 'wayland' = 'x11') {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-x11-clipboard-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  const assets = join(directory, 'assets'),
    file = join(directory, 'state.json');
  await mkdir(assets);
  const buildHash = createHash('sha256'),
    files = [];
  for (const name of transport === 'wayland' ? waylandAssetNames : x11AssetNames) {
    const bytes = Buffer.from(name);
    buildHash.update(name).update(bytes);
    await writeFile(join(assets, name), bytes);
    files.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const build = buildHash.digest('hex');
  await writeFile(join(assets, 'manifest.json'), JSON.stringify({ version: 1, build, files }));
  let rows: X11ClipboardSession[] = [],
    locked = false,
    failed: string[] = [],
    live = true;
  let queue = Promise.resolve();
  const calls: any[] = [], leases = { validated: 0, released: 0 };
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'debian' })`）。
     * Result: Return the branch-computed value (`({ distro: 'debian' })`).
     */
    get: () => ({ distro: 'debian' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`(live ? 'running' : 'stopped')`）。
     * Result: Return the branch-computed value (`(live ? 'running' : 'stopped')`).
     */
    state: () => (live ? 'running' : 'stopped'),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `Error('locked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `Error`.
     */
    requireUnlocked: () => {
      if (locked) throw Error('locked');
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _key: string; action: () => Promise<any>。
     * 结果：返回分支计算值（`current`）。
     * Result: Return the branch-computed value (`current`).
     * 状态影响 / State effects: `queue`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `queue.then`, `current.then`.
     */
    locked: (_key: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<any>) => {
      const current = queue.then(action);
      queue = current.then(
        () => {},
        () => {},
      );
      return current;
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; code: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 状态影响 / State effects: `request`, `output`, `row.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `code.match`, `JSON.parse`, `Buffer.from(value, 'base64').toString`, `Buffer.from`.
     * 检查边界 / Checked boundaries: `assert.equal(journal.owner, request.owner, 'owner journal must precede guest launch')`; `assert.deepEqual(expected, desktop)`.
     */
    exec: async (_id: string, code: string) => {
      const encoded = code.match(/[A-Za-z0-9+/]{64,}={0,2}/g) || [];
      let request: any;
      for (const value of encoded) {
        try {
          const decoded = JSON.parse(Buffer.from(value, 'base64').toString());
          if (decoded.action && decoded.owner) request = decoded;
        } catch {}
      }
      if (!request) return { code: 0, stdout: '', stderr: '' };
      calls.push({ request, code });
      if (failed.includes(request.action))
        return { code: 1, stdout: JSON.stringify({ error: 'injected native failure' }), stderr: '' };
      let output: unknown;
      if (request.action === 'list') output = { ready: true, build, sessions: rows };
      if (request.action === 'identify') output = { image, sha256: hash };
      if (request.action === 'configure') {
        const row = rows.find((item) => item.id === request.id)!;
        Object.assign(row, { active: request.enabled, generation: request.generation, rule: request.rule });
        output = row;
      }
      if (request.action === 'launch') {
        const journal = JSON.parse(await readFile(file, 'utf8'));
        assert.equal(journal.owner, request.owner, 'owner journal must precede guest launch');
        const row = {
          id: request.id,
          state: 'running',
          image,
          sha256: hash,
          projectId: request.projectId,
          directory: request.directory,
          desktopOwner: { projectId, uid: identity.uid, runId },
          applicationOwner: { uid: transport === 'wayland' ? 12345 : identity.uid,
            kind: transport === 'wayland' ? 'window-sandbox' : 'project-desktop' },
          active: true,
          compatible: true,
          generation: request.generation,
          rule: request.rule,
          blockedCopy: 2,
          blockedPaste: 0,
          processes: [{ pid: 7654, created: '456', image, loaded: true }],
        } as X11ClipboardSession;
        rows.push(row);
        output = row;
      }
      if (request.action === 'stop') {
        const row = rows.find((item) => item.id === request.id);
        if (row) row.state = 'stopped';
        output = { stopped: true };
      }
      if (request.action === 'stop-desktop') {
        const expected = { ...request.desktop, record: { ...request.desktop.record, phase: 'running' } };
        assert.deepEqual(expected, desktop);
        const selected = rows.filter(row => row.desktopOwner?.runId === request.desktop.run.runId);
        for (const row of selected) row.state = 'stopped';
        output = { stopped: true, sessions: selected.map(row => row.id) };
      }
      return { code: 0, stdout: JSON.stringify(output), stderr: '' };
    },
  } as unknown as Machines;
  const secret = 'unit-project-private-value';
  const Service = transport === 'wayland' ? WaylandClipboard : X11Clipboard;
  const service = new Service(
    machines,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ desktop, validate: async () => { ++leases.validated; }, release: async () => …`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ desktop, validate: async () => { ++leases.validated; }, release: async () => …`) through a Promise.
     */
    async () => ({
      desktop,
      /**
       * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
       * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      validate: async () => { ++leases.validated; },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      release: async () => { ++leases.released; },
      project: {
        directory: '/workspace/private',
        template: 'none',
        repository: '',
        setup: '',
        command: '',
        networkIsolation: 'private',
        _workspace: 'abcdefabcdefabcd',
        environment: { TOKEN: secret, LD_PRELOAD: 'foreign', DISPLAY: ':99' },
      },
    }),
    { assets, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`file`）。
     * Result: Return the branch-computed value (`file`).
     */
    file: () => file, jobsDirectory: join(directory, 'jobs') },
  );
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ id: sessionId, state: 'running', image, sha256: hash, active: true, rule: def…`）。
   * Result: Return the branch-computed value (`({ id: sessionId, state: 'running', image, sha256: hash, active: true, rule: def…`).
   * 协作入口 / Collaborators: `defaultClipboardRule`.
   */
  const row = (): X11ClipboardSession => ({
    id: sessionId,
    state: 'running',
    image,
    sha256: hash,
    active: true,
    rule: defaultClipboardRule(),
    compatible: true,
    blockedCopy: 1,
    blockedPaste: 0,
  });
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: version = 1。
   * 结果：返回分支计算值（`service.action('vm', { action: 'save', version, application: { image, sha256: ha…`），以 Promise 交付。
   * Result: Return the branch-computed value (`service.action('vm', { action: 'save', version, application: { image, sha256: ha…`) through a Promise.
   * 协作入口 / Collaborators: `service.action`.
   */
  const save = async (version = 1) =>
    service.action('vm', {
      action: 'save',
      version,
      application: { image, sha256: hash, rule },
    }) as Promise<any>;
  return {
    directory,
    assets,
    file,
    build,
    service,
    machines,
    secret,
    row,
    calls,
    leases,
    save,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: X11ClipboardSession[]。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `rows`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    rows: (value: X11ClipboardSession[]) => {
      rows = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `locked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    lock: () => {
      locked = true;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string | string[]。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `failed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `Array.isArray`.
     */
    fail: (value: string | string[]) => {
      failed = Array.isArray(value) ? value : value ? [value] : [];
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `live`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    stopVm: () => {
      live = false;
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 settings reject traversal, shell bodies, privilege bypass options and extra rule fields
 * 协作入口 / Collaborators: `assert.equal`, `x11ClipboardRequest.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(x11ClipboardRequest.safeParse({ action: 'identify', image: value }).success, false)`; `assert.equal( x11ClipboardRequest.safeParse({ action: 'launch', version: 1, image, args: ['line\ncommand'] }).success, false, )`.
 */
test('X11 settings reject traversal, shell bodies, privilege bypass options and extra rule fields', () => {
  for (const value of ['/usr/bin/../editor', '//usr/bin/editor', '/usr/bin/editor/', 'editor'])
    assert.equal(x11ClipboardRequest.safeParse({ action: 'identify', image: value }).success, false);
  assert.equal(
    x11ClipboardRequest.safeParse({ action: 'launch', version: 1, image, args: ['line\ncommand'] }).success,
    false,
  );
  assert.equal(
    x11ClipboardRequest.safeParse({ action: 'launch', version: 1, image, networkIsolation: 'host' }).success,
    false,
  );
  assert.equal(
    x11ClipboardRequest.safeParse({
      action: 'save',
      version: 1,
      application: { image, sha256: hash, rule: { ...rule, preload: false } },
    }).success,
    false,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 launch journals its owner, preserves project scope and sends environment hashes without private values
 * 协作入口 / Collaborators: `fixture`, `f.save`, `f.service.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(started.state, 'running')`; `assert.deepEqual(launch.request.desktop, desktop)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('X11 launch journals its owner, preserves project scope and sends environment hashes without private values', async (t) => {
  const f = await fixture(t);
  await f.save();
  const started = (await f.service.action('vm', {
    action: 'launch',
    version: 2,
    image,
    args: ['--name', 'space & $()'],
  })) as any;
  assert.equal(started.state, 'running');
  const launch = f.calls.find((call) => call.request.action === 'launch');
  assert.deepEqual(launch.request.desktop, desktop);
  assert.equal(launch.request.launcherSha256, undefined);
  assert.match(launch.code, /env -i PATH=/);
  assert.equal(launch.request.projectId, 'abcdefabcdefabcd');
  assert.equal(launch.request.networkNamespace, 'sk-abcdefabcdefabcd');
  assert.ok(launch.code.includes('ip netns exec sk-abcdefabcdefabcd'));
  assert.ok(!launch.code.includes('ip netns exec sk-abcdefabcdefabcd sh -lc'));
  assert.deepEqual(launch.request.environment, {
    TOKEN: createHash('sha256').update(f.secret).digest('hex'),
  });
  assert.ok(!JSON.stringify(launch.request).includes(f.secret));
  assert.deepEqual(launch.request.args, ['--name', 'space & $()']);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 live tightening survives service reload and removal explicitly disables existing agents
 * 协作入口 / Collaborators: `fixture`, `f.rows`, `f.row`, `f.save`.
 * 检查边界 / Checked boundaries: `assert.equal(saved.sessions[0].rule.copy, false)`; `assert.equal(f.calls.filter((call) => call.request.action === 'stop').length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('X11 live tightening survives service reload and removal explicitly disables existing agents', async (t) => {
  const f = await fixture(t);
  f.rows([f.row()]);
  const saved = await f.save();
  assert.equal(saved.sessions[0].rule.copy, false);
  const owner = JSON.parse(await readFile(f.file, 'utf8')).owner;
  await f.service.close();
  assert.equal(f.calls.filter((call) => call.request.action === 'stop').length, 0);
  const restored = new X11Clipboard(
    f.machines,
    async () => {
      throw Error('not used');
    },
    { assets: f.assets, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`f.file`）。
     * Result: Return the branch-computed value (`f.file`).
     * 验证场景 / Scenario: X11 live tightening survives service reload and removal explicitly disables existing agents
     */
    file: () => f.file, jobsDirectory: join(f.directory, 'reload-jobs') },
  );
  t.after(() => restored.close());
  assert.equal((await restored.view('vm')).sessions[0].state, 'running');
  assert.equal(f.calls.at(-1).request.owner, owner);
  const removed = (await restored.action('vm', { action: 'remove', version: 2, image })) as any;
  assert.equal(removed.applications.length, 0);
  assert.equal(removed.sessions[0].active, false);
  assert.equal(f.calls.findLast((call) => call.request.action === 'configure').request.enabled, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 failed native updates remain visible and refresh retries the saved intent
 * 协作入口 / Collaborators: `fixture`, `f.rows`, `f.row`, `f.fail`.
 * 检查边界 / Checked boundaries: `assert.equal(saved.version, 2)`; `assert.equal(saved.sessions[0].state, 'error')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('X11 failed native updates remain visible and refresh retries the saved intent', async (t) => {
  const f = await fixture(t);
  f.rows([f.row()]);
  f.fail('configure');
  const saved = await f.save();
  assert.equal(saved.version, 2);
  assert.equal(saved.sessions[0].state, 'error');
  assert.ok(saved.error.includes('failure'));
  f.fail('');
  const refreshed = (await f.service.action('vm', { action: 'refresh' })) as any;
  assert.equal(refreshed.sessions[0].state, 'running');
  assert.equal(refreshed.sessions[0].rule.copy, false);
  await assert.rejects(f.save(), /配置已变化/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Wayland broker service journals a distinct owner, project binding and literal arguments
 * 协作入口 / Collaborators: `fixture`, `f.save`, `f.service.action`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(started.state, 'running')`; `assert.match(launch.code, /sakura-wayland-clipboard/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Wayland broker service journals a distinct owner, project binding and literal arguments', async (t) => {
  const f = await fixture(t, 'wayland');
  await f.save();
  const started = await f.service.action('vm', { action: 'launch', version: 2, image,
    args: ['--name', 'space & $()'] }) as any;
  assert.equal(started.state, 'running');
  const launch = f.calls.find(call => call.request.action === 'launch');
  assert.match(launch.code, /sakura-wayland-clipboard/);
  assert.equal(launch.request.projectId, 'abcdefabcdefabcd');
  assert.equal(launch.request.networkNamespace, 'sk-abcdefabcdefabcd');
  assert.deepEqual(launch.request.desktop, desktop);
  assert.equal(launch.request.launcherSha256, undefined);
  assert.match(launch.code, /env -i PATH=/);
  assert.deepEqual(launch.request.args, ['--name', 'space & $()']);
  assert.deepEqual(launch.request.environment, { TOKEN: createHash('sha256').update(f.secret).digest('hex') });
  assert.ok(!JSON.stringify(launch.request).includes(f.secret));
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).owner, launch.request.owner);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Wayland reload retains broker ownership and incomplete tightening remains visible until refresh succeeds
 * 协作入口 / Collaborators: `fixture`, `f.rows`, `f.row`, `f.fail`.
 * 检查边界 / Checked boundaries: `assert.equal(saved.sessions[0].state, 'error')`; `assert.equal(refreshed.sessions[0].state, 'running')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Wayland reload retains broker ownership and incomplete tightening remains visible until refresh succeeds', async (t) => {
  const f = await fixture(t, 'wayland');
  f.rows([f.row()]);
  f.fail('configure');
  const saved = await f.save();
  assert.equal(saved.sessions[0].state, 'error');
  const owner = JSON.parse(await readFile(f.file, 'utf8')).owner;
  await f.service.close();
  const restored = new WaylandClipboard(f.machines, async () => { throw Error('unused'); },
    { assets: f.assets, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`f.file`）。
     * Result: Return the branch-computed value (`f.file`).
     * 验证场景 / Scenario: Wayland reload retains broker ownership and incomplete tightening remains visible until refresh succeeds
     */
    file: () => f.file, jobsDirectory: join(f.directory, 'reload-jobs') });
  t.after(() => restored.close());
  f.fail('');
  const refreshed = await restored.action('vm', { action: 'refresh' }) as any;
  assert.equal(refreshed.sessions[0].state, 'running');
  assert.equal(refreshed.sessions[0].rule.copy, false);
  assert.equal(f.calls.findLast(call => call.request.action === 'configure').request.owner, owner);
  const removed = await restored.action('vm', { action: 'remove', version: 2, image }) as any;
  assert.equal(removed.sessions[0].active, false);
  assert.equal(f.calls.filter(call => call.request.action === 'stop').length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Wayland validates all packaged sources before any broker action
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action('vm', { action: 'identify', image }), /源码摘要不符/)`; `assert.equal(f.calls.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('Wayland validates all packaged sources before any broker action', async (t) => {
  const f = await fixture(t, 'wayland');
  await writeFile(join(f.assets, 'primary-selection-unstable-v1.xml'), 'corrupted');
  await assert.rejects(f.service.action('vm', { action: 'identify', image }), /源码摘要不符/);
  assert.equal(f.calls.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 disk failure cannot replace cached settings or issue an unjournaled rule update
 * 协作入口 / Collaborators: `fixture`, `f.rows`, `f.row`, `f.service.view`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.save())`; `assert.equal(f.calls.slice(before).filter((call) => call.request.action === 'configure').length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('X11 disk failure cannot replace cached settings or issue an unjournaled rule update', async (t) => {
  const f = await fixture(t);
  f.rows([f.row()]);
  await f.service.view('vm');
  await mkdir(f.file);
  const before = f.calls.length;
  await assert.rejects(f.save());
  assert.equal(f.calls.slice(before).filter((call) => call.request.action === 'configure').length, 0);
  await rmdir(f.file);
  assert.equal((await f.service.view('vm')).version, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 corrupted source bundles are rejected before native actions and locks or stopped guests refuse writes
 * 协作入口 / Collaborators: `fixture`, `writeFile`, `join`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action('vm', { action: 'refresh' }), /摘要不符/)`; `assert.equal(f.calls.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('X11 corrupted source bundles are rejected before native actions and locks or stopped guests refuse writes', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.assets, 'policy.cpp'), 'changed');
  await assert.rejects(f.service.action('vm', { action: 'refresh' }), /摘要不符/);
  assert.equal(f.calls.length, 0);
  f.lock();
  await assert.rejects(f.service.action('vm', { action: 'stop', id: sessionId }), /locked/);
  const other = await fixture(t);
  other.stopVm();
  await assert.rejects(other.save(), /启动 Linux 实例/);
  assert.equal((await other.service.view('vm')).ready, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: X11 launch failure cleans only the allocated session and refuses unsaved applications
 * 协作入口 / Collaborators: `fixture`, `assert.rejects`, `f.service.action`, `f.save`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action('vm', { action: 'launch', version: 1, image }), /先绑定应用/)`; `assert.rejects(f.service.action('vm', { action: 'launch', version: 2, image }), /failure/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('X11 launch failure cleans only the allocated session and refuses unsaved applications', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.action('vm', { action: 'launch', version: 1, image }), /先绑定应用/);
  await f.save();
  f.fail('launch');
  await assert.rejects(f.service.action('vm', { action: 'launch', version: 2, image }), /failure/);
  const launch = f.calls.findLast((call) => call.request.action === 'launch').request;
  const stopped = f.calls.findLast((call) => call.request.action === 'stop').request;
  assert.equal(stopped.id, launch.id);
  assert.notEqual(stopped.id, sessionId);
  assert.equal(stopped.owner, launch.owner);
});

for (const transport of ['x11', 'wayland'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `f.save`, `f.fail`, `assert.rejects`.
   * 检查边界 / Checked boundaries: `assert.rejects(f.service.action('vm', { action: 'launch', version: 2, image }), { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAIL…`; `assert.equal(f.leases.released, 0)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`${transport} launch rollback503 retains preparation until exact original stop ACK`, async t => {
    const f = await fixture(t, transport); await f.save(); f.fail(['launch', 'stop']);
    await assert.rejects(f.service.action('vm', { action: 'launch', version: 2, image }),
      { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAILED' });
    assert.equal(f.leases.released, 0);
    const request = f.calls.findLast(call => call.request.action === 'launch').request;
    await assert.rejects(f.service.action('vm', { action: 'stop', id: request.id }), { status: 503 });
    assert.equal(f.leases.released, 0); f.fail('');
    await f.service.action('vm', { action: 'stop', id: request.id }); assert.equal(f.leases.released, 1);
  });

  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `fixture`, `f.save`, `f.service.action`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal(f.leases.validated, 2)`; `assert.equal(f.leases.released, 1)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`${transport} Desktop retirement matches full original owner and preserves neighboring application domain`, async t => {
    const f = await fixture(t, transport); await f.save();
    const launched = await f.service.action('vm', { action: 'launch', version: 2, image }) as X11ClipboardSession;
    assert.equal(f.leases.validated, 2); assert.equal(f.leases.released, 1);
    assert.equal(launched.desktopOwner!.uid, 20001);
    assert.equal(launched.applicationOwner!.uid, transport === 'wayland' ? 12345 : 20001);
    const neighbor: X11ClipboardSession = { ...launched, id: sessionId,
      desktopOwner: { ...launched.desktopOwner!, runId: '55555555-5555-4555-8555-555555555555' } };
    f.rows([launched, neighbor]); f.fail('stop-desktop');
    await assert.rejects(f.service.retireDesktop('vm', { ...desktop, build: run.build }),
      { status: 503, code: 'LINUX_CLIPBOARD_CLEANUP_FAILED' });
    assert.equal(launched.state, 'running'); f.fail('');
    await f.service.retireDesktop('vm', { ...desktop, record: { ...desktop.record, phase: 'stopped' }, build: run.build });
    assert.equal(launched.state, 'stopped'); assert.equal(neighbor.state, 'running');
    assert.equal(f.calls.findLast(call => call.request.action === 'stop-desktop').request.desktop.run.runId, runId);
  });
}
