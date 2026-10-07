/**
 * 模块职责：回归验证模块，围绕 `service-mesh` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `service-mesh`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: mesh saves legacy-compatible policies and binds persistent sidecars to a private project; private projects reuse ports while shared policy saves and network edits cannot race reservations.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines as MachineType } from '../server/machines.ts';
import type { Engine } from '../server/runtime.ts';

const parent = process.env.SAKURA_DATA_DIR || tmpdir();
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'sakura-mesh-tests-'));
process.env.SAKURA_DATA_DIR = root;
const { ServiceMesh, envoySidecarConfig, serviceMeshInput } = await import('../server/service-mesh.ts');
const { Machines } = await import('../server/machines.ts');
const { Workspaces } = await import('../server/workspaces.ts');
const { vmDir } = await import('../server/model.ts');
const { NextFeatures } = await import('../server/next-features.ts');
const { meshIdentityFixture } = await import('./service-mesh-identity-fixture.ts');
const policy = { name: 'frontend', listenPort: 15001, upstreamPort: 8080 };
after(async () => {
  assert.equal(dirname(resolve(root)), resolve(parent));
  assert.match(basename(root), /^sakura-mesh-tests-/);
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `model, mesh, state, envoy, python, enabled, usable, launch`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `model, mesh, state, envoy, python, enabled, usable, launch`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `meshIdentityFixture`.
 */
