/**
 * 模块职责：回归验证模块，围绕 `management` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `management`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: task history survives restart and interrupted work never resumes implicitly; cancelling a tracked task waits for cleanup and records a durable cancelled result.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import type { Machines as MachinesType } from '../server/machines.ts';
import type { Workspaces as WorkspacesType } from '../server/workspaces.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-management-'));
process.env.SAKURA_DATA_DIR = root;
const { Jobs } = await import('../server/jobs.ts');
const { projectSchema, setupFingerprint } = await import('../server/workspaces.ts');
const { serviceOrder } = await import('../server/project-services.ts');
const { recipeSchema } = await import('../server/recipes.ts');
const { ignored, syncDirection } = await import('../server/sync.ts');
const { verifyBackup, backupPolicySchema } = await import('../server/backups.ts');
const { redact, hostPortIssue } = await import('../server/maintenance.ts');
const { Ide } = await import('../server/ide.ts');
const { dirtyEdit, completeFileSave } = await import('../src/file-editor-state.ts');
after(() => rm(root, { recursive: true, force: true }));

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: task history survives restart and interrupted work never resumes implicitly
 * 协作入口 / Collaborators: `join`, `mkdir`, `writeFile`, `JSON.stringify`.
 * 检查边界 / Checked boundaries: `assert.equal(jobs.view('vm')?.status, 'interrupted')`; `assert.equal(reopened.get('old')?.status, 'interrupted')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('task history survives restart and interrupted work never resumes implicitly', async () => {
  const dir = join(root, 'history');
  await mkdir(dir);
  await writeFile(
    join(dir, 'test.json'),
    JSON.stringify([
      { id: 'old', key: 'vm', status: 'running', startedAt: new Date().toISOString(), log: 'preparing' },
    ]),
  );
  const jobs = new Jobs('test', dir);
  assert.equal(jobs.view('vm')?.status, 'interrupted');
  await jobs.close();
  const reopened = new Jobs('test', dir);
  assert.equal(reopened.get('old')?.status, 'interrupted');
  assert.match(reopened.get('old')!.error!, /重启/);
  await reopened.close();
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: cancelling a tracked task waits for cleanup and records a durable cancelled result
 * 协作入口 / Collaborators: `jobs.track`, `assert.rejects`, `jobs.cancel`, `jobs.view`.
 * 检查边界 / Checked boundaries: `assert.rejects(pending, /取消/)`; `assert.ok(cleaned)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('cancelling a tracked task waits for cleanup and records a durable cancelled result', async () => {
  const jobs = new Jobs('cancel', root);
  let entered!: /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void,
    cleaned = false;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = jobs.track('vm', /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _log; signal。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: cancelling a tracked task waits for cleanup and records a durable cancelled result
   * 协作入口 / Collaborators: `entered`.
   */
  async (_log, signal) => {
    entered();
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        'abort',
        () => {
          cleaned = true;
          resolve();
        },
        { once: true },
      ),
    );
  });
  const rejected = assert.rejects(pending, /取消/);
  await ready;
  jobs.cancel(jobs.view('vm')!.id!);
  await rejected;
  assert.ok(cleaned);
  await jobs.close();
  const data = JSON.parse(await readFile(join(root, 'cancel.json'), 'utf8'));
  assert.equal(data[0].status, 'cancelled');
  assert.ok(data[0].finishedAt);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: multi-service projects validate dependencies, duplicates, cycles and shell-safe environment names
 * 协作入口 / Collaborators: `projectSchema.parse`, `assert.deepEqual`, `serviceOrder(valid.services!).map`, `serviceOrder`.
 * 检查边界 / Checked boundaries: `assert.deepEqual( serviceOrder(valid.services!).map((s) => s.name), ['api', 'web'], )`; `assert.deepEqual( serviceOrder(valid.services!, 'api').map((s) => s.name), ['api'], )`.
 */
