/**
 * 模块职责：回归验证模块，围绕 `native-clipboard-descendants` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `native-clipboard-descendants`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: CreateProcess descendant inherits cross-EXE rules and exact ancestry before matching x86 helper attachment; concurrent child journals and nested initializer descendants do not deadlock an ancestor controlled launch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NativeClipboard, type NativeClipboardLaunch } from '../server/native-clipboard.ts';
import type { NativeClipboardProcess } from '../shared/native-clipboard.ts';
import type {
  NativeClipboardDescendantFactory,
  NativeClipboardDescendantRequest,
} from '../server/native-clipboard-descendants.ts';

const parent: NativeClipboardProcess = {
  pid: 1001,
  created: '134000000000000001',
  image: 'D:\\Apps\\Parent.exe',
  bits: 64,
};
const child: NativeClipboardProcess = {
  pid: 1002,
  created: '134000000000000002',
  image: 'D:\\Other\\Child.exe',
  bits: 32,
};
const grandchild: NativeClipboardProcess = {
  pid: 1003,
  created: '134000000000000003',
  image: 'D:\\More\\Grandchild.exe',
  bits: 64,
};
const rootHash = 'a'.repeat(64),
  childHash = 'c'.repeat(64),
  rule = { copy: false, paste: false, files: false, sensitive: true, maxTextBytes: 8192 };
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: value: NativeClipboardProcess。
 * 结果：返回分支计算值（``${value.pid}:${value.created}``）。
 * Result: Return the branch-computed value (``${value.pid}:${value.created}``).
 */
const key = (value: NativeClipboardProcess) => `${value.pid}:${value.created}`;
const ready = {
  present: true as const,
  ready: true,
  active: true,
  compatible: true,
  flags: 8,
  maximum: 8192,
  blockedCopy: 0,
  blockedPaste: 0,
};
/**
 * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
 * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
 * 输入 / Inputs: process = child; ancestor = parent。
 * 结果：返回分支计算值（`({ stage: 'request', id: randomUUID(), parent: ancestor as any, process: process…`）。
 * Result: Return the branch-computed value (`({ stage: 'request', id: randomUUID(), parent: ancestor as any, process: process…`).
 * 协作入口 / Collaborators: `randomUUID`.
 */
