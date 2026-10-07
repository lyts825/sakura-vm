/**
 * 模块职责：回归验证模块，围绕 `hardware` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `hardware`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: CPU topology validates complete NUMA allocation and builds explicit QEMU resources; Virtio GPU and VirGL select distinct devices and reject the unsupported ARM64 PCI profile.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hardwareArguments, deviceArguments } from '../shared/hardware.ts';
const root = await mkdtemp(join(tmpdir(), 'sakura-hardware-'));
process.env.SAKURA_DATA_DIR = root;
const { createSchema, vmDir } = await import('../server/model.ts');
const { Machines } = await import('../server/machines.ts');
const { CapabilityActions } = await import('../server/capability-actions.ts');
const { reservationSchema, validateAdmission, saveResourcePolicy } =
  await import('../server/resource-policies.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: CPU topology validates complete NUMA allocation and builds explicit QEMU resources
 * 协作入口 / Collaborators: `createSchema.parse`, `hardwareArguments`, `assert.ok`, `args.includes`.
 * 检查边界 / Checked boundaries: `assert.ok(args.includes('2,sockets=2,cores=2,threads=1,maxcpus=4'))`; `assert.ok(args.includes('node,nodeid=1,memdev=sakura-numa-1,cpus=2,cpus=3'))`.
 */
