/**
 * 模块职责：回归验证模块，围绕 `snapshot-diff` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `snapshot-diff`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: snapshot diff validates states and paths, and parses newline-safe filenames; snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { Machines } from '../server/machines.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-snapshot-diff-test-'));
process.env.SAKURA_DATA_DIR = root;
const { SnapshotDiff, parseSnapshotManifest, compareSnapshotManifests, snapshotManifestCommand } =
  await import('../server/snapshot-diff.ts');
const { snapshotDiffInputSchema } = await import('../shared/snapshot-diff.ts');
const { vmDir } = await import('../server/model.ts');
after(async () => {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith('sakura-snapshot-diff-test-'));
  await rm(root, { recursive: true, force: true });
});

/**
 * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
 * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
 * 输入 / Inputs: type: 'F' | 'L'; mount: string; path: string; value: string; bytes: number。
 * 结果：返回分支计算值（`[ type, Buffer.from(mount + path).toString('base64'), ...(bytes === undefined ? …`）。
 * Result: Return the branch-computed value (`[ type, Buffer.from(mount + path).toString('base64'), ...(bytes === undefined ? …`).
 * 协作入口 / Collaborators: `[ type, Buffer.from(mount + path).toString('base64'), ...(bytes === undefin…`, `Buffer.from(mount + path).toString`, `Buffer.from`, `Buffer.from(value).toString`.
 */
const line = (type: 'F' | 'L', mount: string, path: string, value: string, bytes?: number) =>
  [
    type,
    Buffer.from(mount + path).toString('base64'),
    ...(bytes === undefined ? [Buffer.from(value).toString('base64')] : [String(bytes), value]),
  ].join('\t') + '\n';

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: snapshot diff validates states and paths, and parses newline-safe filenames
 * 协作入口 / Collaborators: `randomUUID`, `assert.equal`, `snapshotDiffInputSchema.parse`, `snapshotDiffInputSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(snapshotDiffInputSchema.parse({ from }).path, '/workspace')`; `assert.equal(snapshotDiffInputSchema.safeParse({ from, path }).success, false, path)`.
 */
