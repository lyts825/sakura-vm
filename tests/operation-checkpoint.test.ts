/**
 * 模块职责：回归验证模块，围绕 `operation-checkpoint` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `operation-checkpoint`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: full committed permission checkpoints never reacquire a held metadata writer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Principal } from '../server/access-control.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: full committed permission checkpoints never reacquire a held metadata writer
 * 状态影响 / State effects: `process.env.SAKURA_DATA_DIR`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `import`.
 * 检查边界 / Checked boundaries: `assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'read'), /重叠/)`; `assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'read'), { status: 403 })`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('full committed permission checkpoints never reacquire a held metadata writer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-operation-checkpoint-'));
  process.env.SAKURA_DATA_DIR = directory;
  const { ProjectPermissions } = await import('../server/project-permissions.ts');
  const { Workspaces } = await import('../server/workspaces.ts');
  const { projectSchema } = await import('../server/project-config.ts');
  const { writeStore } = await import('../server/local-store.ts');
  const { serializedMetadata } = await import('../server/metadata-queue.ts');
  const { vmDir } = await import('../server/paths.ts');
  const vmId = 'd2f574eb-44c5-40b8-a2ac-581b56cb4a12', other = '1234567890abcdef';
  const principal: Principal = { id: '5b880585-3986-4ed7-a6da-f5e54e2d615d', username: 'member',
    role: 'member', vmIds: [], expiresAt: Date.now() + 60_000 };
  const machines = Object.assign(new EventEmitter(), { records: new Map([[vmId, { name: 'test' }]]),
    live: new Map(), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ name: 'test', template: 'none' })`）。
     * Result: Return the branch-computed value (`({ name: 'test', template: 'none' })`).
     * 验证场景 / Scenario: full committed permission checkpoints never reacquire a held metadata writer
     */
    get: () => ({ name: 'test', template: 'none' }), /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'stopped'`）。
     * Result: Return the branch-computed value (`'stopped'`).
     * 验证场景 / Scenario: full committed permission checkpoints never reacquire a held metadata writer
     */
    state: () => 'stopped' }) as unknown as Machines;
  const workspaces = new Workspaces(machines);
  const file = join(directory, 'permissions.json');
  const permissions = new ProjectPermissions({ /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   * 验证场景 / Scenario: full committed permission checkpoints never reacquire a held metadata writer
   */
  users: () => [principal] } as any, machines, workspaces, file);
  try {
    await mkdir(vmDir(vmId), { recursive: true });
    await writeStore(join(vmDir(vmId), 'projects.json'), { active: 'default', projects: [
      { id: 'default', name: 'Default' }, { id: other, name: 'Other' },
    ] });
    await writeStore(join(vmDir(vmId), 'project.json'), projectSchema.parse({ directory: '/work/default' }));
    await writeStore(join(vmDir(vmId), `project-${other}.json`), projectSchema.parse({ directory: '/work/other' }));
    await permissions.init();
    await permissions.configure(vmId, 'default', { roles: [{ id: 'reader', name: 'Read', permissions: ['read'] }],
      grants: [{ accountId: principal.id, roleId: 'reader' }] });
    await permissions.require(principal, vmId, 'default', 'read');
    const checkpoint = serializedMetadata(join(vmDir(vmId), 'projects.json'), true, () =>
      serializedMetadata(join(vmDir(vmId), 'project.json'), true, async () => {
        await permissions.requireCommitted(principal, vmId, 'default', 'read');
        await assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'write'), { status: 403 });
      }));
    await checkpoint;
    // Read committed config still checks every project's directory isolation, not just cached role bits.
    await writeStore(join(vmDir(vmId), `project-${other}.json`), projectSchema.parse({ directory: '/work/default/nested' }));
    await assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'read'), /重叠/);
    await writeStore(join(vmDir(vmId), `project-${other}.json`), projectSchema.parse({ directory: '/work/other' }));
    await permissions.configure(vmId, 'default', { roles: [{ id: 'reader', name: 'Read', permissions: ['read'] }], grants: [] });
    await assert.rejects(permissions.requireCommitted(principal, vmId, 'default', 'read'), { status: 403 });
  } finally {
    await permissions.close(); await workspaces.close();
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('sakura-operation-checkpoint-'));
    await rm(directory, { recursive: true, force: true });
  }
});
