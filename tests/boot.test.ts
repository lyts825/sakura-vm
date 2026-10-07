/**
 * 模块职责：回归验证模块，围绕 `boot` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `boot`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: SSH authentication alone cannot mark an unprovisioned guest ready; stopping during a readiness probe cancels it and cannot revive the guest.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import { createSshKey } from '../server/seed.ts';
import { freePort } from '../server/qmp.ts';
import ssh2 from 'ssh2';
const { Server: SshServer } = ssh2;

const root = await mkdtemp(join(tmpdir(), 'sakura-boot-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const key = createSshKey();
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-boot-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext; whpxAvailable = false。
 * 结果：返回受控对象，公开字段包括 `machines, id, commands`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, id, commands`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `machines.records.set`, `createSchema.parse`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
async function fixture(t: TestContext, whpxAvailable = false) {
  const commands: string[][] = [];
  const engine = {
    whpxAvailable,
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    close: async () => {} },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool; args; options = {}。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 协作入口 / Collaborators: `commands.push`.
     */
    run: async (_tool, args, options = {}) => {
      commands.push(args);
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) resolve();
        else options.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return '';
    },
  } as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'boot-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  await mkdir(vmDir(id));
  await writeFile(join(vmDir(id), 'id_rsa'), key.privateText);
  t.after(async () => {
    if (machines.live.has(id)) await machines.stop(id, true);
    await machines.close();
  });
  return { machines, id, commands };
}

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: condition: () => boolean。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 协作入口 / Collaborators: `Date.now`, `condition`, `assert.ok`, `delay`.
 * 检查边界 / Checked boundaries: `assert.ok(Date.now() < deadline, 'State transition did not finish')`.
 */
async function eventually(condition: /**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
 * Result: The declared return type defines the result; its test provider supplies the implementation.
 */
() => boolean) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'State transition did not finish');
    await delay(10);
  }
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `promise, resolve`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `promise, resolve`; the actual branch determines its shape.
 */
function deferredProbe() {
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: result: { stdout: string; stderr: string; code: number }。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  (result: { stdout: string; stderr: string; code: number }) => void;
  const promise = new Promise<{ stdout: string; stderr: string; code: number }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const [available, requested, expected] of [
  [true, 'auto', 'whpx'],
  [false, 'auto', 'tcg'],
  [true, 'tcg', 'tcg'],
  [false, 'whpx', 'whpx'],
] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `machines.get(id).accelerator`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `machines.get`, `machines.start`, `assert.equal`.
   * 检查边界 / Checked boundaries: `assert.equal((await machines.view(id)).activeAccelerator, expected)`; `assert.equal(machines.get(id).accelerator, requested)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`acceleration ${requested} resolves to ${expected} when WHPX availability is ${available}`, async (t) => {
    const { machines, id, commands } = await fixture(t, available);
    machines.get(id).accelerator = requested;
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 0 })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 0 })`) through a Promise.
     */
    async () => ({ stdout: '', stderr: '', code: 0 });
    await machines.start(id);
    assert.equal((await machines.view(id)).activeAccelerator, expected);
    assert.equal(machines.get(id).accelerator, requested);
    assert.equal(commands[0][commands[0].indexOf('-cpu') + 1], 'Nehalem-v1');
  });
}