test('snapshot diff validates states and paths, and parses newline-safe filenames', () => {
  const from = randomUUID();
  assert.equal(snapshotDiffInputSchema.parse({ from }).path, '/workspace');
  for (const path of ['relative', '/../etc', '/a/../b', '/a//b', '/a/', '/a\\b', '/a\nb'])
    assert.equal(snapshotDiffInputSchema.safeParse({ from, path }).success, false, path);
  assert.equal(snapshotDiffInputSchema.safeParse({ from, to: from }).success, false);
  const hash = 'a'.repeat(64);
  const before = parseSnapshotManifest(
    line('F', '/mnt/source', '/workspace/new\nline.txt', hash, 12) +
      line('L', '/mnt/source', '/workspace/link', '../target'),
    '/mnt/source',
  );
  const after = parseSnapshotManifest(
    line('F', '/mnt/compare', '/workspace/new\nline.txt', 'b'.repeat(64), 12) +
      line('F', '/mnt/compare', '/workspace/added', hash, 4),
    '/mnt/compare',
  );
  const result = compareSnapshotManifests(before, after, snapshotDiffInputSchema.parse({ from }), true);
  assert.deepEqual(result.counts, { before: 2, after: 2, added: 1, removed: 1, modified: 1 });
  assert.equal(result.modified[0].path, '/workspace/new\nline.txt');
  assert.equal(result.diskChanged, true);
  assert.equal(parseSnapshotManifest('MISSING\n', '/mnt/source').size, 0);
  assert.throws(
    () => parseSnapshotManifest(line('F', '/mnt/compare', '/escape', hash, 1), '/mnt/source'),
    /越过/,
  );
  assert.match(snapshotManifestCommand('/mnt/source', '/workspace'), /sha256sum < "\$file"/);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
 * 协作入口 / Collaborators: `randomUUID`, `'f'.repeat`, `service.run`, `service.jobs.wait`.
 * 检查边界 / Checked boundaries: `assert.equal(job.status, 'done', job.error)`; `assert.equal(calls.filter((call) => call.args[0] === 'convert').length, 2)`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results', async () => {
  const id = randomUUID(),
    from = randomUUID(),
    to = randomUUID();
  const calls: Array<{ tool: string; args: string[] }> = [];
  const attachments: string[][] = [];
  const hash = 'f'.repeat(64);
  const machines = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     */
    on: () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     */
    off: () => {},
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, name: 'source', snapshots: [{ id: from }, { id: to }] })`）。
     * Result: Return the branch-computed value (`({ id, name: 'source', snapshots: [{ id: from }, { id: to }] })`).
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     */
    get: () => ({ id, name: 'source', snapshots: [{ id: from }, { id: to }] }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     */
    requireUnlocked: () => {},
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     */
    requireStopped: () => {},
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回布尔判定，供用例选择路径或核对受控条件。
     * Result: Return a boolean decision for path selection or controlled-condition assertions.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     */
    isBusy: () => false,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; work: () => Promise<unknown>。
     * 结果：返回分支计算值（`work()`），以 Promise 交付。
     * Result: Return the branch-computed value (`work()`) through a Promise.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
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
    engine: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: tool: string; args: string[]。
       * 结果：返回分支计算值（`''`），以 Promise 交付。
       * Result: Return the branch-computed value (`''`) through a Promise.
       * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
       * 协作入口 / Collaborators: `calls.push`, `writeFile`, `args.at`.
       */
      run: async (tool: string, args: string[]) => {
        calls.push({ tool, args });
        await writeFile(args.at(-1)!, 'temp disk');
        return '';
      },
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: tool: string; args: string[]。
       * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
       * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
       * 协作入口 / Collaborators: `calls.push`.
       */
      runStatus: async (tool: string, args: string[]) => {
        calls.push({ tool, args });
        return { code: 1, stdout: '', stderr: '' };
      },
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; signal: AbortSignal; _phase: unknown; work: (id: string, signal: AbortSignal) => Promise<unknown>; _diagnostic: unknown; disks: string[]。
     * 结果：返回分支计算值（`work('rescue', signal)`），以 Promise 交付。
     * Result: Return the branch-computed value (`work('rescue', signal)`) through a Promise.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     * 协作入口 / Collaborators: `attachments.push`, `work`.
     */
    withRescue: async (
      _id: string,
      signal: AbortSignal,
      _phase: unknown,
      work: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: id: string; signal: AbortSignal。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      (id: string, signal: AbortSignal) => Promise<unknown>,
      _diagnostic: unknown,
      ...disks: string[]
    ) => {
      attachments.push(disks);
      return work('rescue', signal);
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: command.includes('find "$root"') ? command.inclu…`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: command.includes('find "$root"') ? command.inclu…`) through a Promise.
     * 验证场景 / Scenario: snapshot comparison converts the selected state, scans both read-only disks, compares sectors and persists results
     * 协作入口 / Collaborators: `command.includes`, `line`, `'e'.repeat`.
     */
    exec: async (_id: string, command: string) => ({
      code: 0,
      stderr: '',
      stdout: command.includes('find "$root"')
        ? command.includes('/mnt/source')
          ? line('F', '/mnt/source', '/workspace/a.txt', hash, 1)
          : line('F', '/mnt/compare', '/workspace/a.txt', 'e'.repeat(64), 1)
        : '',
    }),
  } as unknown as Machines;
  const service = new SnapshotDiff(machines);
  try {
    const job = service.run(id, { from, to, path: '/workspace' });
    await service.jobs.wait(id);
    assert.equal(job.status, 'done', job.error);
    assert.equal(calls.filter((call) => call.args[0] === 'convert').length, 2);
    assert.deepEqual(calls.find((call) => call.args[0] === 'compare')?.args.slice(0, 3), [
      'compare',
      '-q',
      '-f',
    ]);
    assert.equal(attachments.length, 1);
    assert.ok(attachments[0][0].endsWith('before.qcow2'));
    assert.ok(attachments[0][1].endsWith('after.qcow2'));
    const result = await service.jobs.result(job.id!);
    assert.equal(result.counts.modified, 1);
    assert.equal(result.diskChanged, true);
    await assert.rejects(readFile(attachments[0][0]), /ENOENT/);
    await assert.rejects(readFile(attachments[0][1]), /ENOENT/);
    assert.equal(service.view(id).runs[0].id, job.id);
    assert.equal(service.view(randomUUID()).runs.length, 0);
    assert.equal(join(vmDir(id), 'disk.qcow2').includes(id), true);
  } finally {
    await service.close();
  }
});