const request = (process = child, ancestor = parent): NativeClipboardDescendantRequest => ({
  stage: 'request',
  id: randomUUID(),
  parent: ancestor as any,
  process: process as any,
  sha256: childHash,
  suspended: false,
  handles: { process: '101', thread: '102', job: '103', file: '104' },
});
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: any; launch: NativeClipboardLaunch。
 * 结果：返回受控对象，公开字段包括 `service, options, file, assets, policies, commands, calls, configure, receive`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, options, file, assets, policies, commands, calls, configure, receive`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `resolve`, `mkdir`, `mkdtemp`, `join`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: any, launch?: NativeClipboardLaunch) {
  const base = resolve(
    process.env.SAKURA_NATIVE_CLIPBOARD_TEST_BASE || '.data/native-clipboard-test-temp',
    'descendant-units',
  );
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'unit-'));
  const assets = join(directory, 'assets');
  await mkdir(assets);
  const files = [];
  for (const name of [
    'SakuraClipboardPolicy.dll',
    'sakura-clipboard-controller.exe',
    'SakuraClipboardPolicy-x86.dll',
    'sakura-clipboard-controller-x86.exe',
    'MinHook-LICENSE.txt',
    'Detours-LICENSE.md',
  ]) {
    const data = Buffer.from(name);
    await writeFile(join(assets, name), data);
    files.push({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  await writeFile(
    join(assets, 'native-clipboard.json'),
    JSON.stringify({ version: 7, architecture: 'x64', build: 'b'.repeat(64), files }),
  );
  const file = join(directory, 'native.json');
  let inventory: NativeClipboardProcess[] = [parent],
    receive: Parameters<NativeClipboardDescendantFactory>[2],
    maintenance = false,
    intercept: (/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: args: string[]。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (args: string[]) => Promise<unknown>) | undefined;
  const policies = new Map<string, any>(),
    commands: { file: string; args: string[] }[] = [],
    calls: string[][] = [];
  /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: _file; _owner; handler。
   * 结果：返回受控对象，公开字段包括 `alive, close`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `alive, close`; the actual branch determines its shape.
   * 状态影响 / State effects: `receive`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  const descendants: NativeClipboardDescendantFactory = async (_file, _owner, handler) => {
    receive = handler;
    let alive = true;
    return {
      /**
       * 中文功能：读取夹具当前状态或暴露受控句柄，供断言观察。
       * English: Read current fixture state or expose a controlled handle for assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`alive`）。
       * Result: Return the branch-computed value (`alive`).
       */
      get alive() {
        return alive;
      },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `alive`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       */
      close: async () => {
        alive = false;
      },
    };
  };
  const options = {
    file,
    assets,
    supported: true,
    interval: 0,
    descendants,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`maintenance`）。
     * Result: Return the branch-computed value (`maintenance`).
     */
    maintenance: () => maintenance,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: image: string。
     * 结果：返回分支计算值（`(image === parent.image ? rootHash : childHash)`），以 Promise 交付。
     * Result: Return the branch-computed value (`(image === parent.image ? rootHash : childHash)`) through a Promise.
     */
    hashImage: async (image: string) => (image === parent.image ? rootHash : childHash),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: image: string。
     * 结果：返回分支计算值（`(image === child.image ? 32 : 64)`），以 Promise 交付。
     * Result: Return the branch-computed value (`(image === child.image ? 32 : 64)`) through a Promise.
     */
    imageBits: async (image: string): Promise<32 | 64> => (image === child.image ? 32 : 64),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _file: string; args: string[]。
     * 结果：返回受控对象，公开字段包括 `processes`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `processes`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `calls.push`, `intercept`, `policies.get`, `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(args[0], 'apply')`.
     */
    run: async (_file: string, args: string[]) => {
      calls.push([...args]);
      if (intercept) {
        const result = await intercept(args);
        if (result !== undefined) return result;
      }
      if (args[0] === 'list') return { processes: inventory };
      const id = args[2] + ':' + args[3];
      if (args[0] === 'status') return policies.get(id) || { present: false };
      assert.equal(args[0], 'apply');
      const status = { ...ready, active: args[8] === '1', flags: Number(args[6]), maximum: Number(args[7]) };
      policies.set(id, status);
      return status;
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: file; args; hooks; signal。
     * 结果：返回分支计算值（`launch(file, args, hooks, signal) / actual`），以 Promise 交付。
     * Result: Return the branch-computed value (`launch(file, args, hooks, signal) / actual`) through a Promise.
     * 协作入口 / Collaborators: `commands.push`, `launch`, `hooks.prepared`, `JSON.parse`.
     * 检查边界 / Checked boundaries: `assert.ok( journal.managed.some((item: NativeClipboardProcess) => key(item) === key(actual)), 'durable ownership precedes early at…`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    launch: (async (file, args, hooks, signal) => {
      commands.push({ file, args });
      if (launch) return launch(file, args, hooks, signal);
      const actual = args[0] === 'adopt' ? (args[2] === child.image ? child : grandchild) : parent;
      await hooks.prepared(actual);
      const journal = JSON.parse(await readFile(options.file, 'utf8'));
      assert.ok(
        journal.managed.some((item: NativeClipboardProcess) => key(item) === key(actual)),
        'durable ownership precedes early attachment',
      );
      policies.set(key(actual), { ...ready });
      await hooks.attached(actual, { ...ready });
      return actual;
    }) as NativeClipboardLaunch,
  };
  const service = new NativeClipboard(options);
  t.after(() => service.close());
  await service.init();
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: enabled = true; applications = [{ image: parent.image, sha256: rootHash, rul…。
   * 结果：返回分支计算值（`service.action({ action: 'configure', version: service.view().version, settings:…`）。
   * Result: Return the branch-computed value (`service.action({ action: 'configure', version: service.view().version, settings:…`).
   * 协作入口 / Collaborators: `service.action`, `service.view`.
   */
  const configure = (enabled = true, applications = [{ image: parent.image, sha256: rootHash, rule }]) =>
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
    policies,
    commands,
    calls,
    configure,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: value = request()。
     * 结果：返回分支计算值（`receive(value, { pid: 2000, created: '134000000000000009' })`）。
     * Result: Return the branch-computed value (`receive(value, { pid: 2000, created: '134000000000000009' })`).
     * 协作入口 / Collaborators: `receive`.
     */
    receive: (value = request()) => receive(value, { pid: 2000, created: '134000000000000009' }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: items: NativeClipboardProcess[]。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `inventory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    inventory: (items: NativeClipboardProcess[]) => {
      inventory = items;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `maintenance`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    maintenance: (value: boolean) => {
      maintenance = value;
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: handler: typeof intercept。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `intercept`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    intercept: (handler?: typeof intercept) => {
      intercept = handler;
    },
  };
}
/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
const deferred = () => {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CreateProcess descendant inherits cross-EXE rules and exact ancestry before matching x86 helper attachment
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.receive`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.ok(command.file.endsWith('-x86.exe'))`; `assert.equal(command.args[0], 'adopt')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('CreateProcess descendant inherits cross-EXE rules and exact ancestry before matching x86 helper attachment', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.receive();
  const command = f.commands[0];
  assert.ok(command.file.endsWith('-x86.exe'));
  assert.equal(command.args[0], 'adopt');
  assert.equal(command.args[2], child.image);
  assert.equal(command.args[3], childHash);
  assert.equal(command.args[5], '8');
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  const inherited = journal.managed.find((item: any) => item.pid === child.pid);
  assert.equal(inherited.sha256, childHash);
  assert.deepEqual(inherited.inheritance, {
    application: { image: parent.image, sha256: rootHash },
    parent: { pid: parent.pid, created: parent.created },
  });
  f.inventory([parent, child]);
  await f.service.action({ action: 'refresh' });
  assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
  assert.equal(f.policies.get(key(child)).active, true);
  await f.service.close();
  const restored = new NativeClipboard(f.options);
  t.after(() => restored.close());
  await restored.init();
  assert.equal(
    restored.view().processes.find((item) => item.pid === child.pid)?.inheritance?.parent.created,
    parent.created,
  );
  await restored.action({
    action: 'configure',
    version: restored.view().version,
    settings: { enabled: false, applications: [] },
  });
  assert.equal(f.policies.get(key(child)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: concurrent child journals and nested initializer descendants do not deadlock an ancestor controlled launch
 * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.inventory`, `f.configure`, `f.service.action`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(journal.managed.map((item: any) => item.pid).sort(), [1001, 1002, 1003])`; `assert.deepEqual(leaf.inheritance.application, { image: parent.image, sha256: rootHash })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('concurrent child journals and nested initializer descendants do not deadlock an ancestor controlled launch', async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(t, async (_file, args, hooks) => {
    const actual = args[0] === 'launch' ? parent : args[2] === child.image ? child : grandchild;
    await hooks.prepared(actual);
    f.policies.set(key(actual), { ...ready });
    if (actual === parent) await f.receive(request(child, parent));
    if (actual === child) await f.receive(request(grandchild, child));
    await hooks.attached(actual, { ...ready });
    return actual;
  });
  f.inventory([]);
  await f.configure();
  await f.service.action({
    action: 'launch',
    version: f.service.view().version,
    image: parent.image,
    sha256: rootHash,
    args: [],
  });
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.deepEqual(journal.managed.map((item: any) => item.pid).sort(), [1001, 1002, 1003]);
  const leaf = journal.managed.find((item: any) => item.pid === grandchild.pid);
  assert.deepEqual(leaf.inheritance.application, { image: parent.image, sha256: rootHash });
  assert.equal(leaf.inheritance.parent.pid, child.pid);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: simultaneous child requests preserve both journals and caller CREATE_SUSPENDED argument
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `request`, `Promise.all`.
 * 检查边界 / Checked boundaries: `assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[14], '1')`; `assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[15], String(parent.pid))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('simultaneous child requests preserve both journals and caller CREATE_SUSPENDED argument', async (t) => {
  const f = await fixture(t);
  await f.configure();
  const suspended = { ...request(), suspended: true };
  await Promise.all([f.receive(suspended), f.receive(request(grandchild))]);
  assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[14], '1');
  assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[15], String(parent.pid));
  assert.equal(f.commands.find((item) => item.args[2] === child.image)?.args[16], parent.created);
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(journal.managed.length, 3);
  assert.equal(new Set(journal.managed.map((item: any) => `${item.pid}:${item.created}`)).size, 3);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: missing or reused parent identities, maintenance and disabled saved rules cannot authorize a child
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `assert.rejects`, `f.receive`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.receive(request(child, { ...parent, created: '134000000000000010' })), /父进程归属/)`; `assert.rejects(f.receive(request(child, { ...parent, image: child.image })), /父进程归属/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('missing or reused parent identities, maintenance and disabled saved rules cannot authorize a child', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await assert.rejects(f.receive(request(child, { ...parent, created: '134000000000000010' })), /父进程归属/);
  await assert.rejects(f.receive(request(child, { ...parent, image: child.image })), /父进程归属/);
  f.maintenance(true);
  await assert.rejects(f.receive(), /迁移维护/);
  f.maintenance(false);
  await f.configure(false);
  await assert.rejects(f.receive(), /父进程归属/);
  assert.equal(f.commands.length, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: independent child policy mismatch fails before resume and retains precise failed ownership for recovery
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `assert.rejects`, `f.receive`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.receive(), /真实共享策略复核失败/)`; `assert.equal( journal.managed.find((item: any) => item.pid === child.pid).inheritance.parent.created, parent.created, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('independent child policy mismatch fails before resume and retains precise failed ownership for recovery', async (t) => {
  const f = await fixture(t, async (_file, _args, hooks) => {
    await hooks.prepared(child);
    await hooks.attached(child, { ...ready });
    assert.fail('the child cannot resume without its actual ready mapping');
  });
  await f.configure();
  await assert.rejects(f.receive(), /真实共享策略复核失败/);
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(
    journal.managed.find((item: any) => item.pid === child.pid).inheritance.parent.created,
    parent.created,
  );
  assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'error');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: service close aborts a journaled descendant before resume and waits for its adoption to settle
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.receive`, `adopting.catch`.
 * 检查边界 / Checked boundaries: `assert.rejects(adopting, /generation aborted/)`; `assert.equal(settled, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('service close aborts a journaled descendant before resume and waits for its adoption to settle', async (t) => {
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void,
    settled = false,
    resumed = false;
  const prepared = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = await fixture(t, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _file; _args; hooks; signal。
   * 结果：返回分支计算值（`child`），以 Promise 交付。
   * Result: Return the branch-computed value (`child`) through a Promise.
   * 验证场景 / Scenario: service close aborts a journaled descendant before resume and waits for its adoption to settle
   * 状态影响 / State effects: `resumed`, `settled`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `hooks.prepared`, `entered`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  async (_file, _args, hooks, signal) => {
    await hooks.prepared(child);
    entered();
    try {
      await new Promise<void>((_, reject) => {
        if (signal.aborted) reject(new Error('generation aborted'));
        else signal.addEventListener('abort', () => reject(new Error('generation aborted')), { once: true });
      });
      resumed = true;
      return child;
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 20));
      settled = true;
    }
  });
  await f.configure();
  const adopting = f.receive();
  void adopting.catch(() => {});
  await prepared;
  await f.service.close();
  await assert.rejects(adopting, /generation aborted/);
  assert.equal(settled, true);
  assert.equal(resumed, false);
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(
    journal.managed.find((item: any) => item.pid === child.pid).inheritance.parent.created,
    parent.created,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: saving a new rule retires all prepared descendant helpers before the durable rule generation changes
 * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.receive`, `adopting.catch`.
 * 检查边界 / Checked boundaries: `assert.rejects(adopting, /generation retired/)`; `assert.equal(settled, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('saving a new rule retires all prepared descendant helpers before the durable rule generation changes', async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>,
    entered!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void,
    settled = false;
  const prepared = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f = await fixture(t, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _file; _args; hooks; signal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: saving a new rule retires all prepared descendant helpers before the durable rule generation changes
   * 协作入口 / Collaborators: `hooks.prepared`, `entered`, `assert.fail`.
   * 检查边界 / Checked boundaries: `assert.fail('a retired helper cannot resume')`.
   */
  async (_file, _args, hooks, signal) => {
    await hooks.prepared(child);
    entered();
    await new Promise<void>(/**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _; reject。
     * 结果：返回分支计算值（`signal.addEventListener( 'abort', () => { void readFile(f.file, 'utf8').then((te…`）。
     * Result: Return the branch-computed value (`signal.addEventListener( 'abort', () => { void readFile(f.file, 'utf8').then((te…`).
     * 验证场景 / Scenario: saving a new rule retires all prepared descendant helpers before the durable rule generation changes
     * 协作入口 / Collaborators: `signal.addEventListener`.
     */
    (_, reject) =>
      signal.addEventListener(
        'abort',
        () => {
          void readFile(f.file, 'utf8').then((text) => {
            assert.equal(
              JSON.parse(text).settings.applications[0].rule.copy,
              false,
              'old rules remain saved until adoption is cancelled',
            );
            settled = true;
            reject(new Error('generation retired'));
          });
        },
        { once: true },
      ),
    );
    assert.fail('a retired helper cannot resume');
  });
  await f.configure();
  const adopting = f.receive();
  void adopting.catch(() => {});
  await prepared;
  await f.service.action({
    action: 'configure',
    version: f.service.view().version,
    settings: {
      enabled: true,
      applications: [{ image: parent.image, sha256: rootHash, rule: { ...rule, copy: true } }],
    },
  });
  await assert.rejects(adopting, /generation retired/);
  assert.equal(settled, true);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).settings.applications[0].rule.copy, true);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a list snapshot predating prepared ownership cannot retire that exact in-flight child
 * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `deferred`, `fixture`, `f.configure`, `f.intercept`.
 * 检查边界 / Checked boundaries: `assert.ok( JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => key(item) === key(child)), )`; `assert.equal(f.calls.filter((args) => args[0] === 'status' && args[2] === String(child.pid)).length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'a list snapshot predating prepared ownership cannot retire that exact in-flight child',
  { timeout: 10000 },
  async (t) => {
    const listEntered = deferred(),
      listRelease = deferred(),
      prepared = deferred(),
      attach = deferred();
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(child);
      prepared.resolve();
      await attach.promise;
      f.policies.set(key(child), { ...ready });
      await hooks.attached(child, { ...ready });
      return child;
    });
    await f.configure();
    f.intercept(async (args) => {
      if (args[0] !== 'list') return;
      listEntered.resolve();
      await listRelease.promise;
      return { processes: [parent] };
    });
    const scanning = f.service.action({ action: 'refresh' });
    await listEntered.promise;
    const adopting = f.receive();
    await prepared.promise;
    listRelease.resolve();
    await scanning;
    assert.ok(
      JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => key(item) === key(child)),
    );
    assert.equal(f.calls.filter((args) => args[0] === 'status' && args[2] === String(child.pid)).length, 0);
    f.intercept();
    attach.resolve();
    await adopting;
    assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
  },
);

for (const phase of ['prepared', 'attached'])
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `deferred`, `fixture`, `f.configure`, `f.receive`.
   * 检查边界 / Checked boundaries: `assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0)`; `assert.equal( JSON.parse(await readFile(f.file, 'utf8')).managed.find((item: any) => item.pid === child.pid) .inheritance.parent.c…`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(
    `inventory containing a child at ${phase} cannot start ordinary apply before adoption closes`,
    { timeout: 10000 },
    async (t) => {
      const entered = deferred(),
        release = deferred();
      let f: Awaited<ReturnType<typeof fixture>>;
      f = await fixture(t, /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _file; _args; hooks。
       * 结果：返回分支计算值（`child`），以 Promise 交付。
       * Result: Return the branch-computed value (`child`) through a Promise.
       * 协作入口 / Collaborators: `hooks.prepared`, `entered.resolve`, `f.policies.set`, `key`.
       * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
       * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
       */
      async (_file, _args, hooks) => {
        await hooks.prepared(child);
        if (phase === 'prepared') {
          entered.resolve();
          await release.promise;
        }
        f.policies.set(key(child), { ...ready });
        await hooks.attached(child, { ...ready });
        if (phase === 'attached') {
          entered.resolve();
          await release.promise;
        }
        return child;
      });
      await f.configure();
      const adopting = f.receive();
      await entered.promise;
      f.inventory([parent, child]);
      await f.service.action({ action: 'refresh' });
      assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0);
      assert.equal(
        JSON.parse(await readFile(f.file, 'utf8')).managed.find((item: any) => item.pid === child.pid)
          .inheritance.parent.created,
        parent.created,
      );
      release.resolve();
      await adopting;
      await f.service.action({ action: 'refresh' });
      assert.equal(f.service.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
    },
  );

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: native creation reservation skips even a selected same-EXE child before any broker request
 * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.inventory`, `f.intercept`.
 * 检查边界 / Checked boundaries: `assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(sameExe.pid)).length, 0)`; `assert.equal( JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => item.pid === sameExe.pid), false, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'native creation reservation skips even a selected same-EXE child before any broker request',
  { timeout: 10000 },
  async (t) => {
    const sameExe = { ...child, image: parent.image, bits: 64 as const };
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(sameExe);
      f.policies.set(key(sameExe), { ...ready });
      await hooks.attached(sameExe, { ...ready });
      return sameExe;
    });
    await f.configure();
    f.inventory([parent, sameExe]);
    f.intercept(async (args) =>
      args[0] === 'status' && args[2] === String(sameExe.pid)
        ? { present: false, reserved: true }
        : undefined,
    );
    await f.service.action({ action: 'refresh' });
    assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(sameExe.pid)).length, 0);
    assert.equal(
      JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => item.pid === sameExe.pid),
      false,
    );
    f.intercept();
    await f.receive({ ...request(sameExe), sha256: rootHash });
    assert.equal(
      JSON.parse(await readFile(f.file, 'utf8')).managed.find((item: any) => item.pid === sameExe.pid)
        .inheritance.parent.created,
      parent.created,
    );
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: broker adoption preempts a scan already awaiting this child status without waiting for the global queue
 * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `deferred`, `fixture`, `f.configure`, `f.inventory`.
 * 检查边界 / Checked boundaries: `assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'broker adoption preempts a scan already awaiting this child status without waiting for the global queue',
  { timeout: 10000 },
  async (t) => {
    const statusEntered = deferred(),
      statusRelease = deferred(),
      prepared = deferred(),
      attach = deferred();
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(child);
      prepared.resolve();
      await attach.promise;
      f.policies.set(key(child), { ...ready });
      await hooks.attached(child, { ...ready });
      return child;
    });
    await f.configure(true, [
      { image: parent.image, sha256: rootHash, rule },
      { image: child.image, sha256: childHash, rule },
    ]);
    f.inventory([parent, child]);
    f.intercept(async (args) => {
      if (args[0] !== 'status' || args[2] !== String(child.pid)) return;
      statusEntered.resolve();
      await statusRelease.promise;
      return { present: false };
    });
    const scanning = f.service.action({ action: 'refresh' });
    await statusEntered.promise;
    const adopting = f.receive();
    await prepared.promise;
    statusRelease.resolve();
    await scanning;
    assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0);
    f.intercept();
    attach.resolve();
    await adopting;
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: already-issued ordinary apply must close before adoption and its journal cannot become inherited ownership
 * 协作入口 / Collaborators: `deferred`, `fixture`, `f.configure`, `f.inventory`.
 * 检查边界 / Checked boundaries: `assert.equal(f.commands.length, 0)`; `assert.rejects(adopting, /独立持久归属/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'already-issued ordinary apply must close before adoption and its journal cannot become inherited ownership',
  { timeout: 10000 },
  async (t) => {
    const applyEntered = deferred(),
      applyRelease = deferred();
    const f = await fixture(t);
    await f.configure(true, [
      { image: parent.image, sha256: rootHash, rule },
      { image: child.image, sha256: childHash, rule },
    ]);
    f.inventory([parent, child]);
    f.intercept(async (args) => {
      if (args[0] !== 'apply' || args[2] !== String(child.pid)) return;
      applyEntered.resolve();
      await applyRelease.promise;
      throw new Error('controlled child creation is pending; ordinary attachment refused');
    });
    const scanning = f.service.action({ action: 'refresh' });
    await applyEntered.promise;
    const adopting = f.receive();
    void adopting.catch(() => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.commands.length, 0);
    applyRelease.resolve();
    await scanning;
    await assert.rejects(adopting, /独立持久归属/);
    assert.equal(f.commands.length, 0);
    const journal = JSON.parse(await readFile(f.file, 'utf8')).managed.find(
      (item: any) => item.pid === child.pid,
    );
    assert.equal(journal.sha256, childHash);
    assert.equal(journal.inheritance, undefined);
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a duplicate adoption cannot release the first exact identity reservation during prepared scanning
 * 状态影响 / State effects: `f`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `deferred`, `fixture`, `f.configure`, `f.receive`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.receive(), /已有受控接入/)`; `assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'a duplicate adoption cannot release the first exact identity reservation during prepared scanning',
  { timeout: 10000 },
  async (t) => {
    const prepared = deferred(),
      release = deferred();
    let f: Awaited<ReturnType<typeof fixture>>;
    f = await fixture(t, async (_file, _args, hooks) => {
      await hooks.prepared(child);
      prepared.resolve();
      await release.promise;
      f.policies.set(key(child), { ...ready });
      await hooks.attached(child, { ...ready });
      return child;
    });
    await f.configure();
    const adopting = f.receive();
    await prepared.promise;
    await assert.rejects(f.receive(), /已有受控接入/);
    f.inventory([parent, child]);
    await f.service.action({ action: 'refresh' });
    assert.equal(f.calls.filter((args) => args[0] === 'apply' && args[2] === String(child.pid)).length, 0);
    assert.equal(f.commands.length, 1);
    release.resolve();
    await adopting;
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a generation retired while waiting for the same child native operation cannot start adoption
 * 协作入口 / Collaborators: `deferred`, `fixture`, `f.configure`, `f.inventory`.
 * 检查边界 / Checked boundaries: `assert.rejects(adopting, /代际已改变/)`; `assert.equal(f.commands.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(
  'a generation retired while waiting for the same child native operation cannot start adoption',
  { timeout: 10000 },
  async (t) => {
    const applyEntered = deferred(),
      applyRelease = deferred();
    const f = await fixture(t);
    await f.configure(true, [
      { image: parent.image, sha256: rootHash, rule },
      { image: child.image, sha256: childHash, rule },
    ]);
    f.inventory([parent, child]);
    f.intercept(async (args) => {
      if (args[0] !== 'apply' || args[2] !== String(child.pid)) return;
      applyEntered.resolve();
      await applyRelease.promise;
      throw new Error('reserved child remains suspended');
    });
    const scanning = f.service.action({ action: 'refresh' });
    await applyEntered.promise;
    const adopting = f.receive();
    void adopting.catch(() => {});
    const closing = f.service.close();
    applyRelease.resolve();
    await scanning;
    await closing;
    await assert.rejects(adopting, /代际已改变/);
    assert.equal(f.commands.length, 0);
  },
);

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: legacy v4 assets recover and disable owned policies but cannot authorize reservation-free descendants
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.service.close`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(restored.view().processes.find((item) => item.pid === parent.pid)?.state, 'enforced')`; `assert.equal(brokers, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('legacy v4 assets recover and disable owned policies but cannot authorize reservation-free descendants', async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.close();
  const manifestPath = join(f.assets, 'native-clipboard.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, version: 4 }));
  let brokers = 0;
  const restored = new NativeClipboard({
    ...f.options,
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: legacy v4 assets recover and disable owned policies but cannot authorize reservation-free descendants
     * 失败 / Failure: `new Error('v4 cannot start a reservation-free broker')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     */
    descendants: async () => {
      brokers++;
      throw new Error('v4 cannot start a reservation-free broker');
    },
  });
  t.after(() => restored.close());
  await restored.init();
  assert.equal(restored.view().processes.find((item) => item.pid === parent.pid)?.state, 'enforced');
  assert.equal(brokers, 0);
  await assert.rejects(
    (restored as any).descendantLaunch(request(), { pid: 2000, created: '134000000000000009' }),
    /第 5 版/,
  );
  assert.equal(f.commands.length, 0);
  assert.equal(
    JSON.parse(await readFile(f.file, 'utf8')).managed.some((item: any) => item.pid === child.pid),
    false,
  );
  await restored.action({
    action: 'configure',
    version: restored.view().version,
    settings: { enabled: false, applications: [] },
  });
  assert.equal(f.policies.get(key(parent)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});

for (const version of [5, 6]) /**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `fixture`, `f.configure`, `f.service.close`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(restored.view().processes.find((item) => item.pid === parent.pid)?.state, 'enforced')`; `assert.equal(f.commands.length, 1)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test(`legacy v${version} assets keep reservation-based descendant adoption, recovery and disable with the v7 service`, async (t) => {
  const f = await fixture(t);
  await f.configure();
  await f.service.close();
  const manifestPath = join(f.assets, 'native-clipboard.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({ ...manifest, version }));
  const restored = new NativeClipboard(f.options);
  t.after(() => restored.close());
  await restored.init();
  assert.equal(restored.view().processes.find((item) => item.pid === parent.pid)?.state, 'enforced');
  await f.receive();
  assert.equal(f.commands.length, 1);
  assert.equal(f.commands[0].args[0], 'adopt');
  const journal = JSON.parse(await readFile(f.file, 'utf8'));
  assert.equal(
    journal.managed.find((item: any) => item.pid === child.pid)?.inheritance.parent.pid,
    parent.pid,
  );
  f.inventory([parent, child]);
  await restored.action({ action: 'refresh' });
  assert.equal(restored.view().processes.find((item) => item.pid === child.pid)?.state, 'enforced');
  await restored.action({
    action: 'configure',
    version: restored.view().version,
    settings: { enabled: false, applications: [] },
  });
  assert.equal(f.policies.get(key(parent)).active, false);
  assert.equal(f.policies.get(key(child)).active, false);
  assert.equal(JSON.parse(await readFile(f.file, 'utf8')).managed.length, 0);
});
