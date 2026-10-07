/**
 * 模块职责：回归验证模块，围绕 `virtio-fs-linux` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `virtio-fs-linux`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, writeFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { vmBootProviders } from '../server/vm-lifetime.ts';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle
 * 状态影响 / State effects: `process.env.SAKURA_DATA_DIR`, `process.env.SAKURA_QEMU_DIR`, `process.env.SAKURA_VIRTIOFSD_PATH`, `running`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.ok(attachment)`; `assert.ok((await lstat(socket)).isSocket())`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle',
  { skip: process.platform !== 'linux' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'sakura-vfs-test-'));
    const qemuDir = join(root, 'qemu');
    const share = join(root, 'share');
    await mkdir(qemuDir);
    await mkdir(share);
    const qemu = join(qemuDir, 'qemu-system-x86_64');
    const daemon = join(root, 'virtiofsd');
    await writeFile(qemu, `#!/usr/bin/env node
console.log(process.argv.includes('-device') ? 'vhost-user-fs-pci' : 'memory-backend-memfd');
`);
    await writeFile(daemon, `#!/usr/bin/env node
const { createServer } = require('node:net');
const { writeFileSync } = require('node:fs');
if (process.argv.includes('--version')) { console.log('virtiofsd test'); process.exit(0); }
const socket = process.argv[process.argv.indexOf('--socket-path') + 1];
writeFileSync(socket + '.args', JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }));
const server = createServer(() => {});
server.listen(socket);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
`);
    await Promise.all([chmod(qemu, 0o755), chmod(daemon, 0o755)]);
    process.env.SAKURA_DATA_DIR = join(root, 'data');
    process.env.SAKURA_QEMU_DIR = qemuDir;
    process.env.SAKURA_VIRTIOFSD_PATH = daemon;
    const { VirtioFsShares } = await import('../server/virtio-fs.ts');
    const id = 'c3915729-d526-4c60-9224-df29862864f3';
    const vm = { id, memoryMiB: 512, architecture: 'x86_64' };
    const boot = {};
    let running = false, mounted = false;
    const commands: string[] = [];
    const machines = {
      records: new Map([[id, vm]]), live: new Map<string, object>(),
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`vm`）。
       * Result: Return the branch-computed value (`vm`).
       * 验证场景 / Scenario: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle
       */
      get: () => vm,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; work: () => Promise<unknown>。
       * 结果：返回分支计算值（`work()`），以 Promise 交付。
       * Result: Return the branch-computed value (`work()`) through a Promise.
       * 验证场景 / Scenario: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle
       * 协作入口 / Collaborators: `work`.
       */
      locked: async (_id: string, work: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => Promise<unknown>) => work(),
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`running ? 'running' : 'stopped'`）。
       * Result: Return the branch-computed value (`running ? 'running' : 'stopped'`).
       * 验证场景 / Scenario: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle
       */
      state: () => running ? 'running' : 'stopped',
      /**
       * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
       * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle
       */
      requireUnlocked: () => {},
      /**
       * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
       * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 验证场景 / Scenario: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle
       * 失败 / Failure: `Error('running')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `Error`.
       */
      requireStopped: () => { if (running) throw Error('running'); },
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: _id: string; command: string。
       * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
       * 验证场景 / Scenario: Linux Virtio-FS manages the daemon socket, QEMU device and guest mount lifecycle
       * 状态影响 / State effects: `mounted`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `commands.push`, `command.startsWith`.
       */
      exec: async (_id: string, command: string) => {
        commands.push(command);
        if (command.startsWith('awk '))
          return { code: 0, stdout: mounted ? 'sakura-host|virtiofs\n' : '', stderr: '' };
        if (command.startsWith('mount -t virtiofs')) mounted = true;
        if (command.startsWith('umount ')) mounted = false;
        return { code: 0, stdout: '', stderr: '' };
      },
    } as unknown as Machines;
    const service = new VirtioFsShares(machines);
    try {
      await service.init();
      await service.action(id, { operation: 'configure',
        policy: { enabled: true, hostPath: share, readOnly: true } });
      running = true;
      machines.live.set(id, boot as never);
      const exits: string[] = [];
      const attachment = await vmBootProviders(machines).find(([name]) => name === 'virtio-fs')![1].prepare(vm as never,
        (error) => exits.push(error));
      assert.ok(attachment);
      const socketArgument = attachment.args[attachment.args.indexOf('-chardev') + 1];
      const socket = socketArgument.slice(socketArgument.indexOf('path=') + 5);
      assert.ok((await lstat(socket)).isSocket());
      assert.ok(attachment.args.includes('node,memdev=sakura-vfs-mem'));
      const sidecar = JSON.parse(await readFile(socket + '.args', 'utf8')) as
        { pid: number; args: string[] };
      const daemonArgs = sidecar.args;
      assert.ok(daemonArgs.includes('--readonly'));
      assert.equal(daemonArgs[daemonArgs.indexOf('--shared-dir') + 1], share);
      await service.action(id, { operation: 'mount' });
      assert.equal((await service.view(id)).mounted, true);
      assert.ok(commands.some((command) => command.includes('mount -t virtiofs -o ro')));
      await service.action(id, { operation: 'unmount' });
      assert.equal((await service.view(id)).policy.enabled, false);
      assert.equal(mounted, false);
      process.kill(sidecar.pid, 'SIGTERM');
      for (let attempt = 0; attempt < 50 && !exits.length; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(exits.length, 1);
      await attachment.close();
      await assert.rejects(lstat(socket), { code: 'ENOENT' });
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  });
