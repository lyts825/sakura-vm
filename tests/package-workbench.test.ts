/**
 * 模块职责：回归验证模块，围绕 `package-workbench` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `package-workbench`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: apk and apt listings retain package names, versions and upgrade pairs; package changes require an unchanged one-time preview on the same VM boot.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackageWorkbench, parsePackageRows } from '../server/package-workbench.ts';
import type { Machines } from '../server/machines.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: apk and apt listings retain package names, versions and upgrade pairs
 * 协作入口 / Collaborators: `assert.deepEqual`, `parsePackageRows`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(parsePackageRows('apk', 'installed', 'alpine-baselayout-data-3.7.2-r0 x86_64 {alpine-baselayout} (GPL) [installed…`; `assert.deepEqual(parsePackageRows('apk', 'updates', 'Installed: Available:\nalpine-base-3.23.4-r0 < 3.23.6-r0\n'), [{ name: 'alpin…`.
 */
test('apk and apt listings retain package names, versions and upgrade pairs', () => {
  assert.deepEqual(parsePackageRows('apk', 'installed',
    'alpine-baselayout-data-3.7.2-r0 x86_64 {alpine-baselayout} (GPL) [installed]\n'),
  [{ name: 'alpine-baselayout-data', version: '3.7.2-r0', installedVersion: '3.7.2-r0' }]);
  assert.deepEqual(parsePackageRows('apk', 'updates',
    'Installed: Available:\nalpine-base-3.23.4-r0 < 3.23.6-r0\n'),
  [{ name: 'alpine-base', version: '3.23.6-r0',
    installedVersion: '3.23.4-r0', availableVersion: '3.23.6-r0' }]);
  assert.deepEqual(parsePackageRows('apt', 'installed',
    'ii \tlibssl3\t3.0.0\nrc \toldpkg\t1.0\n'),
  [{ name: 'libssl3', version: '3.0.0', installedVersion: '3.0.0' }]);
  assert.deepEqual(parsePackageRows('apt', 'updates',
    'Listing...\nlibssl3/stable 3.0.1 amd64 [upgradable from: 3.0.0]\n'),
  [{ name: 'libssl3', version: '3.0.1',
    installedVersion: '3.0.0', availableVersion: '3.0.1' }]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: package changes require an unchanged one-time preview on the same VM boot
 * 状态影响 / State effects: `plan`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `assert.rejects`, `workbench.action`, `assert.deepEqual`, `machines.live.set`.
 * 检查边界 / Checked boundaries: `assert.rejects(workbench.action(vmId, { operation: 'preview', change: 'install', name: 'jq-' }))`; `assert.rejects(workbench.action(vmId, { operation: 'apply', token: preview.token }), /计划已变化/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('package changes require an unchanged one-time preview on the same VM boot', async () => {
  const boot = {};
  const vmId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  let plan = '(1/1) Installing jq (1.8.2-r0)';
  const applied: string[] = [];
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ distro: 'alpine' })`).
     * 验证场景 / Scenario: package changes require an unchanged one-time preview on the same VM boot
     */
    get: () => ({ distro: 'alpine' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: package changes require an unchanged one-time preview on the same VM boot
     */
    state: () => 'running',
    live: new Map([[vmId, boot]]),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: package changes require an unchanged one-time preview on the same VM boot
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 验证场景 / Scenario: package changes require an unchanged one-time preview on the same VM boot
     * 协作入口 / Collaborators: `assert.match`.
     * 检查边界 / Checked boundaries: `assert.match(command, /^apk add --simulate/)`.
     */
    exec: async (_id: string, command: string) => {
      assert.match(command, /^apk add --simulate/);
      return { code: 0, stdout: plan, stderr: '' };
    },
  } as unknown as Machines;
  const workbench = new PackageWorkbench(machines, (_id, operation, name) => {
    applied.push(`${operation}:${name}`);
    return { status: 'running' };
  });
  await assert.rejects(workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq-' }));
  const preview = await workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq' }) as { token: string };
  plan = '(1/1) Installing jq (1.8.3-r0)';
  await assert.rejects(workbench.action(vmId,
    { operation: 'apply', token: preview.token }), /计划已变化/);
  const next = await workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq' }) as { token: string };
  await workbench.action(vmId, { operation: 'apply', token: next.token });
  assert.deepEqual(applied, ['install:jq']);
  await assert.rejects(workbench.action(vmId,
    { operation: 'apply', token: next.token }), /预览已过期/);
  const stale = await workbench.action(vmId,
    { operation: 'preview', change: 'install', name: 'jq' }) as { token: string };
  machines.live.set(vmId, {} as any);
  await assert.rejects(workbench.action(vmId,
    { operation: 'apply', token: stale.token }), /预览已过期/);
});
