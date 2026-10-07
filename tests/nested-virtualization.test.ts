/**
 * 模块职责：回归验证模块，围绕 `nested-virtualization` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `nested-virtualization`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: nested virtualization records actual guest flags and KVM availability without claiming a second VM boot.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Engine } from '../server/runtime.ts';
import type { Workspaces } from '../server/workspaces.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-nested-test-'));
process.env.SAKURA_DATA_DIR = root;
const { Machines } = await import('../server/machines.ts');
const { NextFeatures, nextFeatureCatalog } = await import('../server/next-features.ts');
const { createSchema } = await import('../server/model.ts');
const baseResult = z.object({ ready: z.boolean(), executed: z.boolean() }).passthrough();
const observation = baseResult.extend({
  cpuExtension: z.enum(['vmx', 'svm']).nullable(),
  kvmDevice: z.boolean(),
  nestedCandidate: z.boolean(),
  accelerator: z.string().nullable(),
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: nested virtualization records actual guest flags and KVM availability without claiming a second VM boot
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.equal`, `nextFeatureCatalog.find`, `randomUUID`, `machines.records.set`.
 * 检查边界 / Checked boundaries: `assert.equal(nextFeatureCatalog.find(([id]) => id === 'nested-virtualization')?.[5], 'available')`; `assert.equal(stopped.ready, false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('nested virtualization records actual guest flags and KVM availability without claiming a second VM boot', async () => {
  assert.equal(nextFeatureCatalog.find(([id]) => id === 'nested-virtualization')?.[5], 'available');
  const machines = new Machines({} as Engine, fakeVmNetwork),
    id = randomUUID();
  machines.records.set(id, {
    ...createSchema.parse({ name: 'nested-test' }),
    id,
    createdAt: new Date().toISOString(),
    snapshots: [],
  });
  const workspaces = {
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     * 验证场景 / Scenario: nested virtualization records actual guest flags and KVM availability without claiming a second VM boot
     */
    beforeConfigChange: () => () => {},
    projects: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'default'`）。
     * Result: Return the branch-computed value (`'default'`).
     * 验证场景 / Scenario: nested virtualization records actual guest flags and KVM availability without claiming a second VM boot
     */
    current: () => 'default', /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: vmId: string。
     * 结果：返回分支计算值（`vmId`）。
     * Result: Return the branch-computed value (`vmId`).
     * 验证场景 / Scenario: nested virtualization records actual guest flags and KVM availability without claiming a second VM boot
     */
    key: (vmId: string) => vmId },
  } as unknown as Workspaces;
  const features = new NextFeatures(machines, workspaces);
  try {
    const stopped = baseResult.parse(
      await features.action(id, { action: 'check', featureId: 'nested-virtualization' }),
    );
    assert.equal(stopped.ready, false);
    machines.live.set(id, { status: 'running', accelerator: 'tcg' } as any);
    const commands: string[] = [];
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id; command。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: nested virtualization records actual guest flags and KVM availability without claiming a second VM boot
     * 协作入口 / Collaborators: `commands.push`.
     */
    async (_id, command) => {
      commands.push(command);
      return { code: 0, stdout: 'CPU=flags\t: fpu vmx hypervisor\nKVM=yes\nKERNEL=6.18.3\n', stderr: '' };
    };
    const checked = observation.parse(
      await features.action(id, { action: 'check', featureId: 'nested-virtualization' }),
    );
    assert.equal(checked.ready, true);
    assert.equal(checked.executed, false);
    assert.equal(checked.cpuExtension, 'vmx');
    assert.equal(checked.kvmDevice, true);
    assert.equal(checked.nestedCandidate, true);
    assert.equal(checked.accelerator, 'tcg');
    assert.equal(commands.length, 1);
    const job = z
      .object({ status: z.string(), id: z.string().optional(), error: z.string().optional() })
      .parse(await features.action(id, { action: 'run', featureId: 'nested-virtualization' }));
    await features.jobs.wait(`${id}:nested-virtualization`);
    assert.equal(features.jobs.get(job.id!)?.status, 'done', features.jobs.get(job.id!)?.error);
    const result = await features.jobs.result(job.id!);
    assert.equal(result.executed, true);
    assert.equal(result.nestedCandidate, true);
    machines.exec = /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stdout: 'CPU=flags : fpu hypervisor\nKVM=no\nKERNEL=6.18.3\n', stder…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stdout: 'CPU=flags : fpu hypervisor\nKVM=no\nKERNEL=6.18.3\n', stder…`) through a Promise.
     * 验证场景 / Scenario: nested virtualization records actual guest flags and KVM availability without claiming a second VM boot
     */
    async () => ({
      code: 0,
      stdout: 'CPU=flags : fpu hypervisor\nKVM=no\nKERNEL=6.18.3\n',
      stderr: '',
    });
    const unsupported = observation.parse(
      await features.action(id, { action: 'check', featureId: 'nested-virtualization' }),
    );
    assert.equal(unsupported.ready, true);
    assert.equal(unsupported.nestedCandidate, false);
    assert.equal(unsupported.cpuExtension, null);
    assert.equal(unsupported.kvmDevice, false);
    await features.close();
    const restored = new NextFeatures(machines, workspaces);
    try {
      assert.equal((await restored.view(id)).executions.length, 4);
      assert.equal((await restored.view(id)).executions[0].result.nestedCandidate, false);
    } finally {
      await restored.close();
    }
  } finally {
    await features.close();
  }
});