test('multi-service projects validate dependencies, duplicates, cycles and shell-safe environment names', () => {
  const valid = projectSchema.parse({
    services: [
      { name: 'web', command: 'npm start', dependsOn: ['api'] },
      { name: 'api', command: 'python app.py' },
    ],
  });
  assert.deepEqual(
    serviceOrder(valid.services!).map((s) => s.name),
    ['api', 'web'],
  );
  assert.deepEqual(
    serviceOrder(valid.services!, 'api').map((s) => s.name),
    ['api'],
  );
  for (const services of [
    [{ name: 'a', command: 'run', dependsOn: ['missing'] }],
    [
      { name: 'a', command: 'run', dependsOn: ['b'] },
      { name: 'b', command: 'run', dependsOn: ['a'] },
    ],
    [
      { name: 'a', command: 'run' },
      { name: 'a', command: 'run' },
    ],
  ])
    assert.equal(projectSchema.safeParse({ services }).success, false);
  assert.equal(projectSchema.safeParse({ environment: { 'A;rm': 'x' } }).success, false);
  assert.notEqual(
    setupFingerprint(projectSchema.parse({ environment: { NODE_ENV: 'dev' } })),
    setupFingerprint(projectSchema.parse({ environment: { NODE_ENV: 'prod' } })),
  );
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: environment recipes reject executable host settings and preserve legacy projects
 * 协作入口 / Collaborators: `recipeSchema.parse`, `assert.equal`, `recipeSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(recipe.project.directory, '/workspace')`; `assert.equal(recipeSchema.safeParse({ ...recipe, hostCommand: 'calc.exe' }).success, false)`.
 */
test('environment recipes reject executable host settings and preserve legacy projects', () => {
  const recipe = recipeSchema.parse({ version: 1, project: { command: 'npm start' } });
  assert.equal(recipe.project.directory, '/workspace');
  assert.equal(recipeSchema.safeParse({ ...recipe, hostCommand: 'calc.exe' }).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, resources: { diskGiB: 129 } }).success, false);
  assert.equal(recipeSchema.safeParse({ ...recipe, resources: { name: 'ignored-name' } }).success, false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: sync decisions distinguish one-sided edits from conflicts and ignores handle nested paths
 * 协作入口 / Collaborators: `assert.equal`, `syncDirection`, `assert.ok`, `ignored`.
 * 检查边界 / Checked boundaries: `assert.equal(syncDirection('new', 'base', 'base'), 'push')`; `assert.equal(syncDirection('base', 'new', 'base'), 'pull')`.
 */
test('sync decisions distinguish one-sided edits from conflicts and ignores handle nested paths', () => {
  assert.equal(syncDirection('new', 'base', 'base'), 'push');
  assert.equal(syncDirection('base', 'new', 'base'), 'pull');
  assert.equal(syncDirection('host', 'guest', 'base'), 'conflict');
  assert.equal(syncDirection('same', 'same'), 'same');
  assert.ok(ignored('nested/debug.log', ['*.log']));
  assert.ok(ignored('build/deep/output.js', ['build/**']));
  assert.ok(ignored('src/dist/bundle.js', ['dist']));
  assert.ok(!ignored('src/distance.ts', ['dist']));
  assert.ok(!ignored('other/output.js', ['build/**']));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: backup verification rejects truncation and changed disk bytes
 * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `createHash('sha256').update(disk).digest`, `createHash('sha256').update`.
 * 检查边界 / Checked boundaries: `assert.match(await verifyBackup(file, signal), /^[a-f0-9]{64}$/)`; `assert.rejects(verifyBackup(file, signal), /校验失败/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('backup verification rejects truncation and changed disk bytes', async () => {
  const disk = Buffer.from('disk bytes'),
    manifest = Buffer.from(JSON.stringify({ sha256: createHash('sha256').update(disk).digest('hex') }));
  const prefix = Buffer.alloc(12);
  prefix.write('SAKURA01');
  prefix.writeUInt32BE(manifest.length, 8);
  const file = join(root, 'backup.sakura');
  await writeFile(file, Buffer.concat([prefix, manifest, disk]));
  const signal = new AbortController().signal;
  assert.match(await verifyBackup(file, signal), /^[a-f0-9]{64}$/);
  await writeFile(file, Buffer.concat([prefix, manifest, Buffer.from('corrupted')]));
  await assert.rejects(verifyBackup(file, signal), /校验失败/);
  await writeFile(file, prefix);
  await assert.rejects(verifyBackup(file, signal));
  assert.equal(backupPolicySchema.safeParse({ keep: 0 }).success, false);
  assert.equal(backupPolicySchema.safeParse({ intervalHours: 0 }).success, false);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
 * 状态影响 / State effects: `machine.live.get(id)!.sshPort`, `port`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `Object.assign`, `join`, `mkdir`.
 * 检查边界 / Checked boundaries: `assert.equal(config.match(/Include/g)?.length, 1)`; `assert.match(config, /Host existing/)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('SSH integration preserves user configuration, is idempotent and follows changed project ports', async (t) => {
  const id = randomUUID();
  const vm = { id, name: 'dev', distro: 'debian' };
  const machine = Object.assign(new EventEmitter(), {
    records: new Map([[id, vm]]),
    live: new Map([[id, { sshPort: 23456 }]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`vm`）。
     * Result: Return the branch-computed value (`vm`).
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     */
    get: () => vm,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     */
    state: () => 'running',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _key: string; fn: () => Promise<unknown>。
     * 结果：返回分支计算值（`fn()`），以 Promise 交付。
     * Result: Return the branch-computed value (`fn()`) through a Promise.
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     * 协作入口 / Collaborators: `fn`.
     */
    locked: async (_key: string, fn: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => fn(),
  }) as unknown as MachinesType;
  const project = {
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ directory: "/workspace/中文 path/$HOME/`marker/it's" })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ directory: "/workspace/中文 path/$HOME/`marker/it's" })`) through a Promise.
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     */
    config: async () => ({ directory: "/workspace/中文 path/$HOME/`marker/it's" }),
  } as unknown as WorkspacesType;
  const dir = join(root, 'user-ssh');
  await mkdir(dir);
  await writeFile(join(dir, 'config'), 'Host existing\n  HostName example.com\n');
  const ide = new Ide(machine, project, dir);
  t.after(() => ide.close());
  const alias = `sakura-${id}-default`;
  let port = 43333, starts = 0;
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`({ hostKeyAlias: alias, port, identity: join(root, 'project-ssh', 'default', 'id…`）。
   * Result: Return the branch-computed value (`({ hostKeyAlias: alias, port, identity: join(root, 'project-ssh', 'default', 'id…`).
   * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
   * 协作入口 / Collaborators: `join`.
   */
  const endpoint = () => ({ hostKeyAlias: alias, port,
    identity: join(root, 'project-ssh', 'default', 'id_rsa'),
    knownHosts: join(root, 'project-ssh', 'default', 'known_hosts') });
  Reflect.set(ide, 'projectSsh', {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: vmId: string; config: { directory: string }。
     * 结果：返回受控对象，公开字段包括 `present, running, valid, processes`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `present, running, valid, processes`; the actual branch determines its shape.
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     * 协作入口 / Collaborators: `assert.equal`, `project.config`.
     * 检查边界 / Checked boundaries: `assert.equal(vmId, id)`; `assert.equal(config.directory, (await project.config(id)).directory)`.
     */
    status: async (vmId: string, config: { directory: string }) => {
      assert.equal(vmId, id);
      assert.equal(config.directory, (await project.config(id)).directory);
      return { present: true, running: true, valid: true, processes: 1 };
    },
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: vmId: string。
     * 结果：返回分支计算值（`endpoint()`），以 Promise 交付。
     * Result: Return the branch-computed value (`endpoint()`) through a Promise.
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     * 协作入口 / Collaborators: `assert.equal`, `endpoint`.
     * 检查边界 / Checked boundaries: `assert.equal(vmId, id)`.
     */
    endpoint: async (vmId: string) => { assert.equal(vmId, id); return endpoint(); },
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     * 协作入口 / Collaborators: `endpoint`.
     */
    entries: async () => [endpoint()],
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: vmId: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     * 协作入口 / Collaborators: `assert.equal`.
     * 检查边界 / Checked boundaries: `assert.equal(vmId, id)`.
     */
    start: async (vmId: string) => { assert.equal(vmId, id); ++starts; },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 验证场景 / Scenario: SSH integration preserves user configuration, is idempotent and follows changed project ports
     */
    close: async () => {},
  });
  await ide.install(id);
  await ide.install(id);
  const config = await readFile(join(dir, 'config'), 'utf8');
  assert.equal(config.match(/Include/g)?.length, 1);
  assert.match(config, /Host existing/);
  const state = await ide.view(id);
  assert.match(state.url, /%E4%B8%AD%E6%96%87%20path/);
  assert.equal(
    state.command,
    `code --remote ssh-remote+${alias} '/workspace/中文 path/$HOME/\`marker/it''s'`,
  );
  assert.equal(starts, 2);
  const generated = await readFile(join(root, 'ssh/config'), 'utf8');
  assert.match(generated, /Port 43333/);
  assert.match(generated, /StrictHostKeyChecking yes/);
  assert.match(generated, /project-ssh\/default\/id_rsa/);
  assert.equal(generated.includes('Port 23456'), false);
  machine.live.get(id)!.sshPort = 34567;
  port = 43334;
  await ide.update();
  const updated = await readFile(join(root, 'ssh/config'), 'utf8');
  assert.match(updated, /Port 43334/);
  assert.equal(updated.includes('Port 34567'), false);
  await ide.close();
  assert.equal(machine.listenerCount('change'), 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: diagnostic reports remove private keys, credentials and local paths
 * 协作入口 / Collaborators: `redact`, `assert.ok`, `value.includes`.
 * 检查边界 / Checked boundaries: `assert.ok(!value.includes(secret))`.
 */
test('diagnostic reports remove private keys, credentials and local paths', () => {
  const value = redact(
    'token=abc password: xyz\n-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----\nC:\\Users\\Alice\\workspace\nhttps://user:pass@example.com\nAuthorization: Bearer abc.def\n{"password":"two words","authorization":"Basic ZGVtbw=="}',
  );
  for (const secret of ['abc', 'xyz', 'PRIVATE KEY', 'Alice', 'user:pass', 'words', 'ZGVtbw'])
    assert.ok(!value.includes(secret));
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: diagnostics detect host program port conflicts and release successful probes
 * 协作入口 / Collaborators: `createServer`, `t.after`, `server.address`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(await hostPortIssue(port), 'EADDRINUSE')`; `assert.equal(await hostPortIssue(port), null)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('diagnostics detect host program port conflicts and release successful probes', async (t) => {
  const server = createServer();
  t.after(() => {
    if (server.listening) server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  assert.equal(await hostPortIssue(port), 'EADDRINUSE');
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  assert.equal(await hostPortIssue(port), null);
  assert.equal(await hostPortIssue(port), null);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: drafts detect unsaved text and retain newer typing after a successful save
 * 协作入口 / Collaborators: `assert.ok`, `dirtyEdit`, `completeFileSave`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.ok(dirtyEdit(submitted))`; `assert.ok(!dirtyEdit({ ...submitted, content: 'old' }))`.
 */
test('drafts detect unsaved text and retain newer typing after a successful save', () => {
  const submitted = { path: '/a', content: 'one', baseContent: 'old', version: 'old-version' };
  assert.ok(dirtyEdit(submitted));
  assert.ok(!dirtyEdit({ ...submitted, content: 'old' }));
  const next = completeFileSave({ ...submitted, content: 'two' }, submitted)!;
  assert.equal(next.content, 'two');
  assert.equal(next.baseContent, 'one');
  assert.ok(dirtyEdit(next));
});
