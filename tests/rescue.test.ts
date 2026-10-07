/**
 * 模块职责：回归验证模块，围绕 `rescue` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `rescue`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: rescue inputs restrict disk selection, deadlines and guest artifact paths; rescue locks the source until QEMU exit and attaches only a verified read-only disk after boot.
 */
import { fakeVmNetwork } from './support/fake-vm-network.ts';
import assert from 'node:assert/strict';
import test, { after, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Engine } from '../server/runtime.ts';
import type { SandboxArtifacts } from '../server/sandbox-artifacts.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-rescue-test-'));
process.env.SAKURA_DATA_DIR = root;
process.env.SAKURA_IMAGE_PATH = join(root, 'alpine.qcow2');
await writeFile(process.env.SAKURA_IMAGE_PATH, 'image');
const { Machines } = await import('../server/machines.ts');
const { Rescue, rescueSetup } = await import('../server/rescue.ts');
const { rescueRunSchema } = await import('../shared/rescue.ts');
const { Jobs } = await import('../server/jobs.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-rescue-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: TestContext。
 * 结果：返回受控对象，公开字段包括 `machines, source, launches, messages, service, jobs, directory, readonly`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `machines, source, launches, messages, service, jobs, directory, readonly`; the actual branch determines its shape.
 * 状态影响 / State effects: `machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdir`, `join`, `machines.create`, `randomUUID().slice`.
 */
async function fixture(t: TestContext) {
  const launches: string[][] = [],
    messages: { execute: string; arguments: any }[] = [];
  let readOnly = true;
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
     * 协作入口 / Collaborators: `writeFile`, `args.at`, `launches.push`, `Number`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    run: async (tool, args, options = {}) => {
      if (tool === 'sakura-img' && args[0] === 'create') await writeFile(args.at(-2)!, 'disk');
      if (tool === 'sakura-qemu') {
        launches.push(args);
        const port = Number(/tcp:127\.0\.0\.1:(\d+)/.exec(args[args.indexOf('-qmp') + 1])![1]);
        const sockets = new Set<Socket>();
        const server = createServer(/**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: socket。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `sockets.add`, `socket.on`, `socket.write`.
         */
        (socket) => {
          sockets.add(socket);
          socket.on('error', () => {});
          socket.on('close', () => sockets.delete(socket));
          socket.write('{"QMP":{"version":{}}}\n');
          let buffer = '';
          socket.on('data', /**
           * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
           * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
           * 输入 / Inputs: chunk。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 状态影响 / State effects: `buffer`, `at`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
           * 协作入口 / Collaborators: `chunk.toString`, `buffer.indexOf`, `JSON.parse`, `buffer.slice`.
           */
          (chunk) => {
            buffer += chunk.toString();
            let at: number;
            while ((at = buffer.indexOf('\n')) >= 0) {
              const message = JSON.parse(buffer.slice(0, at));
              buffer = buffer.slice(at + 1);
              messages.push(message);
              socket.write(
                JSON.stringify({
                  id: message.id,
                  return:
                    message.execute === 'query-named-block-nodes'
                      ? [{ 'node-name': 'sakura-rescue-source', ro: readOnly }]
                      : {},
                }) + '\n',
              );
            }
          });
        });
        server.listen(port, '127.0.0.1');
        await once(server, 'listening');
        await new Promise<void>((done) => {
          if (options.signal?.aborted) done();
          else options.signal?.addEventListener('abort', () => done(), { once: true });
        });
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((done) => server.close(() => done()));
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
  const source = await machines.create({ name: 'source-' + randomUUID().slice(0, 8) });
  const directory = join(root, randomUUID());
  const jobs = new Jobs('rescue', directory);
  const saved: any[] = [];
  const artifacts = {
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    prune: async () => {},
    /**
     * 中文功能：生成或核对本组验证所需的摘要与身份材料。
     * English: Generate or verify digest and identity material required by this suite.
     * 输入 / Inputs: _vm: string; _run: string; _cwd: string; paths: string[]; save: (value: any) => void。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `randomUUID`, `'a'.repeat`, `saved.push`, `save`.
     */
    collect: async (_vm: string, _run: string, _cwd: string, paths: string[], save: /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: any。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (value: any) => void) => {
      for (const path of paths) {
        const entry = { id: randomUUID(), name: path, path, bytes: 4, sha256: 'a'.repeat(64) };
        saved.push(entry);
        save(entry);
      }
    },
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: job: any; id: string。
     * 结果：返回受控对象，公开字段包括 `base64`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `base64`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `assert.ok`, `job.execution.artifacts.some`, `saved.find`.
     * 检查边界 / Checked boundaries: `assert.ok(job.execution.artifacts.some((item: any) => item.id === id))`.
     */
    download: async (job: any, id: string) => {
      assert.ok(job.execution.artifacts.some((item: any) => item.id === id));
      return { ...saved.find((item) => item.id === id), base64: 'dGVzdA==' };
    },
  } as unknown as SandboxArtifacts;
  const service = new Rescue(machines, jobs, artifacts);
  t.after(async () => {
    await service.close();
    await machines.close();
  });
  return {
    machines,
    source,
    launches,
    messages,
    service,
    jobs,
    directory,
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: boolean。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `readOnly`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    readonly: (value: boolean) => {
      readOnly = value;
    },
  };
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rescue inputs restrict disk selection, deadlines and guest artifact paths
 * 协作入口 / Collaborators: `assert.equal`, `rescueRunSchema.parse`, `rescueRunSchema.safeParse`, `assert.ok`.
 * 检查边界 / Checked boundaries: `assert.equal(rescueRunSchema.parse({ command: 'blkid' }).partition, 0)`; `assert.equal(rescueRunSchema.parse({ command: 'blkid', partition: null }).partition, null)`.
 */
test('rescue inputs restrict disk selection, deadlines and guest artifact paths', () => {
  assert.equal(rescueRunSchema.parse({ command: 'blkid' }).partition, 0);
  assert.equal(rescueRunSchema.parse({ command: 'blkid', partition: null }).partition, null);
  for (const value of [
    { command: ' ' },
    { command: 'a\0b' },
    { partition: -1 },
    { partition: 129 },
    { partition: 'host-path' },
    { timeoutSeconds: 1801 },
    { artifacts: ['../secret'] },
    { artifacts: ['/absolute'] },
    { artifacts: ['a', 'a'] },
    { network: 'nat' },
  ])
    assert.equal(rescueRunSchema.safeParse({ command: 'blkid', ...value }).success, false);
  assert.ok(rescueSetup(1).includes('target="$device"1'));
  assert.ok(rescueSetup(0).includes('ro,noload'));
  assert.ok(!rescueSetup(null).includes('mount -t'));
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rescue locks the source until QEMU exit and attaches only a verified read-only disk after boot
 * 协作入口 / Collaborators: `fixture`, `f.machines.withRescue`, `assert.equal`, `f.machines.isBusy`.
 * 检查边界 / Checked boundaries: `assert.equal(result, 'inspected')`; `assert.equal(f.machines.live.size, 0)`.
 */
test('rescue locks the source until QEMU exit and attaches only a verified read-only disk after boot', async (t) => {
  const f = await fixture(t);
  const result = await f.machines.withRescue(
    f.source.id,
    new AbortController().signal,
    () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: id。
     * 结果：返回分支计算值（`'inspected'`），以 Promise 交付。
     * Result: Return the branch-computed value (`'inspected'`) through a Promise.
     * 验证场景 / Scenario: rescue locks the source until QEMU exit and attaches only a verified read-only disk after boot
     * 协作入口 / Collaborators: `assert.equal`, `f.machines.state`, `f.machines.isBusy`, `assert.rejects`.
     * 检查边界 / Checked boundaries: `assert.equal(f.machines.state(id), 'running')`; `assert.equal(f.machines.isBusy(f.source.id), true)`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    async (id) => {
      assert.equal(f.machines.state(id), 'running');
      assert.equal(f.machines.isBusy(f.source.id), true);
      await assert.rejects(f.machines.start(f.source.id), /另一项/);
      await assert.rejects(f.machines.delete(f.source.id), /另一项/);
      await assert.rejects(f.machines.snapshot(f.source.id, 'blocked'), /另一项/);
      await assert.rejects(f.machines.start(id), /只能由救援任务/);
      const rescue = f.machines.get(id);
      assert.equal(rescue.rescueOf, f.source.id);
      assert.equal(rescue.sandbox?.network, 'isolated');
      assert.equal(rescue.sandbox?.storage, 'discard-on-stop');
      assert.ok(!f.launches[0].some((arg) => arg.includes(vmDir(f.source.id))));
      const addition = f.messages.find((message) => message.execute === 'blockdev-add')!;
      assert.equal(addition.arguments['read-only'], true);
      assert.equal(addition.arguments.file['read-only'], true);
      assert.equal(addition.arguments.file.filename, join(vmDir(f.source.id), 'disk.qcow2'));
      return 'inspected';
    },
  );
  assert.equal(result, 'inspected');
  assert.equal(f.machines.live.size, 0);
  assert.equal(f.machines.records.size, 1);
  assert.equal(f.machines.isBusy(f.source.id), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unconfirmed read-only status refuses commands and still destroys the temporary guest
 * 协作入口 / Collaborators: `fixture`, `f.readonly`, `assert.rejects`, `f.machines.withRescue`.
 * 检查边界 / Checked boundaries: `assert.rejects( f.machines.withRescue( f.source.id, new AbortController().signal, () => {}, async () => assert.fail('must not exec…`; `assert.equal(f.machines.records.size, 1)`.
 */
test('unconfirmed read-only status refuses commands and still destroys the temporary guest', async (t) => {
  const f = await fixture(t);
  f.readonly(false);
  await assert.rejects(
    f.machines.withRescue(
      f.source.id,
      new AbortController().signal,
      () => {},
      async () => assert.fail('must not execute'),
    ),
    /未确认只读/,
  );
  assert.equal(f.machines.records.size, 1);
  assert.equal(f.machines.live.size, 0);
  assert.equal(f.machines.isBusy(f.source.id), false);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: rescue jobs retain failure output and explicit artifacts across restart, and isolate downloads by source
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.jobs.wait`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'error')`; `assert.match(job.log, /diagnostic output/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('rescue jobs retain failure output and explicit artifacts across restart, and isolate downloads by source', async (t) => {
  const f = await fixture(t);
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command; _timeout; _signal; log。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: rescue jobs retain failure output and explicit artifacts across restart, and isolate downloads by source
   * 协作入口 / Collaborators: `command.startsWith`, `log`.
   */
  async (_id, command, _timeout, _signal, log) => {
    if (command.startsWith('cd /workspace')) {
      log?.('diagnostic output\n');
      return { code: 7, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const job = f.service.run(f.source.id, { command: 'inspect', artifacts: ['report.txt'] });
  await f.jobs.wait(f.source.id);
  assert.equal(job.status, 'error');
  assert.match(job.log, /diagnostic output/);
  assert.equal(job.execution?.exitCode, 7);
  assert.equal(job.execution?.artifacts.length, 1);
  await f.jobs.flush();
  const restoredJobs = new Jobs('rescue', f.directory);
  t.after(() => restoredJobs.close());
  assert.equal(restoredJobs.get(job.id!)?.execution?.artifacts[0].path, 'report.txt');
  assert.equal(
    (await f.service.artifact(f.source.id, job.id!, job.execution!.artifacts[0].id)).base64,
    'dGVzdA==',
  );
  const other = await f.machines.create({ name: 'other-' + randomUUID().slice(0, 8) });
  await assert.rejects(f.service.artifact(other.id, job.id!, job.execution!.artifacts[0].id), /不存在/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancellation, timeout and source lockdown stop the entire guest and release the source lock
 * 状态影响 / State effects: `f.machines.exec`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.run`, `f.jobs.cancel`, `f.machines.setIncidentLockdown`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, mode === 'cancel' ? 'cancelled' : 'error')`; `assert.equal(job.execution?.outcome, 'timeout')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancellation, timeout and source lockdown stop the entire guest and release the source lock', async (t) => {
  const f = await fixture(t);
  let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  f.machines.exec = /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id; command; _timeout; signal。
   * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
   * 验证场景 / Scenario: cancellation, timeout and source lockdown stop the entire guest and release the source lock
   * 协作入口 / Collaborators: `command.startsWith`, `started`, `delay`.
   */
  async (_id, command, _timeout, signal) => {
    if (command.startsWith('cd /workspace')) {
      started();
      await delay(60000, undefined, { signal });
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  for (const mode of ['cancel', 'timeout', 'lockdown']) {
    const running = new Promise<void>((done) => {
      started = done;
    });
    const job = f.service.run(f.source.id, { command: 'wait', timeoutSeconds: mode === 'timeout' ? 1 : 60 });
    await running;
    if (mode === 'cancel') f.jobs.cancel(f.source.id);
    if (mode === 'lockdown') await f.machines.setIncidentLockdown(f.source.id, true);
    await f.jobs.wait(f.source.id);
    assert.equal(job.status, mode === 'cancel' ? 'cancelled' : 'error');
    if (mode === 'timeout') assert.equal(job.execution?.outcome, 'timeout');
    assert.equal(f.machines.records.size, 1);
    assert.equal(f.machines.live.size, 0);
    assert.equal(f.machines.isBusy(f.source.id), false);
  }
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: host shutdown drains active rescue and restart removes the orphan record without resuming it
 * 协作入口 / Collaborators: `fixture`, `f.machines.withRescue`, `assert.rejects`, `f.machines.close`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /abort/i)`; `assert.equal(f.machines.live.size, 0)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('host shutdown drains active rescue and restart removes the orphan record without resuming it', async (t) => {
  const f = await fixture(t);
  let started!: /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void;
  const running = new Promise<void>((done) => {
    started = done;
  });
  const pending = f.machines.withRescue(
    f.source.id,
    new AbortController().signal,
    () => {},
    async (_id, signal) => {
      started();
      await delay(60000, undefined, { signal });
    },
  );
  const rejected = assert.rejects(pending, /abort/i);
  await running;
  await f.machines.close();
  await rejected;
  assert.equal(f.machines.live.size, 0);
  assert.equal(f.machines.isBusy(f.source.id), false);
  const saved = JSON.parse(await readFile(join(root, 'machines.json'), 'utf8'));
  assert.equal(saved.filter((vm: any) => vm.rescueOf).length, 1);
  const restarted = new Machines(f.machines.engine, fakeVmNetwork);
  await restarted.init();
  t.after(() => restarted.close());
  assert.equal(restarted.records.size, 1);
  assert.equal(restarted.get(f.source.id).rescueOf, undefined);
  assert.equal(f.launches.length, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: running or sandbox sources and closed services cannot submit rescue jobs
 * 协作入口 / Collaborators: `fixture`, `f.machines.start`, `assert.throws`, `f.machines.live.get(f.source.id)!.abort.abort`.
 * 检查边界 / Checked boundaries: `assert.throws(() => f.service.run(f.source.id, { command: 'blkid' }), /先停止/)`; `assert.throws(() => f.service.run(box.id, { command: 'blkid' }), /普通实例/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('running or sandbox sources and closed services cannot submit rescue jobs', async (t) => {
  const f = await fixture(t);
  await f.machines.start(f.source.id);
  assert.throws(() => f.service.run(f.source.id, { command: 'blkid' }), /先停止/);
  f.machines.live.get(f.source.id)!.abort.abort();
  await f.machines.live.get(f.source.id)!.done;
  const box = await f.machines.create(
    { name: 'box-' + randomUUID().slice(0, 8) },
    { network: 'isolated', onExpire: 'delete', expiresAt: new Date(Date.now() + 60000).toISOString() },
  );
  assert.throws(() => f.service.run(box.id, { command: 'blkid' }), /普通实例/);
  await f.service.close();
  assert.throws(() => f.service.run(f.source.id, { command: 'blkid' }), /关闭/);
});