test('CPU topology validates complete NUMA allocation and builds explicit QEMU resources', () => {
  const vm = createSchema.parse({
    name: 'numa',
    cpus: 2,
    memoryMiB: 512,
    hardware: {
      cpu: {
        sockets: 2,
        cores: 2,
        threads: 1,
        numa: [
          { memoryMiB: 256, cpus: [0, 1] },
          { memoryMiB: 256, cpus: [2, 3] },
        ],
      },
    },
  });
  const args = hardwareArguments(vm);
  assert.ok(args.includes('2,sockets=2,cores=2,threads=1,maxcpus=4'));
  assert.ok(args.includes('node,nodeid=1,memdev=sakura-numa-1,cpus=2,cpus=3'));
  for (const cpu of [
    { sockets: 1, cores: 1, threads: 1 },
    { sockets: 8, cores: 8, threads: 1 },
    { sockets: 1, cores: 2, threads: 1, numa: [{ memoryMiB: 512, cpus: [0, 0] }] },
    { sockets: 1, cores: 2, threads: 1, numa: [{ memoryMiB: 256, cpus: [0, 1] }] },
  ])
    assert.throws(() => createSchema.parse({ name: 'bad', hardware: { cpu } }));
  assert.throws(() =>
    createSchema.parse({ name: 'bad', memoryMiB: 512, hardware: { memory: { maxMiB: 256, slots: 2 } } }),
  );
  assert.ok(
    !deviceArguments({
      ...vm,
      hardware: {
        devices: {
          networkCard: 'e1000',
          graphics: 'none',
          randomDevice: false,
          balloon: false,
          diskCache: 'none',
          discard: true,
        },
      },
    }).includes('virtio-balloon-pci'),
  );
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Virtio GPU and VirGL select distinct devices and reject the unsupported ARM64 PCI profile
 * 协作入口 / Collaborators: `createSchema.parse`, `assert.ok`, `deviceArguments(twoD).some`, `deviceArguments`.
 * 检查边界 / Checked boundaries: `assert.ok(deviceArguments(twoD).some((arg) => arg.startsWith('virtio-gpu-pci,')))`; `assert.ok(deviceArguments(virgl).some((arg) => arg.startsWith('virtio-gpu-gl-pci,')))`.
 */
test('Virtio GPU and VirGL select distinct devices and reject the unsupported ARM64 PCI profile', () => {
  const twoD = createSchema.parse({ name: 'gpu2d',
    hardware: { devices: { graphics: 'virtio-gpu' } } });
  const virgl = createSchema.parse({ name: 'gpu3d',
    hardware: { devices: { graphics: 'virgl' } } });
  assert.ok(deviceArguments(twoD).some((arg) => arg.startsWith('virtio-gpu-pci,')));
  assert.ok(deviceArguments(virgl).some((arg) => arg.startsWith('virtio-gpu-gl-pci,')));
  assert.equal(createSchema.safeParse({ name: 'arm-gpu', architecture: 'aarch64',
    distro: 'debian', firmware: 'uefi',
    hardware: { devices: { graphics: 'virgl' } } }).success, false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: resource admission reserves physical memory and serializes CPU budgets without double counting current VM
 * 协作入口 / Collaborators: `reservationSchema.parse`, `assert.doesNotThrow`, `assert.throws`.
 * 检查边界 / Checked boundaries: `assert.doesNotThrow(() => validateAdmission(policy, a, [a, b], host))`; `assert.throws(() => validateAdmission(policy, { ...a, memoryMiB: 3072 }, [a, b], host), /预留内存/)`.
 */
test('resource admission reserves physical memory and serializes CPU budgets without double counting current VM', () => {
  const policy = reservationSchema.parse({ enabled: true, hostReserveMiB: 1024, maxRunningCpus: 4 });
  const a = { id: 'a', memoryMiB: 2048, cpus: 2 },
    b = { id: 'b', memoryMiB: 1024, cpus: 2 };
  const host = { totalMemoryMiB: 4096, freeMemoryMiB: 1000, logicalCpus: 8 };
  assert.doesNotThrow(() => validateAdmission(policy, a, [a, b], host));
  assert.throws(() => validateAdmission(policy, { ...a, memoryMiB: 3072 }, [a, b], host), /预留内存/);
  assert.throws(() => validateAdmission(policy, { ...a, cpus: 3 }, [a, b], host), /vCPU/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: hardware capabilities persist through restart, reject live edits and enforce admission before QEMU launch
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `machines.init`, `randomUUID`, `mkdir`, `vmDir`.
 * 检查边界 / Checked boundaries: `assert.equal(reloaded.get(id).hardware?.cpu?.cores, 4)`; `assert.equal(reloaded.get(id).hardware?.devices?.discard, true)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('hardware capabilities persist through restart, reject live edits and enforce admission before QEMU launch', async (t) => {
  const launched: string[][] = [];
  const engine: any = {
    runtime: { /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: hardware capabilities persist through restart, reject live edits and enforce admission before QEMU launch
     */
    close: async () => {} },
    whpxAvailable: false,
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _tool: string; args: string[]; options: any。
     * 结果：返回分支计算值（`''`），以 Promise 交付。
     * Result: Return the branch-computed value (`''`) through a Promise.
     * 验证场景 / Scenario: hardware capabilities persist through restart, reject live edits and enforce admission before QEMU launch
     * 协作入口 / Collaborators: `launched.push`.
     */
    run: async (_tool: string, args: string[], options: any) => {
      launched.push(args);
      await new Promise<void>((resolve) =>
        options.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      return '';
    },
  };
  const machines = new Machines(engine, fakeVmNetwork);
  await machines.init();
  const id = randomUUID();
  await mkdir(vmDir(id));
  machines.records.set(id, {
    ...createSchema.parse({ name: 'hardware', cpus: 1 }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: '', stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: '', stderr: '' })`) through a Promise.
   * 验证场景 / Scenario: hardware capabilities persist through restart, reject live edits and enforce admission before QEMU launch
   */
  async () => ({ code: 0, stdout: '', stderr: '' });
  t.after(async () => {
    for (const live of machines.live.values()) live.abort.abort();
    await machines.close();
  });
  const actions = new CapabilityActions(machines, {} as any),
    signal = new AbortController().signal;
  await actions.run(
    id,
    'cpu-topology',
    { mode: 'save', topology: { sockets: 1, cores: 4, threads: 1 } },
    signal,
  );
  await actions.run(
    id,
    'device-profiles',
    { mode: 'save', name: 'trim', profile: { discard: true } },
    signal,
  );
  await actions.run(id, 'device-profiles', { mode: 'apply', name: 'trim' }, signal);
  await actions.run(id, 'ipv6', { mode: 'save', enabled: true }, signal);
  const reloaded = new Machines(engine, fakeVmNetwork);
  await reloaded.init();
  t.after(() => reloaded.close());
  assert.equal(reloaded.get(id).hardware?.cpu?.cores, 4);
  assert.equal(reloaded.get(id).hardware?.devices?.discard, true);
  await saveResourcePolicy({ enabled: true, maxRunningCpus: 1, hostReserveMiB: 0 });
  const other = randomUUID();
  machines.records.set(other, { ...machines.get(id), id: other, name: 'other' });
  await machines.start(id);
  await assert.rejects(machines.configureHardware(id, {}), /停止/);
  await assert.rejects(machines.start(other), /vCPU/);
  assert.equal(launched.length, 1);
  assert.ok(launched[0].includes('1,sockets=1,cores=4,threads=1,maxcpus=4'));
  assert.ok(launched[0].some((arg) => arg.includes('discard=unmap')));
  assert.ok(launched[0].some((arg) => arg.startsWith('stream,id=sakura-net,')));
  assert.equal(machines.live.get(id)!.network!.policy.ipv6, true);
  machines.live.get(id)!.abort.abort();
  await machines.live.get(id)!.done;
  await saveResourcePolicy({ enabled: false });
});