for (const distro of ['alpine', 'debian', 'ubuntu'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `machines.get(id).distro`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `machines.get`, `machines.start`, `assert.ok`.
   * 检查边界 / Checked boundaries: `assert.ok(args.includes('virtio-balloon-pci'))`; `assert.ok(seed)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`${distro} exposes a readable NoCloud seed and waits for its own initialization marker`, async (t) => {
    const { machines, id, commands } = await fixture(t);
    machines.get(id).distro = distro;
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; command。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.match`.
     * 检查边界 / Checked boundaries: `assert.match(command, distro === 'alpine' ? /\.bootstrap-complete/ : /instance\/boot-finished/)`.
     */
    async (_id, command) => {
      assert.match(command, distro === 'alpine' ? /\.bootstrap-complete/ : /instance\/boot-finished/);
      return { stdout: '', stderr: '', code: 0 };
    };
    await machines.start(id);
    const args = commands[0];
    assert.ok(args.includes('virtio-balloon-pci'));
    const seed = args.find((arg) => arg.includes('seed.iso'))!;
    assert.ok(seed);
    if (distro === 'alpine') {
      assert.match(seed, /media=cdrom/);
      assert.ok(args.includes('type=1,serial=ds=nocloud'));
    } else {
      assert.match(seed, /if=virtio,format=raw/);
      assert.ok(!args.some((arg) => arg.includes('ds=nocloud')));
    }
    await eventually(() => machines.state(id) === 'running');
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH authentication alone cannot mark an unprovisioned guest ready
 * 状态影响 / State effects: `machines.exec`, `provisioned`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.start`, `assert.ok`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok(probes > 0)`; `assert.equal(machines.state(id), 'starting')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH authentication alone cannot mark an unprovisioned guest ready', async (t) => {
  const { machines, id } = await fixture(t);
  let provisioned = false;
  let probes = 0;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: SSH authentication alone cannot mark an unprovisioned guest ready
   * 协作入口 / Collaborators: `assert.match`.
   * 检查边界 / Checked boundaries: `assert.match(command, /test -f \/var\/lib\/cloud\/\.bootstrap-complete/)`.
   */
  async (_id, command) => {
    assert.match(command, /test -f \/var\/lib\/cloud\/\.bootstrap-complete/);
    probes++;
    return { stdout: '', stderr: '', code: provisioned ? 0 : 1 };
  };
  await machines.start(id);
  assert.ok(probes > 0);
  assert.equal(machines.state(id), 'starting');
  provisioned = true;
  await eventually(() => machines.state(id) === 'running');
  assert.ok(probes > 1);
});

for (const distro of ['alpine', 'debian', 'ubuntu'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: t。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `machines.get(id).distro`, `machines.get(id).bootstrapped`, `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `fixture`, `deferredProbe`, `machines.get`, `machines.start`.
   * 检查边界 / Checked boundaries: `assert.equal(machines.state(id), 'starting')`; `assert.equal(machines.get(id).bootstrapped, false)`.
   * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
   * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
   */
  test(`${distro} cannot acknowledge its first boot before guest persistence completes`, async (t) => {
    const { machines, id } = await fixture(t), barrier = deferredProbe();
    machines.get(id).distro = distro;
    machines.get(id).bootstrapped = false;
    let captured = '';
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; command; _timeout; signal。
     * 结果：返回分支计算值（`Promise.race([barrier.promise, new Promise<never>((_resolve, reject) => signal?.…`），以 Promise 交付。
     * Result: Return the branch-computed value (`Promise.race([barrier.promise, new Promise<never>((_resolve, reject) => signal?.…`) through a Promise.
     * 状态影响 / State effects: `captured`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `assert.match`, `Promise.race`.
     * 检查边界 / Checked boundaries: `assert.match(command, /(?:&& |\n)\/bin\/sync(?:\n|$)/)`.
     */
    async (_id, command, _timeout, signal) => {
      captured = command;
      assert.match(command, /(?:&& |\n)\/bin\/sync(?:\n|$)/);
      return Promise.race([barrier.promise, new Promise<never>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))]);
    };
    await machines.start(id);
    machines.log(id, 'SAKURA_READY\n');
    await eventually(() => Boolean(captured));
    assert.equal(machines.state(id), 'starting');
    assert.equal(machines.get(id).bootstrapped, false);
    barrier.resolve({ stdout: '', stderr: '', code: 0 });
    await eventually(() => machines.state(id) === 'running');
    assert.equal(machines.get(id).bootstrapped, true);
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: stopping during a readiness probe cancels it and cannot revive the guest
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `deferredProbe`, `machines.start`, `machines.stop`.
 * 检查边界 / Checked boundaries: `assert.equal(signal?.aborted, true)`; `assert.equal(machines.state(id), 'stopped')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('stopping during a readiness probe cancels it and cannot revive the guest', async (t) => {
  const { machines, id } = await fixture(t);
  const probe = deferredProbe();
  let signal: AbortSignal | undefined;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; _command; _timeout; bootSignal。
   * 结果：返回分支计算值（`Promise.race([ probe.promise, new Promise<never>((_resolve, reject) => bootSigna…`），以 Promise 交付。
   * Result: Return the branch-computed value (`Promise.race([ probe.promise, new Promise<never>((_resolve, reject) => bootSigna…`) through a Promise.
   * 验证场景 / Scenario: stopping during a readiness probe cancels it and cannot revive the guest
   * 状态影响 / State effects: `signal`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `Promise.race`.
   */
  async (_id, _command, _timeout, bootSignal) => {
    signal = bootSignal;
    return Promise.race([
      probe.promise,
      new Promise<never>((_resolve, reject) =>
        bootSignal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
      ),
    ]);
  };
  await machines.start(id);
  await machines.stop(id, true);
  assert.equal(signal?.aborted, true);
  probe.resolve({ stdout: '', stderr: '', code: 0 });
  await delay(20);
  assert.equal(machines.state(id), 'stopped');
  assert.equal(machines.live.size, 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a fragmented kernel panic fails immediately even if SSH later responds
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `deferredProbe`, `machines.start`, `machines.log`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.state(id), 'starting')`; `assert.equal(machines.state(id), 'error')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a fragmented kernel panic fails immediately even if SSH later responds', async (t) => {
  const { machines, id } = await fixture(t);
  const probe = deferredProbe();
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`probe.promise`），以 Promise 交付。
   * Result: Return the branch-computed value (`probe.promise`) through a Promise.
   * 验证场景 / Scenario: a fragmented kernel panic fails immediately even if SSH later responds
   */
  async () => probe.promise;
  await machines.start(id);
  machines.log(id, '[0.123] Kernel panic - not sync');
  assert.equal(machines.state(id), 'starting');
  machines.log(id, 'ing: IO-APIC + timer does not work!\n');
  assert.equal(machines.state(id), 'error');
  assert.match((await machines.view(id)).lastError!, /Kernel panic/);
  probe.resolve({ stdout: '', stderr: '', code: 0 });
  await delay(20);
  assert.equal(machines.state(id), 'error');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an SSH peer that never sends its banner is bounded and cancellable
 * 状态影响 / State effects: `machines.exec`, `live.sshPort`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.start`, `eventually`, `createServer`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.connect(id, 100), /timed out/)`; `assert.rejects(machines.connect(id, 10000, abort.signal))`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('an SSH peer that never sends its banner is bounded and cancellable', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: an SSH peer that never sends its banner is bounded and cancellable
   */
  async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const live = machines.live.get(id)!;
  live.sshPort = (server.address() as { port: number }).port;
  await assert.rejects(machines.connect(id, 100), /timed out/);
  const abort = new AbortController();
  const accepted = once(server, 'connection');
  const rejected = assert.rejects(machines.connect(id, 10000, abort.signal));
  await accepted;
  abort.abort();
  await rejected;
  await eventually(() => live.clients.size === 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: aborting or timing out a command after SSH is ready closes the session promptly
 * 状态影响 / State effects: `machines.exec`, `live.sshPort`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.exec.bind`, `machines.start`, `eventually`.
 * 检查边界 / Checked boundaries: `assert.rejects( machines.exec(id, 'long command', 10000, abort.signal, () => { started = true; }), /已取消/, )`; `assert.rejects(machines.exec(id, 'long command', 250), /超时/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('aborting or timing out a command after SSH is ready closes the session promptly', async (t) => {
  const { machines, id } = await fixture(t);
  const exec = machines.exec.bind(machines);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: aborting or timing out a command after SSH is ready closes the session promptly
   */
  async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  machines.exec = exec;
  const peers = new Set<import('ssh2').Connection>();
  const server = new SshServer({ hostKeys: [key.privateText] }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: peer。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: aborting or timing out a command after SSH is ready closes the session promptly
   * 协作入口 / Collaborators: `peers.add`, `peer.on`.
   */
  (peer) => {
    peers.add(peer);
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    peer.on('authentication', (context) => context.accept());
    peer.on('ready', () =>
      peer.on('session', (accept) => {
        accept().on('exec', (acceptCommand) => {
          const channel = acceptCommand();
          channel.on('error', () => {});
          channel.write('command started\n');
        });
      }),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const live = machines.live.get(id)!;
  live.sshPort = (server.address() as { port: number }).port;
  const abort = new AbortController();
  let started = false;
  const cancelled = assert.rejects(
    machines.exec(id, 'long command', 10000, abort.signal, () => {
      started = true;
    }),
    /已取消/,
  );
  await eventually(() => started);
  abort.abort();
  await cancelled;
  await eventually(() => live.clients.size === 0);
  await assert.rejects(machines.exec(id, 'long command', 250), /超时/);
  await eventually(() => live.clients.size === 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a briefly refused SSH connection retries within the original deadline
 * 状态影响 / State effects: `machines.exec`, `live.sshPort`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.start`, `eventually`, `machines.live.get`.
 * 检查边界 / Checked boundaries: `assert.equal(live.clients.size, 1, 'failed attempts release their clients')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a briefly refused SSH connection retries within the original deadline', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: a briefly refused SSH connection retries within the original deadline
   */
  async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  const live = machines.live.get(id)!;
  live.sshPort = await freePort();
  const peers = new Set<import('ssh2').Connection>();
  const server = new SshServer({ hostKeys: [key.privateText] }, (peer) => {
    peers.add(peer);
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    peer.on('authentication', (context) => context.accept());
  });
  t.after(async () => {
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const connection = machines.connect(id, 2000);
  await delay(150);
  server.listen(live.sshPort, '127.0.0.1');
  await once(server, 'listening');
  const client = await connection;
  assert.equal(live.clients.size, 1, 'failed attempts release their clients');
  client.end();
  await eventually(() => live.clients.size === 0);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH refusal retries honor cancellation and cannot cross a VM restart
 * 状态影响 / State effects: `machines.exec`, `live.sshPort`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `machines.start`, `eventually`, `machines.live.get`.
 * 检查边界 / Checked boundaries: `assert.rejects(machines.connect(id, 2000, abort.signal), { name: 'AbortError' })`; `assert.rejects(machines.connect(id, 2000), /已停止/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH refusal retries honor cancellation and cannot cross a VM restart', async (t) => {
  const { machines, id } = await fixture(t);
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 0 })`) through a Promise.
   * 验证场景 / Scenario: SSH refusal retries honor cancellation and cannot cross a VM restart
   */
  async () => ({ stdout: '', stderr: '', code: 0 });
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  const live = machines.live.get(id)!;
  live.sshPort = await freePort();
  const abort = new AbortController();
  const cancelled = assert.rejects(machines.connect(id, 2000, abort.signal), { name: 'AbortError' });
  await delay(50);
  abort.abort();
  await cancelled;
  await eventually(() => live.clients.size === 0);
  const stopped = assert.rejects(machines.connect(id, 2000), /已停止/);
  await delay(50);
  await machines.stop(id, true);
  await machines.start(id);
  await stopped;
  assert.notEqual(machines.live.get(id), live);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: interrupting a clone rekey preserves the old key until the new host identity is durable
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `createSshKey`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(authorized.has(key.publicText), true, 'the on-disk controller key must still authenticate')`; `assert.equal(await readFile(join(vmDir(id), 'id_rsa'), 'utf8'), key.privateText)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('interrupting a clone rekey preserves the old key until the new host identity is durable', async (t) => {
  const { machines, id } = await fixture(t);
  const pending = createSshKey();
  await writeFile(join(vmDir(id), 'identity.json'), JSON.stringify(pending));
  const authorized = new Set([key.publicText]);
  let prepared = false;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command; _timeout; signal。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: interrupting a clone rekey preserves the old key until the new host identity is durable
   * 状态影响 / State effects: `prepared`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `command.includes`, `authorized.clear`, `authorized.add`.
   */
  async (_id, command, _timeout, signal) => {
    if (!command.includes('authorized_keys')) return { stdout: '', stderr: '', code: 0 };
    if (!command.includes('>> /root/.ssh/authorized_keys')) authorized.clear();
    authorized.add(pending.publicText);
    prepared = true;
    return new Promise((_resolve, reject) =>
      signal?.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }),
    );
  };
  await machines.start(id);
  await eventually(() => prepared);
  await machines.stop(id, true);
  assert.equal(authorized.has(key.publicText), true, 'the on-disk controller key must still authenticate');
  assert.equal(await readFile(join(vmDir(id), 'id_rsa'), 'utf8'), key.privateText);
  assert.equal(
    JSON.parse(await readFile(join(vmDir(id), 'identity.json'), 'utf8')).privateText,
    pending.privateText,
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a completed clone rekey publishes the host key before removing guest access through the old key
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `createSshKey`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(stages, ['add', 'remove'])`; `assert.equal(correctOrder, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a completed clone rekey publishes the host key before removing guest access through the old key', async (t) => {
  const { machines, id } = await fixture(t);
  const pending = createSshKey();
  await writeFile(join(vmDir(id), 'identity.json'), JSON.stringify(pending));
  const stages: string[] = [];
  let correctOrder = true;
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: a completed clone rekey publishes the host key before removing guest access through the old key
   * 状态影响 / State effects: `correctOrder`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `command.includes`, `readFile`, `join`, `vmDir`.
   * 检查边界 / Checked boundaries: `assert.match(command, /\/bin\/sync\n$/)`.
   */
  async (_id, command) => {
    if (command.includes('authorized_keys')) {
      const stored = await readFile(join(vmDir(id), 'id_rsa'), 'utf8');
      if (command.includes('>> /root/.ssh/authorized_keys')) {
        stages.push('add');
        correctOrder &&= stored === key.privateText;
      } else {
        stages.push('remove');
        correctOrder &&= stored === pending.privateText;
        assert.match(command, /\/bin\/sync\n$/);
      }
    }
    return { stdout: '', stderr: '', code: 0 };
  };
  await machines.start(id);
  await eventually(() => machines.state(id) === 'running');
  assert.deepEqual(stages, ['add', 'remove']);
  assert.equal(correctOrder, true);
  assert.equal(await readFile(join(vmDir(id), 'id_rsa'), 'utf8'), pending.privateText);
  await assert.rejects(readFile(join(vmDir(id), 'identity.json')), { code: 'ENOENT' });
});