async function fixture() {
  const model = await meshIdentityFixture();
  return { ...model, model, /**
   * 中文功能：读取夹具当前状态或暴露受控句柄，供断言观察。
   * English: Read current fixture state or expose a controlled handle for assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`model.mesh`）。
   * Result: Return the branch-computed value (`model.mesh`).
   */
  get mesh() { return model.mesh; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `model.state.guest`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    state: (value: string) => { model.state.guest = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `model.state.envoy`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    envoy: (value: boolean) => { model.state.envoy = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `model.state.python`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    python: (value: boolean) => { model.state.python = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `model.state.enabled`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    enabled: (value: boolean) => { model.state.enabled = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `model.state.usable`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    usable: (value: boolean) => { model.state.usable = value; },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: () => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `model.state.launchHook`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    launch: (value: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => void) => { model.state.launchHook = value; },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: mesh saves legacy-compatible policies and binds persistent sidecars to a private project
 * 协作入口 / Collaborators: `fixture`, `f.workspaces.save`, `assert.equal`, `f.mesh.action`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.mesh.action(f.id, { mode: 'save', policy }, 'check')).ready, true)`; `assert.equal((await f.mesh.status(f.id)).policy, null, 'preview must not persist')`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('mesh saves legacy-compatible policies and binds persistent sidecars to a private project', async () => {
  const f = await fixture();
  try {
    await f.workspaces.save(f.id, {
      directory: '/workspace/private',
      networkIsolation: 'private',
      environment: { SCOPE: 'private' },
    });
    assert.equal((await f.mesh.action(f.id, { mode: 'save', policy }, 'check')).ready, true);
    assert.equal((await f.mesh.status(f.id)).policy, null, 'preview must not persist');
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.envoy(false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /Envoy/);
    f.envoy(true);
    f.python(false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /Python/);
    f.python(true);
    const start = await f.mesh.action(f.id, { mode: 'start' }, 'run');
    assert.equal(start.sidecarRunning, true);
    assert.equal(start.bindingValid, true);
    assert.equal(start.networkIsolation, 'private');
    assert.equal(start.directory, '/workspace/private');
    const prepared = f.executions.find(execution => execution.command.includes('--mode'))!;
    assert.equal(prepared.project.networkIsolation, 'private');
    assert.equal(prepared.project.directory, '/workspace/private');
    assert.equal(prepared.environment?.SCOPE, 'private');
    assert.match(prepared.command, /--disable-hot-restart/);
    assert.match(prepared.command, /--concurrency/);
    assert.equal(f.frames[0].subarray(0, 8).toString(), 'SKIDP001');
    assert.equal(f.frames[0].readUInt32LE(12), 0);
    assert.match(f.frames[0].toString(), /SCOPE/);
    assert.equal(f.rootLaunches.length, 1);
    assert.ok(!f.rootLaunches[0].includes('SCOPE'));
    assert.ok(!f.rootLaunches[0].includes('/workspace/private'));
    const account = f.identities.get('default')!;
    assert.equal(account.gid, account.uid);
    assert.notEqual(account.home, '/root');
    assert.equal(f.held.get('default'), 0, 'completed persistent service releases its finite preparation');
    await assert.rejects(
      f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'private' }),
      /停止.*边车/,
    );
    await assert.rejects(
      f.workspaces.save(f.id, { directory: '/workspace/private', networkIsolation: 'host' }),
      /停止.*边车/,
    );
    await assert.rejects(f.mesh.action(f.id, { mode: 'save', policy }, 'run'), /先停止/);
    await assert.rejects(f.mesh.action(f.id, { mode: 'remove' }, 'run'), /先停止/);
    await assert.rejects(
      f.mesh.configure(f.id, false, async () => f.enabled(false)),
      /停止所有项目/,
    );
    const runId = start.runId;
    await f.restart();
    assert.equal((await f.mesh.status(f.id)).runId, runId);
    assert.equal(JSON.parse(await readFile(f.file, 'utf8')).version, 1);
    await f.mesh.action(f.id, { mode: 'stop' }, 'run');
    assert.equal((await f.mesh.status(f.id)).sidecarRunning, false);
    await f.workspaces.save(f.id, { directory: '/workspace/changed', networkIsolation: 'host' });
    await f.mesh.action(f.id, { mode: 'remove' }, 'run');
    assert.equal((await f.mesh.status(f.id)).policy, null);
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private projects reuse ports while shared policy saves and network edits cannot race reservations
 * 协作入口 / Collaborators: `fixture`, `f.mesh.action`, `f.workspaces.projects.create`, `f.workspaces.projects.with`.
 * 检查边界 / Checked boundaries: `assert.ok(f.running.has(beta))`; `assert.equal(f.running.has(alpha), false)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('private projects reuse ports while shared policy saves and network edits cannot race reservations', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    const alpha = (
      await f.workspaces.projects.create(f.id, 'Private A', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/a', networkIsolation: 'private' });
      })
    ).active;
    const beta = (
      await f.workspaces.projects.create(f.id, 'Private B', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/b', networkIsolation: 'private' });
      })
    ).active;
    for (const project of [alpha, beta])
      await f.workspaces.projects.with(f.id, project, async () => {
        await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
        await f.mesh.action(f.id, { mode: 'start' }, 'run');
      });
    await f.workspaces.projects.with(f.id, alpha, async () => {
      await f.mesh.action(f.id, { mode: 'stop' }, 'run');
      await assert.rejects(
        f.workspaces.save(f.id, { directory: '/workspace/a', networkIsolation: 'host' }),
        /共享网络项目/,
      );
    });
    assert.ok(f.running.has(beta));
    assert.equal(f.running.has(alpha), false);
    const host = (
      await f.workspaces.projects.create(f.id, 'Shared', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/shared' });
      })
    ).active;
    const saves = await Promise.allSettled(
      ['default', host].map((project) =>
        f.workspaces.projects.with(f.id, project, () =>
          f.mesh.action(f.id, { mode: 'save', policy: { ...policy, listenPort: 15002 } }, 'run'),
        ),
      ),
    );
    assert.equal(saves.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(saves.filter((item) => item.status === 'rejected').length, 1);
    const failure = saves.find((item) => item.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(failure.reason), /共享网络项目/);
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: mesh refuses stale process bindings, preserves other projects on cancellation and cleans orphans
 * 状态影响 / State effects: `f.running.get('default')!.valid`, `f.running.get('default')!.orphan`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.mesh.action`, `f.running.get`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.mesh.status(f.id)).ready, false)`; `assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /先停止/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('mesh refuses stale process bindings, preserves other projects on cancellation and cleans orphans', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    await f.mesh.action(f.id, { mode: 'start' }, 'run');
    f.running.get('default')!.valid = false;
    assert.equal((await f.mesh.status(f.id)).ready, false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /先停止/);
    await assert.rejects(f.workspaces.save(f.id, { directory: '/workspace/changed' }), /停止.*边车/);
    await f.mesh.action(f.id, { mode: 'stop' }, 'run');
    await f.mesh.action(f.id, { mode: 'start' }, 'run');
    const other = (
      await f.workspaces.projects.create(f.id, 'Other', async () => {
        await f.workspaces.save(f.id, { directory: '/workspace/other', networkIsolation: 'private' });
      })
    ).active;
    await f.workspaces.projects.with(f.id, other, async () => {
      await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
      const abort = new AbortController();
      f.launch(() => abort.abort());
      await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run', abort.signal));
      assert.equal(f.running.has(other), false);
      assert.ok(f.running.has('default'));
    });
    f.running.get('default')!.orphan = true;
    await f.workspaces.projects.with(f.id, 'default', async () => {
      assert.equal((await f.mesh.status(f.id)).bindingValid, false);
      await assert.rejects(f.mesh.action(f.id, { mode: 'remove' }, 'run'), /先停止/);
      await f.mesh.action(f.id, { mode: 'stop' }, 'run');
      assert.equal((await f.mesh.status(f.id)).sidecarRunning, false);
    });
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: paused guests and serialized disabled settings cannot allow unsafe edits or a late start
 * 协作入口 / Collaborators: `fixture`, `f.mesh.action`, `f.state`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal((await f.mesh.status(f.id)).sidecarStateKnown, false)`; `assert.rejects(f.mesh.action(f.id, { mode: 'save', policy }, 'run'), /恢复实例/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('paused guests and serialized disabled settings cannot allow unsafe edits or a late start', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.state('paused');
    assert.equal((await f.mesh.status(f.id)).sidecarStateKnown, false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'save', policy }, 'run'), /恢复实例/);
    await assert.rejects(f.mesh.action(f.id, { mode: 'remove' }, 'run'), /恢复实例/);
    await assert.rejects(
      f.mesh.configure(f.id, false, async () => f.enabled(false)),
      /恢复实例/,
    );
    f.state('running');
    const disable = f.mesh.configure(f.id, false, async () => f.enabled(false));
    const start = f.mesh.action(f.id, { mode: 'start' }, 'run');
    await disable;
    await assert.rejects(start, /已禁用/);
    assert.equal(f.running.size, 0);
    await f.mesh.configure(f.id, true, async () => f.enabled(true));
    await f.mesh.action(f.id, { mode: 'start' }, 'run');
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: an installed but unusable Envoy is reported unready and cannot leave a running sidecar
 * 协作入口 / Collaborators: `fixture`, `f.mesh.action`, `f.usable`, `f.mesh.status`.
 * 检查边界 / Checked boundaries: `assert.equal(unprobed.envoyUsable, null)`; `assert.equal(current.envoyInstalled, true)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('an installed but unusable Envoy is reported unready and cannot leave a running sidecar', async () => {
  const f = await fixture();
  try {
    await f.mesh.action(f.id, { mode: 'save', policy }, 'run');
    f.usable(false);
    const unprobed = await f.mesh.status(f.id);
    assert.equal(unprobed.envoyUsable, null);
    const current = await f.mesh.action(f.id, { mode: 'status' }, 'check');
    assert.equal(current.envoyInstalled, true);
    assert.equal(current.envoyUsable, false);
    assert.equal(current.ready, false);
    await assert.rejects(f.mesh.action(f.id, { mode: 'start' }, 'run'), /incompatible Envoy/);
    assert.equal(f.running.size, 0);
    assert.equal(
      f.model.state.starts > 0,
      false,
    );
  } finally {
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: public capability settings persist and the real enabled callback rejects stale sidecar starts
 * 协作入口 / Collaborators: `fixture`, `Object.assign`, `next.init`, `next.serviceMesh.action`.
 * 检查边界 / Checked boundaries: `assert.equal((await next.view(f.id)).settings['service-mesh'].enabled, false)`; `assert.rejects(next.serviceMesh.action(f.id, { mode: 'start' }, 'run'), /已禁用/)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('public capability settings persist and the real enabled callback rejects stale sidecar starts', async () => {
  const f = await fixture(),
    next = new NextFeatures(f.machines, f.workspaces);
  try {
    Object.assign(next.serviceMesh, { options: f.options, scopes: f.options.scopes, identities: f.options.identities, file: f.file });
    await next.init();
    await next.serviceMesh.action(f.id, { mode: 'save', policy }, 'run');
    await next.configure(f.id, { featureId: 'service-mesh', enabled: false, options: {} });
    assert.equal((await next.view(f.id)).settings['service-mesh'].enabled, false);
    await assert.rejects(next.serviceMesh.action(f.id, { mode: 'start' }, 'run'), /已禁用/);
    await next.configure(f.id, { featureId: 'service-mesh', enabled: true, options: {} });
    await next.serviceMesh.action(f.id, { mode: 'start' }, 'run');
    await assert.rejects(
      next.configure(f.id, { featureId: 'service-mesh', enabled: false, options: {} }),
      /停止所有项目/,
    );
    assert.equal((await next.view(f.id)).settings['service-mesh'].enabled, true);
    await next.serviceMesh.action(f.id, { mode: 'stop' }, 'run');
    await next.configure(f.id, { featureId: 'service-mesh', enabled: false, options: {} });
    assert.equal((await next.view(f.id)).settings['service-mesh'].enabled, false);
  } finally {
    await next.close();
    await f.close();
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sidecar schema accepts only fixed loopback TCP policies
 * 协作入口 / Collaborators: `assert.equal`, `serviceMeshInput.safeParse`, `envoySidecarConfig`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal( serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, upstreamPort: 15001 } }).success, false, )`; `assert.equal( serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, name: 'api;rm' } }).success, false, )`.
 */
test('sidecar schema accepts only fixed loopback TCP policies', () => {
  assert.equal(
    serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, upstreamPort: 15001 } }).success,
    false,
  );
  assert.equal(
    serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, name: 'api;rm' } }).success,
    false,
  );
  assert.equal(
    serviceMeshInput.safeParse({ mode: 'save', policy: { ...policy, bootstrap: {} } }).success,
    false,
  );
  const config = envoySidecarConfig(policy);
  assert.ok(!JSON.stringify(config).includes('0.0.0.0'));
  assert.ok(!('admin' in config));
});
