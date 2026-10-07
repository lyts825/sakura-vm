/**
 * 模块职责：回归验证模块，围绕 `project-private-shell` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-private-shell`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: private project shell selects the validated project namespace and rejects shared networking; managed project commands check namespace routes before entering private networking.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSchema } from '../server/workspaces.ts';
import { projectNetworkCommand, projectPrivateShellCommand } from '../server/project-network-isolation.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: private project shell selects the validated project namespace and rejects shared networking
 * 协作入口 / Collaborators: `projectSchema.parse`, `projectPrivateShellCommand`, `assert.match`, `Object.assign`.
 * 检查边界 / Checked boundaries: `assert.match(command, /ip netns exec sk-default true/)`; `assert.match(command, /sakura_ipv4=\$\(ip -n sk-default -o -4 route show\)/)`.
 */
test('private project shell selects the validated project namespace and rejects shared networking', () => {
  const project = projectSchema.parse({ directory: '/workspace/team work',
    networkIsolation: 'private' });
  const command = projectPrivateShellCommand(project);
  assert.match(command, /ip netns exec sk-default true/);
  assert.match(command, /sakura_ipv4=\$\(ip -n sk-default -o -4 route show\)/);
  assert.match(command, /if \[ -n "\$sakura_ipv4" \] \|\| \[ -n "\$sakura_ipv6" \]; then/);
  assert.match(command, /cd '\/workspace\/team work'/);
  assert.match(command, /exec ip netns exec sk-default sh -l$/);
  const second = Object.assign({}, project, { _workspace: '0123456789abcdef' });
  assert.match(projectPrivateShellCommand(second), /exec ip netns exec sk-0123456789abcdef sh -l$/);
  assert.throws(() => projectPrivateShellCommand({ ...project, networkIsolation: 'host' }),
    /未启用私有网络/);
  assert.throws(() => projectPrivateShellCommand({ ...project, _workspace: 'malformed' }),
    /项目 ID 无效/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: managed project commands check namespace routes before entering private networking
 * 协作入口 / Collaborators: `projectSchema.parse`, `projectNetworkCommand`, `assert.match`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.match(command, /ip netns exec sk-default true/)`; `assert.match(command, /sakura_ipv4=.*ip -n sk-default -o -4 route show/)`.
 */
test('managed project commands check namespace routes before entering private networking', () => {
  const project = projectSchema.parse({ directory: '/workspace/team', networkIsolation: 'private' });
  const command = projectNetworkCommand(project, 'touch /workspace/marker');
  assert.match(command, /ip netns exec sk-default true/);
  assert.match(command, /sakura_ipv4=.*ip -n sk-default -o -4 route show/);
  assert.match(command, /项目命名空间已有网络路由，拒绝执行/);
  assert.match(command, /ip netns exec sk-default sh -lc/);
  assert.equal(projectNetworkCommand({ ...project, networkIsolation: 'host' }, 'true'), "sh -lc 'true'");
});
