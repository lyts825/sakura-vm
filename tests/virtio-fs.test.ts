/**
 * 模块职责：回归验证模块，围绕 `virtio-fs` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `virtio-fs`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Virtio-FS check distinguishes actual guest mounts from available host prerequisites; Virtio-FS launch arguments bind shared memory and the daemon socket to one guest tag.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectVirtioFs, virtioFsArguments, VIRTIOFS_GUEST_PATH,
  VIRTIOFS_TAG } from '../server/virtio-fs.ts';
import type { Machines } from '../server/machines.ts';

const vmId = '6635836f-891f-49d1-98bf-833ad751f2fa';
const paths = { qemu: 'qemu', virtiofsd: 'virtiofsd' };
/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: running: boolean; output = ''。
 * 结果：返回分支计算值（`({ get: () => ({ architecture: 'x86_64' }), state: () => running ? 'running' : '…`）。
 * Result: Return the branch-computed value (`({ get: () => ({ architecture: 'x86_64' }), state: () => running ? 'running' : '…`).
 */
const machines = (running: boolean, output = '') => ({
  /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ architecture: 'x86_64' })`）。
   * Result: Return the branch-computed value (`({ architecture: 'x86_64' })`).
   */
  get: () => ({ architecture: 'x86_64' }),
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`running ? 'running' : 'stopped'`）。
   * Result: Return the branch-computed value (`running ? 'running' : 'stopped'`).
   */
  state: () => running ? 'running' : 'stopped',
  /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ code: 0, stdout: output, stderr: '' })`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ code: 0, stdout: output, stderr: '' })`) through a Promise.
   */
  exec: async () => ({ code: 0, stdout: output, stderr: '' }),
}) as unknown as Machines;

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Virtio-FS check distinguishes actual guest mounts from available host prerequisites
 * 协作入口 / Collaborators: `inspectVirtioFs`, `machines`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(result.host.qemuVirtioFs, true)`; `assert.equal(result.host.qemuNineP, true)`.
 */
test('Virtio-FS check distinguishes actual guest mounts from available host prerequisites', async () => {
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _file: string; args: string[]。
   * 结果：返回分支计算值（`({ ok: true, output: args[0] === '-device' ? 'vhost-user-fs-pci\nvirtio-9p-pci' …`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ok: true, output: args[0] === '-device' ? 'vhost-user-fs-pci\nvirtio-9p-pci' …`) through a Promise.
   * 验证场景 / Scenario: Virtio-FS check distinguishes actual guest mounts from available host prerequisites
   */
  const probe = async (_file: string, args: string[]) => ({ ok: true,
    output: args[0] === '-device' ? 'vhost-user-fs-pci\nvirtio-9p-pci' :
      args[0] === '-object' ? 'memory-backend-memfd' : 'virtiofsd 1.0' });
  const result = await inspectVirtioFs(machines(true,
    'VIRTIOFS=yes\n9P=yes\nMOUNT=/mnt/shared|virtiofs|host\n'), vmId,
    undefined, paths, probe);
  assert.equal(result.host.qemuVirtioFs, true);
  assert.equal(result.host.qemuNineP, true);
  assert.equal(result.host.sharedMemory, true);
  assert.deepEqual(result.guest?.mounts, [{ path: '/mnt/shared', type: 'virtiofs', tag: 'host' }]);
  assert.equal(result.ready, false);
  assert.equal(result.executed, false);
  assert.ok(result.blockers.some((item) => item.includes('尚未确认 Sakura')));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Virtio-FS launch arguments bind shared memory and the daemon socket to one guest tag
 * 协作入口 / Collaborators: `virtioFsArguments`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.deepEqual(args, [ '-object', 'memory-backend-memfd,id=sakura-vfs-mem,size=768M,share=on', '-numa', 'node,memdev=sakura-vfs-…`.
 */
test('Virtio-FS launch arguments bind shared memory and the daemon socket to one guest tag', () => {
  const args = virtioFsArguments({ memoryMiB: 768 }, '/tmp/sakura-vfs-a,b/fs.sock');
  assert.deepEqual(args, [
    '-object', 'memory-backend-memfd,id=sakura-vfs-mem,size=768M,share=on',
    '-numa', 'node,memdev=sakura-vfs-mem',
    '-chardev', 'socket,id=sakura-vfs,path=/tmp/sakura-vfs-a,,b/fs.sock',
    '-device', `vhost-user-fs-pci,chardev=sakura-vfs,tag=${VIRTIOFS_TAG},queue-size=1024`,
  ]);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Virtio-FS check recognizes the managed guest mount instead of unrelated mounts
 * 协作入口 / Collaborators: `inspectVirtioFs`, `machines`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(result.guest?.mounts.length, 1)`; `assert.ok(!result.blockers.some((item) => item.includes('尚未确认 Sakura')))`.
 */
test('Virtio-FS check recognizes the managed guest mount instead of unrelated mounts', async () => {
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: _file: string; args: string[]。
   * 结果：返回分支计算值（`({ ok: true, output: args[0] === '-device' ? 'vhost-user-fs-pci' : args[0] === '…`），以 Promise 交付。
   * Result: Return the branch-computed value (`({ ok: true, output: args[0] === '-device' ? 'vhost-user-fs-pci' : args[0] === '…`) through a Promise.
   * 验证场景 / Scenario: Virtio-FS check recognizes the managed guest mount instead of unrelated mounts
   */
  const probe = async (_file: string, args: string[]) => ({ ok: true,
    output: args[0] === '-device' ? 'vhost-user-fs-pci' :
      args[0] === '-object' ? 'memory-backend-memfd' : 'virtiofsd 1.0' });
  const result = await inspectVirtioFs(machines(true,
    `VIRTIOFS=yes\n9P=no\nMOUNT=${VIRTIOFS_GUEST_PATH}|virtiofs|${VIRTIOFS_TAG}\n`),
  vmId, undefined, paths, probe);
  assert.equal(result.guest?.mounts.length, 1);
  assert.ok(!result.blockers.some((item) => item.includes('尚未确认 Sakura')));
  assert.equal(result.ready, process.platform === 'linux');
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Virtio-FS check reports unavailable QEMU and stopped guest without claiming a mount
 * 协作入口 / Collaborators: `inspectVirtioFs`, `machines`, `assert.equal`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(result.guest, null)`; `assert.equal(result.host.qemuVirtioFs, false)`.
 */
test('Virtio-FS check reports unavailable QEMU and stopped guest without claiming a mount', async () => {
  const result = await inspectVirtioFs(machines(false), vmId, undefined, paths,
    async () => ({ ok: false, output: 'unsupported' }));
  assert.equal(result.guest, null);
  assert.equal(result.host.qemuVirtioFs, false);
  assert.ok(result.blockers.some((item) => item.includes('QEMU 构建')));
  assert.ok(result.blockers.some((item) => item.includes('客户机未运行')));
});
