/**
 * 模块职责：回归验证模块，围绕 `native-clipboard` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `native-clipboard`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: native rules require exact local executable paths, unique images, bounded policies and strict requests; default-off startup does not persist or attach and selection checks process identity and executable hash.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rmdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  NativeClipboard,
  nativeClipboardRequest,
  clipboardExecutableBits,
  type NativeClipboardLaunch,
} from '../server/native-clipboard.ts';
import { defaultClipboardRule } from '../shared/clipboard-policy.ts';
import type { NativeClipboardProcess } from '../shared/native-clipboard.ts';

const a: NativeClipboardProcess = {
  pid: 1234,
  created: '134000000000000001',
  image: 'D:\\Programs\\编辑器 & $().exe',
  bits: 64,
};
const b: NativeClipboardProcess = { ...a, pid: 2345, image: 'D:\\Other\\编辑器 & $().exe' };
const hash = 'a'.repeat(64);
const defaults = defaultClipboardRule();
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: item: { pid: number; created: string }。
 * 结果：返回分支计算值（``${item.pid}:${item.created}``）。
 * Result: Return the branch-computed value (``${item.pid}:${item.created}``).
 */
const id = (item: { pid: number; created: string }) => `${item.pid}:${item.created}`;
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: any; extra: Record<string, unknown> = {}; dual = false; early = false。
 * 结果：返回受控对象，公开字段包括 `service, options, file, assets, calls, helpers, policies, configure, setInventory`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, options, file, assets, calls, helpers, policies, configure, setInventory`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: any, extra: Record<string, unknown> = {}, dual = false, early = false) {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-native-clipboard-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const assets = join(directory, 'assets');
  await mkdir(assets);
  const files = [];
  for (const name of [
    'SakuraClipboardPolicy.dll',
    'sakura-clipboard-controller.exe',
    'MinHook-LICENSE.txt',
    ...(dual ? ['SakuraClipboardPolicy-x86.dll', 'sakura-clipboard-controller-x86.exe'] : []),
    ...(early ? ['Detours-LICENSE.md'] : []),
  ]) {
    const contents = Buffer.from(name);
    await writeFile(join(assets, name), contents);
    files.push({ name, size: contents.length, sha256: createHash('sha256').update(contents).digest('hex') });
  }
  await writeFile(
    join(assets, 'native-clipboard.json'),
    JSON.stringify({ version: early ? 3 : dual ? 2 : 1, architecture: 'x64', build: 'b'.repeat(64), files }),
  );
  const file = join(directory, 'native.json');
  let inventory = [a, b],
    currentHash = hash,
    fail = false,
    locked = false,
    maintenance = false,
    mutations = 0;
  const calls: string[][] = [],
    helpers: { file: string; args: string[] }[] = [],
    policies = new Map<string, any>();
  const options = {
    file,
    assets,
    interval: 0,
    supported: true,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`currentHash`），以 Promise 交付。
     * Result: Return the branch-computed value (`currentHash`) through a Promise.
     */
    hashImage: async () => currentHash,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`64`），以 Promise 交付。
     * Result: Return the branch-computed value (`64`) through a Promise.
     */
    imageBits: async (): Promise<32 | 64> => 64,
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('locked')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    guard: () => {
      if (locked) throw new Error('locked');
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`maintenance`）。
     * Result: Return the branch-computed value (`maintenance`).
     */
    maintenance: () => maintenance,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: delta: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `mutations`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.ok`.
     * 检查边界 / Checked boundaries: `assert.ok(mutations >= 0)`.
     */
    mutation: (delta: number) => {
      mutations += delta;
      assert.ok(mutations >= 0);
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _file: string; args: string[]。
     * 结果：返回受控对象，公开字段包括 `processes`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `processes`; the actual branch determines its shape.
     * 失败 / Failure: `new Error('attachment failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `helpers.push`, `calls.push`, `policies.get`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(args[0], 'apply')`; `assert.ok( (JSON.parse(await readFile(file, 'utf8')).managed as any[]).some((item) => id(item) === key), 'journal precedes native …`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    run: async (_file: string, args: string[]) => {
      helpers.push({ file: _file, args });
      calls.push(args);
      if (args[0] === 'list') return { processes: inventory };
      const key = args[2] + ':' + args[3];
      if (args[0] === 'status') return policies.get(key) || { present: false };
      assert.equal(args[0], 'apply');
      assert.ok(
        (JSON.parse(await readFile(file, 'utf8')).managed as any[]).some((item) => id(item) === key),
        'journal precedes native attachment',
      );
      if (fail) throw new Error('attachment failed');
      const state = {
        present: true,
        ready: true,
        compatible: true,
        active: args[8] === '1',
        flags: Number(args[6]),
        maximum: Number(args[7]),
        blockedCopy: 2,
        blockedPaste: 3,
      };
      policies.set(key, state);
      return state;
    },
    ...extra,
  };
  const service = new NativeClipboard(options);
  t.after(() => service.close());
  await service.init();
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: enabled = true; applications = [{ image: a.image, sha256: hash, rule: { ...d…。
   * 结果：返回分支计算值（`service.action({ action: 'configure', version: service.view().version, settings:…`）。
   * Result: Return the branch-computed value (`service.action({ action: 'configure', version: service.view().version, settings:…`).
   * 协作入口 / Collaborators: `service.action`, `service.view`.
   */
  const configure = (
    enabled = true,
    applications = [{ image: a.image, sha256: hash, rule: { ...defaults, copy: false } }],
  ) =>
    service.action({
      action: 'configure',
      version: service.view().version,
      settings: { enabled, applications },
    });
  return {
    service,
    options,
    file,
    assets,
    calls,
    helpers,
    policies,
    configure,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: NativeClipboardProcess[]。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `inventory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setInventory: (value: NativeClipboardProcess[]) => {
      inventory = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `currentHash`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `'c'.repeat`.
     */
    changeHash: () => {
      currentHash = 'c'.repeat(64);
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `fail`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    fail: (value: boolean) => {
      fail = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `locked`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    lock: (value: boolean) => {
      locked = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `maintenance`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    maintain: (value: boolean) => {
      maintenance = value;
    },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`mutations`）。
     * Result: Return the branch-computed value (`mutations`).
     */
    mutations: () => mutations,
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native rules require exact local executable paths, unique images, bounded policies and strict requests
 * 协作入口 / Collaborators: `assert.equal`, `nativeClipboardRequest.safeParse`, `request`, `repeated.settings.applications.push`.
 * 检查边界 / Checked boundaries: `assert.equal(nativeClipboardRequest.safeParse(request(a.image)).success, true)`; `assert.equal(nativeClipboardRequest.safeParse(request(path)).success, false, path)`.
 */
test('native rules require exact local executable paths, unique images, bounded policies and strict requests', () => {
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: image: string。
   * 结果：返回分支计算值（`({ action: 'configure', version: 1, settings: { enabled: true, applications: [{ …`）。
   * Result: Return the branch-computed value (`({ action: 'configure', version: 1, settings: { enabled: true, applications: [{ …`).
   * 验证场景 / Scenario: native rules require exact local executable paths, unique images, bounded policies and strict requests
   */
  const request = (image: string) => ({
    action: 'configure',
    version: 1,
    settings: { enabled: true, applications: [{ image, sha256: hash, rule: defaults }] },
  });
  assert.equal(nativeClipboardRequest.safeParse(request(a.image)).success, true);
  for (const path of [
    'editor.exe',
    '\\\\server\\share\\editor.exe',
    'D:\\a.exe:stream',
    'D:\\..\\a.exe',
    'D:\\a. \\b.exe',
  ])
    assert.equal(nativeClipboardRequest.safeParse(request(path)).success, false, path);
  const repeated = request(a.image);
  repeated.settings.applications.push({ ...repeated.settings.applications[0], image: a.image.toUpperCase() });
  assert.equal(nativeClipboardRequest.safeParse(repeated).success, false);
  assert.equal(nativeClipboardRequest.safeParse({ action: 'refresh', enabled: true }).success, false);
  assert.equal(
    nativeClipboardRequest.safeParse({ action: 'identify', pid: 1234, created: '1e5' }).success,
    false,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: default-off startup does not persist or attach and selection checks process identity and executable hash
 * 协作入口 / Collaborators: `fixture`, `assert.equal`, `f.service.view`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(f.service.view().ready, true)`; `assert.deepEqual(f.service.view().available, [a])`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('default-off startup does not persist or attach and selection checks process identity and executable hash', async (t) => {
  const f = await fixture(t, { pid: b.pid });
  assert.equal(f.service.view().ready, true);
  assert.deepEqual(f.service.view().available, [a]);
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  f.setInventory([a, b, { ...a, pid: 3456, image: 'D:\\Programs\\application.com' }]);
  await f.service.action({ action: 'refresh' });
  assert.deepEqual(f.service.view().available, [a]);
  await assert.rejects(readFile(f.file), { code: 'ENOENT' });
  assert.deepEqual(await f.service.action({ action: 'identify', pid: a.pid, created: a.created }), {
    image: a.image,
    sha256: hash,
  });
  await assert.rejects(f.service.action({ action: 'identify', pid: a.pid, created: '123' }), /身份已变化/);
  await f.service.close();
  await assert.rejects(f.service.action({ action: 'refresh' }), /正在关闭/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saved rules attach only matching paths, journal before native calls, watch new processes and refuse unknown architectures
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `assert.equal`, `f.calls.filter`.
 * 检查边界 / Checked boundaries: `assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 1)`; `assert.equal(f.service.view().processes[0].state, 'enforced')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('saved rules attach only matching paths, journal before native calls, watch new processes and refuse unknown architectures', async (t) => {
  const f = await fixture(t);
  await f.configure();
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 1);
  assert.equal(f.service.view().processes[0].state, 'enforced');
  assert.equal(f.service.view().processes[0].blockedPaste, 3);
  f.setInventory([a, b, { ...a, pid: 3456, created: '134000000000000002' }, { ...a, pid: 4567, bits: 0 }]);
  await f.service.action({ action: 'refresh' });
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 2);
  assert.equal(f.service.view().processes.find((item) => item.pid === 4567)?.state, 'error');
  assert.ok(!f.service.view().processes.some((item) => item.pid === b.pid));
  assert.equal(f.mutations(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: dual architecture assets route x86 attachment and retain shared ownership across restart and disable
 * 协作入口 / Collaborators: `fixture`, `f.setInventory`, `f.service.action`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(selected, { image: x86.image, sha256: hash })`; `assert.equal(f.service.view().processes.filter((item) => item.state === 'enforced').length, 2)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('dual architecture assets route x86 attachment and retain shared ownership across restart and disable', async (t) => {
  const f = await fixture(t, {}, true);
  const x86: NativeClipboardProcess = { ...a, pid: 4568, image: 'D:\\Apps\\LegacyEditor.exe', bits: 32 };
  f.setInventory([a, b, x86]);
  const selected = await f.service.action({ action: 'identify', pid: x86.pid, created: x86.created });
  assert.deepEqual(selected, { image: x86.image, sha256: hash });
  await f.configure(
    true,
    [a, x86].map((item) => ({ image: item.image, sha256: hash, rule: { ...defaults, copy: false } })),
  );
  assert.equal(f.service.view().processes.filter((item) => item.state === 'enforced').length, 2);
  const attached = f.helpers.find((item) => item.args[0] === 'apply' && item.args[2] === String(x86.pid))!;
  assert.ok(attached.file.endsWith('sakura-clipboard-controller-x86.exe'));
  assert.ok(attached.args[5].endsWith('SakuraClipboardPolicy-x86.dll'));
  assert.equal(
    JSON.parse(await readFile(f.file, 'utf8')).managed.find(
      (item: NativeClipboardProcess) => item.pid === x86.pid,
    ).bits,
    32,
  );
  await f.service.close();
  const resumed = new NativeClipboard(f.options);
  t.after(() => resumed.close());
  await resumed.init();
  assert.equal(resumed.view().processes.filter((item) => item.state === 'enforced').length, 2);
  assert.equal(
    f.calls.filter((args) => args[0] === 'apply').length,
    2,
    'ready x86 and x64 mappings do not reattach',
  );
  await resumed.action({
    action: 'configure',
    version: resumed.view().version,
    settings: { ...resumed.view().settings, enabled: false },
  });
  assert.equal(f.policies.get(id(x86)).active, false);
  assert.ok(
    f.helpers
      .filter((item) => item.args[0] === 'apply' && item.args[8] === '0')
      .every((item) => item.file.endsWith('sakura-clipboard-controller.exe')),
  );
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy x64 assets refuse x86 identities instead of invoking an unverified controller
 * 协作入口 / Collaborators: `fixture`, `f.setInventory`, `assert.rejects`, `f.service.action`.
 * 检查边界 / Checked boundaries: `assert.rejects( f.service.action({ action: 'identify', pid: x86.pid, created: x86.created }), /架构不受支持/, )`; `assert.equal(f.service.view().processes[0].state, 'error')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy x64 assets refuse x86 identities instead of invoking an unverified controller', async (t) => {
  const f = await fixture(t);
  const x86: NativeClipboardProcess = { ...a, bits: 32 };
  f.setInventory([x86]);
  await assert.rejects(
    f.service.action({ action: 'identify', pid: x86.pid, created: x86.created }),
    /架构不受支持/,
  );
  await f.configure();
  assert.equal(f.service.view().processes[0].state, 'error');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  assert.ok(!f.helpers.some((item) => item.file.endsWith('sakura-clipboard-controller-x86.exe')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: x86 binary corruption blocks new attachments while a verified x64 controller still disables owned x86 mappings
 * 协作入口 / Collaborators: `fixture`, `f.setInventory`, `f.configure`, `writeFile`.
 * 检查边界 / Checked boundaries: `assert.equal(f.service.view().ready, false)`; `assert.match(f.service.view().processes[0].error!, /完整性失败/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('x86 binary corruption blocks new attachments while a verified x64 controller still disables owned x86 mappings', async (t) => {
  const f = await fixture(t, {}, true);
  const x86: NativeClipboardProcess = { ...a, bits: 32 };
  f.setInventory([x86]);
  await f.configure();
  await writeFile(join(f.assets, 'sakura-clipboard-controller-x86.exe'), 'tampered');
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().ready, false);
  assert.match(f.service.view().processes[0].error!, /完整性失败/);
  assert.equal(f.policies.get(id(x86)).active, true);
  await f.configure(false);
  assert.equal(f.policies.get(id(x86)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: restart retains ownership, cached readiness avoids duplicate attach, and explicit stop clears old maps even after image changes
 * 状态影响 / State effects: `f.policies.get(id(a)).compatible`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.service.close`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.policies.get(id(a)).active, true, 'shutdown preserves the rule')`; `assert.equal(resumed.view().processes[0].state, 'enforced')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('restart retains ownership, cached readiness avoids duplicate attach, and explicit stop clears old maps even after image changes', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.close();
  assert.equal(f.policies.get(id(a)).active, true, 'shutdown preserves the rule');
  const resumed = new NativeClipboard(f.options);
  t.after(() => resumed.close());
  await resumed.init();
  assert.equal(resumed.view().processes[0].state, 'enforced');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 1);
  f.changeHash();
  await resumed.action({ action: 'refresh' });
  assert.match(resumed.view().processes[0].error!, /文件已变化/);
  assert.equal(f.policies.get(id(a)).active, true);
  f.policies.get(id(a)).compatible = false;
  await resumed.action({
    action: 'configure',
    version: resumed.view().version,
    settings: { ...resumed.view().settings, enabled: false },
  });
  assert.equal(f.policies.get(id(a)).active, false);
  assert.equal(resumed.view().processes[0].state, 'disabled');
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: failed and invisible native processes remain journaled until a verified disable or mapping disappearance
 * 协作入口 / Collaborators: `fixture`, `f.fail`, `f.configure`, `assert.match`.
 * 检查边界 / Checked boundaries: `assert.match(f.service.view().processes[0].error!, /attachment failed/)`; `assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('failed and invisible native processes remain journaled until a verified disable or mapping disappearance', async (t) => {
  const f = await fixture(t);
  f.fail(true);
  await f.configure();
  assert.match(f.service.view().processes[0].error!, /attachment failed/);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
  f.fail(false);
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().processes[0].state, 'enforced');
  f.setInventory([b]);
  await f.service.action({ action: 'refresh' });
  assert.match(f.service.view().processes[0].error!, /无法核对身份/);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
  f.policies.delete(id(a));
  await f.service.action({ action: 'refresh' });
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: PID reuse never inherits an old policy and stale/locked/maintenance writes cannot change saved settings
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.policies.delete`, `id`.
 * 检查边界 / Checked boundaries: `assert.ok(f.policies.get(id(replacement)).active)`; `assert.deepEqual( JSON.parse(await readFile(f.file, 'utf8')).managed.map((item: any) => item.created), [replacement.created], )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('PID reuse never inherits an old policy and stale/locked/maintenance writes cannot change saved settings', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.policies.delete(id(a));
  const replacement = { ...a, created: '134000000000000099' };
  f.setInventory([replacement]);
  await f.service.action({ action: 'refresh' });
  assert.ok(f.policies.get(id(replacement)).active);
  assert.deepEqual(
    JSON.parse(await readFile(f.file, 'utf8')).managed.map((item: any) => item.created),
    [replacement.created],
  );
  await assert.rejects(
    f.service.action({ action: 'configure', version: 1, settings: { enabled: false, applications: [] } }),
    /已改变/,
  );
  f.lock(true);
  await assert.rejects(f.configure(false), /locked/);
  f.lock(false);
  f.maintain(true);
  await assert.rejects(f.configure(false), /维护中/);
  f.maintain(false);
  assert.equal(f.service.view().settings.enabled, true);
  assert.equal(f.mutations(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: DLL integrity failure refuses attachment but verified controller still permits disabling owned processes
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(f.service.view().ready, false)`; `assert.match(f.service.view().processes[0].error!, /完整性失败/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('DLL integrity failure refuses attachment but verified controller still permits disabling owned processes', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await writeFile(join(f.assets, 'SakuraClipboardPolicy.dll'), 'tampered');
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().ready, false);
  assert.match(f.service.view().processes[0].error!, /完整性失败/);
  assert.equal(f.policies.get(id(a)).active, true);
  await f.configure(false);
  assert.equal(f.policies.get(id(a)).active, false);
  const before = f.calls.length;
  await writeFile(join(f.assets, 'sakura-clipboard-controller.exe'), 'tampered');
  await f.service.action({ action: 'refresh' });
  assert.equal(f.calls.length, before);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: invalid native lists and incompatible agents are reported without granting enforcement
 * 状态影响 / State effects: `f.policies.get(id(a)).compatible`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.policies.get`, `id`.
 * 检查边界 / Checked boundaries: `assert.match(f.service.view().processes[0].error!, /重新启动/)`; `assert.equal(broken.view().ready, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('invalid native lists and incompatible agents are reported without granting enforcement', async (t) => {
  const f = await fixture(t);
  await f.configure();
  f.policies.get(id(a)).compatible = false;
  await f.service.action({ action: 'refresh' });
  assert.match(f.service.view().processes[0].error!, /重新启动/);
  const broken = new NativeClipboard({
    ...f.options,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ processes: [{ ...a, bits: 128 }] })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ processes: [{ ...a, bits: 128 }] })`) through a Promise.
     * 验证场景 / Scenario: invalid native lists and incompatible agents are reported without granting enforcement
     */
    run: async () => ({ processes: [{ ...a, bits: 128 }] }),
  });
  t.after(() => broken.close());
  await broken.init();
  assert.equal(broken.view().ready, false);
  assert.equal(broken.view().processes[0].state, 'error');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: journal write failure cannot attach or leave an unpersisted in-memory ownership shortcut
 * 协作入口 / Collaborators: `fixture`, `t.after`, `service.init`, `service.action`.
 * 检查边界 / Checked boundaries: `assert.equal(service.view().processes[0].state, 'error')`; `assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('journal write failure cannot attach or leave an unpersisted in-memory ownership shortcut', async (t) => {
  const f = await fixture(t);
  let interrupted = false;
  const service = new NativeClipboard({
    ...f.options,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: file; args。
     * 结果：返回分支计算值（`value`），以 Promise 交付。
     * Result: Return the branch-computed value (`value`) through a Promise.
     * 验证场景 / Scenario: journal write failure cannot attach or leave an unpersisted in-memory ownership shortcut
     * 状态影响 / State effects: `interrupted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `f.options.run`, `rename`, `mkdir`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    run: async (file, args) => {
      const value = await f.options.run(file, args);
      if (args[0] === 'status' && !interrupted) {
        interrupted = true;
        await rename(f.file, f.file + '.saved');
        await mkdir(f.file);
      }
      return value;
    },
  });
  t.after(() => service.close());
  await service.init();
  await service.action({
    action: 'configure',
    version: 1,
    settings: { enabled: true, applications: [{ image: a.image, sha256: hash, rule: defaults }] },
  });
  assert.equal(service.view().processes[0].state, 'error');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  assert.equal(JSON.parse(await readFile(f.file + '.saved', 'utf8')).managed.length, 0);
  await rmdir(f.file);
  await rename(f.file + '.saved', f.file);
  await service.action({ action: 'refresh' });
  assert.equal(service.view().processes[0].state, 'enforced');
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: any; bits: 32 | 64 = 64; dual = true。
 * 结果：返回受控对象，公开字段包括 `created, controls, launches, launch, result`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `created, controls, launches, launch, result`; the actual branch determines its shape.
 * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.setInventory`, `f.configure`.
 */
async function launchFixture(t: any, bits: 32 | 64 = 64, dual = true) {
  let f: Awaited<ReturnType<typeof fixture>>;
  const created: NativeClipboardProcess = { ...a, pid: 9876, created: '134000000000000123', bits };
  const calls: { file: string; args: string[] }[] = [];
  const controls: {
    beforePrepared?: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>;
    afterPrepared?: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>;
    beforeAttached?: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<void>;
    waitForClose?: boolean;
    reported?: NativeClipboardProcess;
    state?: Record<string, unknown>;
  } = {};
  let attached = false,
    resumed = false,
    killed = false;
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: file; args; hooks; signal。
   * 结果：返回分支计算值（`created`），以 Promise 交付。
   * Result: Return the branch-computed value (`created`) through a Promise.
   * 状态影响 / State effects: `attached`, `resumed`, `killed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 失败 / Failure: `error`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `calls.push`, `controls.beforePrepared`, `hooks.prepared`, `assert.ok`.
   * 检查边界 / Checked boundaries: `assert.ok( JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => id(item) === id(created)), 'new process ownershi…`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  const launch: NativeClipboardLaunch = async (file, args, hooks, signal) => {
    calls.push({ file, args });
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 失败 / Failure: `new Error('launch aborted')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    const failIfClosed = () => {
      if (signal.aborted) throw new Error('launch aborted');
    };
    try {
      await controls.beforePrepared?.();
      await hooks.prepared(controls.reported || created);
      assert.ok(
        JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => id(item) === id(created)),
        'new process ownership is persisted before native DLL attachment',
      );
      await controls.afterPrepared?.();
      failIfClosed();
      attached = true;
      const state = {
        present: true as const,
        ready: true,
        active: true,
        compatible: true,
        flags: Number(args[5]),
        maximum: Number(args[6]),
        blockedCopy: 0,
        blockedPaste: 0,
        ...controls.state,
      };
      f.policies.set(id(created), state);
      await controls.beforeAttached?.();
      if (controls.waitForClose)
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('launch aborted')), { once: true });
          if (signal.aborted) reject(new Error('launch aborted'));
        });
      await hooks.attached(created, state as any);
      failIfClosed();
      resumed = true;
      return created;
    } catch (error) {
      killed = true;
      f.policies.delete(id(created));
      throw error;
    }
  };
  f = await fixture(t, { launch, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`bits`），以 Promise 交付。
   * Result: Return the branch-computed value (`bits`) through a Promise.
   */
  imageBits: async () => bits }, dual, dual);
  f.setInventory([]);
  await f.configure();
  return {
    ...f,
    created,
    controls,
    launches: calls,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args: string[] = []。
     * 结果：返回分支计算值（`f.service.action({ action: 'launch', version: f.service.view().version, image: a…`）。
     * Result: Return the branch-computed value (`f.service.action({ action: 'launch', version: f.service.view().version, image: a…`).
     * 协作入口 / Collaborators: `f.service.action`, `f.service.view`.
     */
    launch: (args: string[] = []) =>
      f.service.action({
        action: 'launch',
        version: f.service.view().version,
        image: a.image,
        sha256: hash,
        args,
      }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ attached, resumed, killed })`）。
     * Result: Return the branch-computed value (`({ attached, resumed, killed })`).
     */
    result: () => ({ attached, resumed, killed }),
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controlled launch requests accept literal argv but reject shell options, nulls and excessive argument sizes
 * 协作入口 / Collaborators: `assert.equal`, `nativeClipboardRequest.safeParse`, `'x'.repeat`, `Array(65).fill`.
 * 检查边界 / Checked boundaries: `assert.equal(nativeClipboardRequest.safeParse(request).success, true)`; `assert.equal(nativeClipboardRequest.safeParse({ ...request, args }).success, false)`.
 */
test('controlled launch requests accept literal argv but reject shell options, nulls and excessive argument sizes', () => {
  const request = {
    action: 'launch',
    version: 1,
    image: a.image,
    sha256: hash,
    args: ['', '空 格', '"', '\\', '& $() %PATH%'],
  };
  assert.equal(nativeClipboardRequest.safeParse(request).success, true);
  for (const args of [['x\0y'], ['x'.repeat(2049)], Array(65).fill(''), Array(5).fill('x'.repeat(2048)), [7]])
    assert.equal(nativeClipboardRequest.safeParse({ ...request, args }).success, false);
  assert.equal(nativeClipboardRequest.safeParse({ ...request, shell: true }).success, false);
  assert.equal(nativeClipboardRequest.safeParse({ ...request, version: 0 }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controlled x86 launch persists ownership before attach, checks ready policy before resume and survives scan/restart/disable
 * 协作入口 / Collaborators: `launchFixture`, `f.launch`, `assert.deepEqual`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(value.process, f.created)`; `assert.equal(value.view.processes[0].state, 'enforced')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('controlled x86 launch persists ownership before attach, checks ready policy before resume and survives scan/restart/disable', async (t) => {
  const f = await launchFixture(t, 32);
  const args = ['', 'sp ace', 'with"quote', 'trailing\\', '\\"', '中文🪷', '& $() %PATH% ; >'];
  const value = (await f.launch(args)) as { process: NativeClipboardProcess; view: any };
  assert.deepEqual(value.process, f.created);
  assert.equal(value.view.processes[0].state, 'enforced');
  assert.deepEqual(f.result(), { attached: true, resumed: true, killed: false });
  assert.ok(f.launches[0].file.endsWith('sakura-clipboard-controller-x86.exe'));
  assert.ok(f.launches[0].args[4].endsWith('SakuraClipboardPolicy-x86.dll'));
  assert.deepEqual(f.launches[0].args.slice(8), args);
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  f.setInventory([f.created, b]);
  await f.service.action({ action: 'refresh' });
  assert.equal(
    f.calls.filter((args) => args[0] === 'apply').length,
    0,
    'scan reuses the already-ready policy',
  );
  await f.service.close();
  assert.equal(f.policies.get(id(f.created)).active, true);
  const resumed = new NativeClipboard(f.options);
  t.after(() => resumed.close());
  await resumed.init();
  assert.equal(resumed.view().processes[0].state, 'enforced');
  assert.equal(f.calls.filter((args) => args[0] === 'apply').length, 0);
  await resumed.action({
    action: 'configure',
    version: resumed.view().version,
    settings: { ...resumed.view().settings, enabled: false },
  });
  assert.equal(f.policies.get(id(f.created)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controlled launch requires current saved enablement, exact binding, intact assets and architecture before creating a process
 * 协作入口 / Collaborators: `launchFixture`, `f.service.view`, `assert.rejects`, `f.service.action`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.action({ ...valid, version: 1 }), /已改变/)`; `assert.rejects(f.service.action({ ...valid, image: b.image }), /已保存并启用/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('controlled launch requires current saved enablement, exact binding, intact assets and architecture before creating a process', async (t) => {
  const f = await launchFixture(t);
  const valid = {
    action: 'launch',
    version: f.service.view().version,
    image: a.image,
    sha256: hash,
    args: [],
  };
  await assert.rejects(f.service.action({ ...valid, version: 1 }), /已改变/);
  await assert.rejects(f.service.action({ ...valid, image: b.image }), /已保存并启用/);
  await assert.rejects(f.service.action({ ...valid, sha256: 'f'.repeat(64) }), /已保存并启用/);
  f.lock(true);
  await assert.rejects(f.launch(), /locked/);
  f.lock(false);
  f.maintain(true);
  await assert.rejects(f.launch(), /维护中/);
  f.maintain(false);
  f.changeHash();
  await assert.rejects(f.launch(), /摘要已变化/);
  assert.equal(f.launches.length, 0);
  await f.configure(false);
  await assert.rejects(f.launch(), /已保存并启用/);
  const legacy = await launchFixture(t, 32, false);
  await assert.rejects(legacy.launch(), /未包含 32 位/);
  assert.equal(legacy.launches.length, 0);
  const corrupt = await launchFixture(t);
  await writeFile(join(corrupt.assets, 'SakuraClipboardPolicy.dll'), 'tampered');
  await assert.rejects(corrupt.launch(), /完整性失败/);
  assert.equal(corrupt.launches.length, 0);
  assert.equal(f.mutations(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controlled launch journal write failure cleans up only its pending child and never attaches or resumes
 * 状态影响 / State effects: `f.controls.beforePrepared`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `launchFixture`, `assert.rejects`, `f.launch`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.launch())`; `assert.deepEqual(f.result(), { attached: false, resumed: false, killed: true })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('controlled launch journal write failure cleans up only its pending child and never attaches or resumes', async (t) => {
  const f = await launchFixture(t);
  f.controls.beforePrepared = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: controlled launch journal write failure cleans up only its pending child and never attaches or resumes
   * 协作入口 / Collaborators: `rename`, `mkdir`.
   */
  async () => {
    await rename(f.file, f.file + '.saved');
    await mkdir(f.file);
  };
  await assert.rejects(f.launch());
  assert.deepEqual(f.result(), { attached: false, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(f.file + '.saved', 'utf8')).managed.length, 0);
  assert.equal(f.service.view().processes.length, 0);
  assert.equal(f.mutations(), 0);
  await rmdir(f.file);
  await rename(f.file + '.saved', f.file);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controlled launch requires v3 early assets and the verified Detours license without disabling legacy owned policies
 * 协作入口 / Collaborators: `launchFixture`, `f.policies.set`, `id`, `join`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.launch(), /DLL\/TLS 初始化前/)`; `assert.equal(f.launches.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('controlled launch requires v3 early assets and the verified Detours license without disabling legacy owned policies', async (t) => {
  const f = await launchFixture(t);
  const existing = {
    present: true,
    ready: true,
    active: true,
    compatible: true,
    flags: 6,
    maximum: 1048576,
    blockedCopy: 2,
    blockedPaste: 3,
  };
  f.policies.set(id(b), existing);
  const path = join(f.assets, 'native-clipboard.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(
    path,
    JSON.stringify({
      ...manifest,
      version: 2,
      files: manifest.files.filter((item: any) => item.name !== 'Detours-LICENSE.md'),
    }),
  );
  await assert.rejects(f.launch(), /DLL\/TLS 初始化前/);
  assert.equal(f.launches.length, 0);
  await writeFile(path, JSON.stringify(manifest));
  await writeFile(join(f.assets, 'Detours-LICENSE.md'), 'corrupted license');
  await assert.rejects(f.launch(), /完整性失败/);
  assert.equal(f.launches.length, 0);
  assert.equal(f.mutations(), 0);
  assert.equal(f.policies.get(id(b)), existing);
  assert.equal(existing.active, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controlled launch refuses mismatched process identities and policies without resuming, retaining failed ownership for later reconciliation
 * 状态影响 / State effects: `wrong.controls.reported`, `stale.controls.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `launchFixture`, `assert.rejects`, `wrong.launch`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(wrong.launch(), /进程身份/)`; `assert.deepEqual(wrong.result(), { attached: false, resumed: false, killed: true })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('controlled launch refuses mismatched process identities and policies without resuming, retaining failed ownership for later reconciliation', async (t) => {
  const wrong = await launchFixture(t);
  wrong.controls.reported = { ...wrong.created, image: b.image };
  await assert.rejects(wrong.launch(), /进程身份/);
  assert.deepEqual(wrong.result(), { attached: false, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(wrong.file, 'utf8')).managed.length, 0);
  const stale = await launchFixture(t);
  stale.controls.state = { ready: false };
  await assert.rejects(stale.launch(), /未加载完成/);
  assert.deepEqual(stale.result(), { attached: true, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(stale.file, 'utf8')).managed.length, 1);
  await stale.service.action({ action: 'refresh' });
  assert.equal(JSON.parse(await readFile(stale.file, 'utf8')).managed.length, 0);
  assert.equal(stale.mutations(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lock, migration maintenance, executable changes and independent mapping failure are rechecked before controlled resume
 * 状态影响 / State effects: `f.controls.beforeAttached`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `launchFixture`, `assert.rejects`, `f.launch`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.launch(), pattern)`; `assert.deepEqual(f.result(), { attached: true, resumed: false, killed: true })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lock, migration maintenance, executable changes and independent mapping failure are rechecked before controlled resume', async (t) => {
  for (const [modify, pattern] of [
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.lock(true), /locked/],
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.maintain(true), /维护中/],
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.changeHash(), /摘要已变化/],
    [(f: Awaited<ReturnType<typeof launchFixture>>) => f.policies.delete(id(f.created)), /策略复核失败/],
  ] as const) {
    const f = await launchFixture(t);
    f.controls.beforeAttached = /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: lock, migration maintenance, executable changes and independent mapping failure are rechecked before controlled resume
     * 协作入口 / Collaborators: `modify`.
     */
    async () => {
      modify(f);
    };
    await assert.rejects(f.launch(), pattern);
    assert.deepEqual(f.result(), { attached: true, resumed: false, killed: true });
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
    assert.equal(f.mutations(), 0);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service close cancels an in-progress controlled launch and preserves persisted ownership without relaxing other processes
 * 状态影响 / State effects: `f.controls.waitForClose`, `f.controls.beforeAttached`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `launchFixture`, `f.policies.set`, `id`, `f.launch`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /aborted/)`; `assert.deepEqual(f.result(), { attached: true, resumed: false, killed: true })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('service close cancels an in-progress controlled launch and preserves persisted ownership without relaxing other processes', async (t) => {
  const f = await launchFixture(t);
  const otherPolicy = {
    present: true,
    ready: true,
    active: true,
    compatible: true,
    flags: 6,
    maximum: 1048576,
    blockedCopy: 2,
    blockedPaste: 3,
  };
  f.policies.set(id(b), otherPolicy);
  f.controls.waitForClose = true;
  let prepared!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const started = new Promise<void>((resolve) => {
    prepared = resolve;
  });
  f.controls.beforeAttached = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: service close cancels an in-progress controlled launch and preserves persisted ownership without relaxing other processes
   * 协作入口 / Collaborators: `prepared`.
   */
  async () => {
    prepared();
  };
  const pending = f.launch();
  const rejection = assert.rejects(pending, /aborted/);
  await started;
  await f.service.close();
  await rejection;
  assert.deepEqual(f.result(), { attached: true, resumed: false, killed: true });
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 1);
  assert.equal(f.policies.get(id(b)), otherPolicy);
  assert.equal(otherPolicy.active, true);
  assert.equal(f.mutations(), 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: controlled launch architecture preflight checks PE signature, executable flags and matching optional header
 * 协作入口 / Collaborators: `fixture`, `Buffer.alloc`, `header.writeUInt16LE`, `header.writeUInt32LE`.
 * 检查边界 / Checked boundaries: `assert.equal(await clipboardExecutableBits(path), bits)`; `assert.rejects(clipboardExecutableBits(path), /不是 Windows EXE/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('controlled launch architecture preflight checks PE signature, executable flags and matching optional header', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  for (const bits of [32, 64] as const) {
    const header = Buffer.alloc(512);
    header.writeUInt16LE(0x5a4d, 0);
    header.writeUInt32LE(64, 60);
    header.writeUInt32LE(0x4550, 64);
    header.writeUInt16LE(bits === 32 ? 0x14c : 0x8664, 68);
    header.writeUInt16LE(2, 86);
    header.writeUInt16LE(bits === 32 ? 224 : 240, 84);
    header.writeUInt16LE(bits === 32 ? 0x10b : 0x20b, 88);
    header.writeUInt16LE(3, 88 + 68);
    header.writeUInt32LE(16, 88 + (bits === 32 ? 92 : 108));
    const path = join(f.assets, `test-${bits}.exe`);
    await writeFile(path, header);
    assert.equal(await clipboardExecutableBits(path), bits);
    header.writeUInt16LE(0x2002, 86);
    await writeFile(path, header);
    await assert.rejects(clipboardExecutableBits(path), /不是 Windows EXE/);
    header.writeUInt16LE(2, 86);
    header.writeUInt16LE(0xaa64, 68);
    await writeFile(path, header);
    await assert.rejects(clipboardExecutableBits(path), /仅支持 x64 或 x86/);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CLR preflight selects the actual startup width for fixed and AnyCPU executables
 * 协作入口 / Collaborators: `fixture`, `join`, `writeFile`, `clr`.
 * 检查边界 / Checked boundaries: `assert.equal(await clipboardExecutableBits(path), expected)`; `assert.rejects(clipboardExecutableBits(path), /CLR|启动头/, name)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('CLR preflight selects the actual startup width for fixed and AnyCPU executables', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: width: 32 | 64; flags: number。
   * 结果：返回分支计算值（`bytes`）。
   * Result: Return the branch-computed value (`bytes`).
   * 验证场景 / Scenario: CLR preflight selects the actual startup width for fixed and AnyCPU executables
   * 协作入口 / Collaborators: `Buffer.alloc`, `bytes.writeUInt16LE`, `bytes.writeUInt32LE`.
   */
  function clr(width: 32 | 64, flags: number) {
    const bytes = Buffer.alloc(1024), optional = 88, optionalSize = width === 32 ? 224 : 240;
    bytes.writeUInt16LE(0x5a4d, 0); bytes.writeUInt32LE(64, 60); bytes.writeUInt32LE(0x4550, 64);
    bytes.writeUInt16LE(width === 32 ? 0x14c : 0x8664, 68); bytes.writeUInt16LE(1, 70);
    bytes.writeUInt16LE(optionalSize, 84); bytes.writeUInt16LE(2, 86);
    bytes.writeUInt16LE(width === 32 ? 0x10b : 0x20b, optional);
    bytes.writeUInt16LE(3, optional + 68); bytes.writeUInt32LE(0x4000, optional + 56);
    const directories = width === 32 ? 96 : 112;
    bytes.writeUInt32LE(16, optional + directories - 4);
    bytes.writeUInt32LE(0x2000, optional + directories + 112);
    bytes.writeUInt32LE(72, optional + directories + 116);
    const section = optional + optionalSize;
    bytes.writeUInt32LE(0x2000, section + 12); bytes.writeUInt32LE(512, section + 16);
    bytes.writeUInt32LE(512, section + 20);
    bytes.writeUInt32LE(72, 512); bytes.writeUInt32LE(0x2100, 520); bytes.writeUInt32LE(32, 524);
    bytes.writeUInt32LE(flags, 528); bytes.writeUInt32LE(0x06000001, 532);
    return bytes;
  }
  const path = join(f.assets, 'clr.exe');
  for (const [width, flags, expected] of [[64, 1, 64], [32, 3, 32], [32, 0x20003, 32],
    [32, 1, process.arch === 'x64' ? 64 : 32], [32, 9, process.arch === 'x64' ? 64 : 32]] as const) {
    await writeFile(path, clr(width, flags)); assert.equal(await clipboardExecutableBits(path), expected);
  }
  for (const [name, mutate] of [
    ['mixed mode', (b: Buffer) => b.writeUInt32LE(0, 528)],
    ['native entry', (b: Buffer) => b.writeUInt32LE(0x11, 528)],
    ['ReadyToRun', (b: Buffer) => b.writeUInt32LE(0x2200, 576)],
    ['unknown flags', (b: Buffer) => b.writeUInt32LE(0x40000001, 528)],
    ['missing entry', (b: Buffer) => b.writeUInt32LE(0, 532)],
    ['missing metadata', (b: Buffer) => b.writeUInt32LE(0, 520)],
    ['bad CLR size', (b: Buffer) => b.writeUInt32LE(71, 512)],
    ['ambiguous RVA', (b: Buffer) => { b.writeUInt16LE(2, 70); b.copy(b, 352, 312, 352); }],
    ['outside file', (b: Buffer) => b.writeUInt32LE(1024, 332)],
    ['bad directory', (b: Buffer) => b.writeUInt32LE(0, 296)],
  ] as const) {
    const bytes = clr(32, 1); mutate(bytes); await writeFile(path, bytes);
    await assert.rejects(clipboardExecutableBits(path), /CLR|启动头/, name);
  }
  await writeFile(path, clr(64, 3)); await assert.rejects(clipboardExecutableBits(path), /位数标记/);
});
