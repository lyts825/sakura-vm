/**
 * 模块职责：回归验证模块，围绕 `sandbox` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `sandbox`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: sandbox inputs default to isolated disposable environments and reject policy escape fields; creation persists immutable policy and produces independent sandboxes.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test, { after, type TestContext } from 'node:test';
import type { VMRecord } from '../server/model.ts';
import type { Engine } from '../server/runtime.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-sandbox-test-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(root, 'alpine.qcow2');
await writeFile(process.env.SAKURA_IMAGE_PATH, '');
const { Machines } = await import('../server/machines.ts');
const { Sandboxes, sandboxCreateSchema, sandboxRunSchema } = await import('../server/sandboxes.ts');
const { createSchema, vmDir } = await import('../server/model.ts');
const { Jobs } = await import('../server/jobs.ts');
const { Features } = await import('../server/features.ts');

after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-sandbox-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `machines, service, add, launches, jobs, jobsDirectory`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, service, add, launches, jobs, jobsDirectory`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdir`, `join`, `randomUUID`, `t.after`.
 */
async function fixture(t: TestContext) {
  const launches: string[][] = [];
  const engine = {
    whpxAvailable: false,
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
     * 输入 / Inputs: tool; args; options = {}。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 协作入口 / Collaborators: `launches.push`.
     */
    run: async (tool, args, options = {}) => {
      if (tool === 'sakura-qemu') {
        launches.push(args);
        await new Promise<void>((finish) => {
          if (options.signal?.aborted) finish();
          else options.signal?.addEventListener('abort', () => finish(), { once: true });
        });
      }
      return '';
    },
  } as Engine;
  const machines = new Machines(engine, fakeVmNetwork);
  await mkdir(join(root, 'machines'), { recursive: true });
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ stdout: '', stderr: '', code: 0 })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ stdout: '', stderr: '', code: 0 })`) through a Promise.
   */
  async () => ({ stdout: '', stderr: '', code: 0 });
  const jobsDirectory = join(root, randomUUID());
  const jobs = new Jobs('sandbox', jobsDirectory);
  const service = new Sandboxes(machines, jobs);
  t.after(async () => {
    await service.close();
    const running = [...machines.live.values()];
    for (const live of running) live.abort.abort();
    await Promise.allSettled(running.map((live) => live.done));
    await machines.close();
  });
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: sandbox = true; expired = false; onExpire: 'stop' | 'delete' = 'stop'。
   * 结果：返回分支计算值（`vm`），以 Promise 交付。
   * Result: Return the branch-computed value (`vm`) through a Promise.
   * 协作入口 / Collaborators: `randomUUID`, `createSchema.parse`, `id.slice`, `new Date().toISOString`.
   */
  const add = async (sandbox = true, expired = false, onExpire: 'stop' | 'delete' = 'stop') => {
    const id = randomUUID();
    const vm: VMRecord = {
      ...createSchema.parse({ name: 'sandbox-' + id.slice(0, 8) }),
      id,
      createdAt: new Date().toISOString(),
      snapshots: [],
      ...(sandbox
        ? {
            sandbox: {
              network: 'isolated' as const,
              onExpire,
              expiresAt: new Date(Date.now() + (expired ? -1000 : 60_000)).toISOString(),
            },
          }
        : {}),
    };
    machines.records.set(id, vm);
    await mkdir(vmDir(id));
    return vm;
  };
  return { machines, service, add, launches, jobs, jobsDirectory };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sandbox inputs default to isolated disposable environments and reject policy escape fields
 * 协作入口 / Collaborators: `sandboxCreateSchema.parse`, `assert.equal`, `sandboxCreateSchema.safeParse`, `sandboxRunSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(input.network, 'isolated')`; `assert.equal(input.onExpire, 'delete')`.
 */
test('sandbox inputs default to isolated disposable environments and reject policy escape fields', () => {
  const input = sandboxCreateSchema.parse({ name: 'sample' });
  assert.equal(input.network, 'isolated');
  assert.equal(input.onExpire, 'delete');
  assert.equal(input.lifetimeMinutes, 60);
  for (const value of [
    { cpus: 5 },
    { memoryMiB: 4097 },
    { diskGiB: 33 },
    { lifetimeMinutes: 0 },
    { lifetimeMinutes: 1441 },
    { forwards: [{ host: 8080, guest: 80 }] },
    { template: 'node' },
    { expiresAt: '2100-01-01T00:00:00.000Z' },
  ])
    assert.equal(sandboxCreateSchema.safeParse({ name: 'sample', ...value }).success, false);
  for (const value of [
    { command: ' ' },
    { command: 'a\0b' },
    { command: 'pwd', cwd: '../host' },
    { command: 'pwd', timeoutSeconds: 0 },
    { command: 'pwd', timeoutSeconds: 3601 },
    { command: 'pwd', artifacts: ['../private'] },
    { command: 'pwd', artifacts: ['/etc/shadow'] },
    { command: 'pwd', artifacts: ['ok', 'ok'] },
    { command: 'pwd', artifacts: ['dir\\file'] },
  ])
    assert.equal(sandboxRunSchema.safeParse(value).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: creation persists immutable policy and produces independent sandboxes
 * 协作入口 / Collaborators: `fixture`, `service.create`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(vm.sandbox.network, 'isolated')`; `assert.equal(vm.forwards.length, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('creation persists immutable policy and produces independent sandboxes', async (t) => {
  const { machines, service } = await fixture(t);
  const vm = await service.create({ name: 'created-sandbox' });
  assert.equal(vm.sandbox.network, 'isolated');
  assert.equal(vm.forwards.length, 0);
  assert.equal(vm.expired, false);
  const stored = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
  assert.deepEqual(stored.find((item: VMRecord) => item.id === vm.id).sandbox, vm.sandbox);
  await assert.rejects(machines.update(vm.id, { name: vm.name }), /沙箱资源/);
  await assert.rejects(machines.setForwards(vm.id, [{ host: 8080, guest: 80 }]), /沙箱资源/);
  await assert.rejects(machines.resize(vm.id, 16), /沙箱资源/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: temporary COW policy persists and puts only its writable drive in snapshot mode
 * 协作入口 / Collaborators: `fixture`, `service.create`, `assert.equal`, `JSON.parse`.
 * 检查边界 / Checked boundaries: `assert.equal(vm.sandbox.storage, 'discard-on-stop')`; `assert.equal(saved.find((row: VMRecord) => row.id === vm.id).sandbox.storage, 'discard-on-stop')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('temporary COW policy persists and puts only its writable drive in snapshot mode', async (t) => {
  const { machines, service, launches, add } = await fixture(t);
  const vm = await service.create({ name: 'transient-cow', storage: 'discard-on-stop' });
  assert.equal(vm.sandbox.storage, 'discard-on-stop');
  const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
  assert.equal(saved.find((row: VMRecord) => row.id === vm.id).sandbox.storage, 'discard-on-stop');
  assert.match(machines.commandline(vm.id).diskOptions, /,snapshot=on$/);
  await machines.start(vm.id);
  assert.equal(launches[0].filter((arg) => arg.includes('snapshot=on')).length, 1);
  assert.match(
    launches[0].find((arg) => arg.includes('snapshot=on'))!,
    /disk\.qcow2/,
  );
  assert.ok(!launches[0].find((arg) => arg.includes('seed.iso'))!.includes('snapshot=on'));
  await machines.terminateSandbox(vm.id);
  const ordinary = await add(false);
  await machines.start(ordinary.id);
  assert.equal(
    launches[1].some((arg) => arg.includes('snapshot=on')),
    false,
  );
  assert.equal(sandboxCreateSchema.safeParse({ name: 'bad', storage: 'commit' }).success, false);
  assert.equal(createSchema.safeParse({ name: 'ordinary', storage: 'discard-on-stop' }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sandbox operations cannot target ordinary instances
 * 协作入口 / Collaborators: `fixture`, `add`, `assert.rejects`, `service.control`.
 * 检查边界 / Checked boundaries: `assert.rejects(service.control(vm.id, 'destroy'), /不是沙箱/)`; `assert.throws(() => service.run(vm.id, { command: 'pwd' }), /不是沙箱/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('sandbox operations cannot target ordinary instances', async (t) => {
  const { service, add, machines } = await fixture(t);
  const vm = await add(false);
  await assert.rejects(service.control(vm.id, 'destroy'), /不是沙箱/);
  assert.throws(() => service.run(vm.id, { command: 'pwd' }), /不是沙箱/);
  await assert.rejects(machines.terminateSandbox(vm.id), /不是沙箱/);
  assert.equal(machines.records.has(vm.id), true);
  assert.deepEqual((await service.list()).sandboxes, []);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: QEMU isolates network while keeping only the controller SSH forward
 * 协作入口 / Collaborators: `fixture`, `add`, `machines.start`, `args.indexOf`.
 * 检查边界 / Checked boundaries: `assert.match(network, /^stream,id=sakura-net,/)`; `assert.equal(lease.policy.isolated, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('QEMU isolates network while keeping only the controller SSH forward', async (t) => {
  const { machines, add, launches } = await fixture(t);
  const vm = await add();
  await machines.start(vm.id);
  const args = launches[0],
    network = args[args.indexOf('-netdev') + 1];
  assert.match(network, /^stream,id=sakura-net,/);
  const lease = machines.live.get(vm.id)!.network!;
  assert.equal(lease.policy.isolated, true);
  assert.equal(lease.policy.ipv6, false);
  assert.deepEqual(lease.policy.forwards, [{ host: machines.live.get(vm.id)!.sshPort, guest: 22 }]);
  assert.ok(args.includes('-no-user-config'));
  const ordinary = await add(false);
  await machines.start(ordinary.id);
  assert.equal(machines.live.get(ordinary.id)!.network!.policy.isolated, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: expiry terminates powered-on guests even while a separate instance operation holds the lock
 * 状态影响 / State effects: `vm.sandbox!.expiresAt`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `add`, `machines.start`, `machines.locked`.
 * 检查边界 / Checked boundaries: `assert.equal(machines.live.has(vm.id), false)`; `assert.rejects(machines.start(vm.id), /已到期/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('expiry terminates powered-on guests even while a separate instance operation holds the lock', async (t) => {
  const { machines, add } = await fixture(t);
  const vm = await add();
  await machines.start(vm.id);
  let release!: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const held = machines.locked(
    vm.id,
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  vm.sandbox!.expiresAt = new Date(Date.now() - 1).toISOString();
  await machines.expireSandboxes();
  assert.equal(machines.live.has(vm.id), false);
  release();
  await held;
  await assert.rejects(machines.start(vm.id), /已到期/);
  await assert.rejects(machines.resume(vm.id), /已到期/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: startup without the plugin removes expired disposable disks but retains stop-only disks
 * 协作入口 / Collaborators: `fixture`, `add`, `writeFile`, `join`.
 * 检查边界 / Checked boundaries: `assert.equal(restarted.records.has(disposable.id), false)`; `assert.equal(restarted.records.has(retained.id), true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('startup without the plugin removes expired disposable disks but retains stop-only disks', async (t) => {
  const { machines, add } = await fixture(t);
  const disposable = await add(true, true, 'delete');
  const retained = await add(true, true, 'stop');
  const ordinary = await add(false);
  await writeFile(join(root, 'machines.json'), JSON.stringify([...machines.records.values()]));
  const restarted = new Machines(machines.engine, fakeVmNetwork);
  try {
    await restarted.init();
    assert.equal(restarted.records.has(disposable.id), false);
    assert.equal(restarted.records.has(retained.id), true);
    assert.equal(restarted.records.has(ordinary.id), true);
    await assert.rejects(readFile(join(vmDir(disposable.id), 'disk.qcow2')), { code: 'ENOENT' });
    await assert.rejects(restarted.start(retained.id), /已到期/);
  } finally {
    await restarted.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: commands preserve shell quoting, record output and terminate the VM on completion
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `add`, `service.run`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.throws(() => service.run(vm.id, { command: 'pwd' }), /操作仍在进行/)`; `assert.equal(job.status, 'done')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('commands preserve shell quoting, record output and terminate the VM on completion', async (t) => {
  const { machines, service, add, jobs } = await fixture(t);
  const vm = await add();
  let submitted = '';
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command; _timeout; _signal; output。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: commands preserve shell quoting, record output and terminate the VM on completion
   * 状态影响 / State effects: `submitted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `command.startsWith`, `output`.
   */
  async (_id, command, _timeout, _signal, output) => {
    if (command.startsWith('cd ')) {
      submitted = command;
      output?.('result\n');
    }
    return { stdout: 'result\n', stderr: '', code: 0 };
  };
  const job = service.run(vm.id, { command: "printf '%s' '$(touch host-file)'", cwd: "/workspace/a'b" });
  assert.throws(() => service.run(vm.id, { command: 'pwd' }), /操作仍在进行/);
  await jobs.wait(vm.id);
  assert.equal(job.status, 'done');
  assert.match(job.log, /result\n/);
  assert.match(job.log, /退出码：0/);
  assert.match(submitted, /^cd '\/workspace\/a'\\''b' && exec sh -c /);
  assert.equal(machines.live.has(vm.id), false);
  await service.control(vm.id, 'destroy');
  assert.equal(jobs.list()[0].id, job.id);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: nonzero exits, timeouts and cancellation all stop the entire guest
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `add`, `service.run`, `jobs.cancel`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, outcome === 'cancel' ? 'cancelled' : 'error')`; `assert.match( job.error || '', outcome === 'failure' ? /退出码 7/ : outcome === 'timeout' ? /超时/ : /取消/, )`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('nonzero exits, timeouts and cancellation all stop the entire guest', async (t) => {
  for (const outcome of ['failure', 'timeout', 'cancel'] as const) {
    const { machines, service, add, jobs } = await fixture(t);
    const vm = await add();
    let entered!: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void;
    const executing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; command; _timeout; signal。
     * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
     * 验证场景 / Scenario: nonzero exits, timeouts and cancellation all stop the entire guest
     * 协作入口 / Collaborators: `command.startsWith`, `entered`.
     */
    async (_id, command, _timeout, signal) => {
      if (!command.startsWith('cd ')) return { stdout: '', stderr: '', code: 0 };
      entered();
      if (outcome === 'failure') return { stdout: '', stderr: 'failed', code: 7 };
      await new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) reject(new Error('aborted'));
        else signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { stdout: '', stderr: '', code: 0 };
    };
    const job = service.run(vm.id, { command: 'sleep 30', timeoutSeconds: 1 });
    await executing;
    if (outcome === 'cancel') jobs.cancel(vm.id);
    await jobs.wait(vm.id);
    assert.equal(job.status, outcome === 'cancel' ? 'cancelled' : 'error');
    assert.match(
      job.error || '',
      outcome === 'failure' ? /退出码 7/ : outcome === 'timeout' ? /超时/ : /取消/,
    );
    assert.equal(machines.live.has(vm.id), false);
    assert.equal(
      job.execution?.outcome,
      outcome === 'failure' ? 'failed' : outcome === 'cancel' ? 'cancelled' : 'timeout',
    );
    if (outcome === 'failure') assert.equal(job.execution?.exitCode, 7);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: command metadata survives truncated output, destruction and history reload
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `add`, `service.run`, `jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.doesNotMatch(job.log, /original-command/)`; `assert.equal(job.execution?.command, 'original-command --quoted "value"')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('command metadata survives truncated output, destruction and history reload', async (t) => {
  const { machines, service, add, jobs, jobsDirectory } = await fixture(t);
  const vm = await add();
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command; _timeout; _signal; output。
   * 结果：返回受控对象，公开字段包括 `stdout, stderr, code`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `stdout, stderr, code`; the actual branch determines its shape.
   * 验证场景 / Scenario: command metadata survives truncated output, destruction and history reload
   * 协作入口 / Collaborators: `command.startsWith`, `output`, `'x'.repeat`.
   */
  async (_id, command, _timeout, _signal, output) => {
    if (command.startsWith('cd ')) {
      output?.('x'.repeat(50000));
      return { stdout: '', stderr: '', code: 9 };
    }
    return { stdout: '', stderr: '', code: 0 };
  };
  const job = service.run(vm.id, {
    command: 'original-command --quoted "value"',
    cwd: '/workspace',
    timeoutSeconds: 5,
  });
  await jobs.wait(vm.id);
  assert.doesNotMatch(job.log, /original-command/);
  assert.equal(job.execution?.command, 'original-command --quoted "value"');
  assert.equal(job.execution?.exitCode, 9);
  assert.ok(job.execution?.timings.commandMs! >= 0);
  await service.control(vm.id, 'destroy');
  const restored = new Jobs('sandbox', jobsDirectory);
  assert.deepEqual(restored.get(job.id!)?.execution, job.execution);
  await restored.close();
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sandbox plugin activates by itself, owns its routes and registers execution history
 * 协作入口 / Collaborators: `fixture`, `Features.create`, `assert.deepEqual`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(host.errors, {})`; `assert.deepEqual([...host.enabled], ['sandbox'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('sandbox plugin activates by itself, owns its routes and registers execution history', async (t) => {
  const { machines } = await fixture(t);
  const host = await Features.create(machines, ['sandbox']);
  try {
    assert.deepEqual(host.errors, {});
    assert.deepEqual([...host.enabled], ['sandbox']);
    assert.ok(host.serviceValue('sandboxes') instanceof Sandboxes);
    assert.ok(
      host
        .jobStores()
        .some((store) => store === (host.serviceValue('sandboxes') as InstanceType<typeof Sandboxes>).jobs),
    );
  } finally {
    await host.close();
  }
});
