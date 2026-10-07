/**
 * 模块职责：回归验证模块，围绕 `project-ssh` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-ssh`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: OpenRC receipts require their own launcher and service while legacy systemd receipts remain strict; SSH stop preserves the bridge and service when recovering an issued ticket fails or its build disagrees with the saved endpoint.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';

const root = await mkdtemp(join(tmpdir(), 'sakura-project-ssh-test-'));
process.env.SAKURA_DATA_DIR = root;
const { ProjectSsh, projectSshBinding, projectSshPaths, projectSshRecordSchema } =
  await import('../server/project-ssh.ts');
const { createSshKey } = await import('../server/seed.ts');
const { vmDir, AppError } = await import('../server/model.ts');
const { projectSchema } = await import('../server/workspaces.ts');
const { projectIdentitySchema, projectIdentityRunSchema } = await import('../server/project-identity.ts');
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(tmpdir()));
  assert.match(basename(owned), /^sakura-project-ssh-test-/);
  await rm(owned, { recursive: true, force: true });
});
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: value: string。
 * 结果：返回分支计算值（`createHash('sha256').update(value).digest('hex')`）。
 * Result: Return the branch-computed value (`createHash('sha256').update(value).digest('hex')`).
 * 协作入口 / Collaborators: `createHash('sha256').update(value).digest`, `createHash('sha256').update`, `createHash`.
 */
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const projectId = '1122334455667788',
  p = projectSshPaths(projectId);
const basic = {
  version: 1 as const,
  projectId,
  runId: randomUUID(),
  binding: sha('project'),
  guestPort: 22022,
  environment: sha('environment'),
  hostPublicKey: 'ssh-ed25519 YWJjZA==',
};
const common = Object.fromEntries(
  ['command', 'sshd_config', 'authorized_keys', 'hostkey'].map((name) => [p.config + '/' + name, sha(name)]),
);
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: project: { directory: string; networkIsolation?: string }。
 * 结果：返回分支计算值（`projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUI…`）。
 * Result: Return the branch-computed value (`projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUI…`).
 * 协作入口 / Collaborators: `randomUUID`, `projectIdentitySchema.parse`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`.
 */
function account(project: { directory: string; networkIsolation?: string }) {
  const identityId = randomUUID();
  return projectIdentitySchema.parse({
    version: 1,
    phase: 'active',
    registryId: randomUUID(),
    identityId,
    projectId,
    revision: 1,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    uid: 20000,
    gid: 20000,
    home: '/var/lib/sakura-project-homes/' + identityId,
    directory: project.directory,
    homeDevice: '1',
    homeInode: '2',
    directoryDevice: '1',
    directoryInode: '3',
    networkIsolation: project.networkIsolation || 'host',
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: OpenRC receipts require their own launcher and service while legacy systemd receipts remain strict
 * 协作入口 / Collaborators: `sha`, `assert.equal`, `projectSshRecordSchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(projectSshRecordSchema.safeParse(legacy).success, true)`; `assert.equal(projectSshRecordSchema.safeParse({ ...legacy, manager: 'systemd' }).success, true)`.
 */
test('OpenRC receipts require their own launcher and service while legacy systemd receipts remain strict', () => {
  const legacy = { ...basic, files: { ...common, [p.unitPath]: sha('systemd') } };
  assert.equal(projectSshRecordSchema.safeParse(legacy).success, true);
  assert.equal(projectSshRecordSchema.safeParse({ ...legacy, manager: 'systemd' }).success, true);
  assert.equal(projectSshRecordSchema.safeParse({ ...legacy, manager: 'openrc' }).success, false);
  const openrc = {
    ...basic,
    manager: 'openrc',
    files: { ...common, [p.openrcPath]: sha('openrc'), [p.config + '/launch.py']: sha('launcher') },
  };
  assert.equal(projectSshRecordSchema.safeParse(openrc).success, true);
  assert.equal(projectSshRecordSchema.safeParse({ ...openrc, manager: undefined }).success, false);
  assert.equal(
    projectSshRecordSchema.safeParse({ ...openrc, files: { ...openrc.files, [p.unitPath]: sha('systemd') } })
      .success,
    false,
  );
  assert.equal(
    projectSshRecordSchema.safeParse({ ...openrc, projectId: '8877665544332211' }).success,
    false,
    'another project cannot reuse the receipt file set',
  );
});

for (const distro of ['alpine', 'debian'] as const) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `scopeFailure`, `state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `randomUUID`, `createSshKey`, `projectSchema.parse`, `join`.
   * 检查边界 / Checked boundaries: `assert.equal((await service.status(id, project)).valid, true)`; `assert.equal(refused.valid, false)`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`${distro} project SSH refuses a changed client key or host pin despite a valid guest report`, async () => {
    const id = randomUUID(),
      key = createSshKey();
    const project = {
      ...projectSchema.parse({
        directory: '/workspace/test',
        networkIsolation: 'private',
        environment: { SAKURA_SCOPE: 'test' },
      }),
      _workspace: projectId,
    };
    const folder = join(vmDir(id), 'project-ssh', projectId);
    const identity = account(project),
      bootId = randomUUID(),
      snapshotSha256 = sha('snapshot');
    const run = projectIdentityRunSchema.parse({
      version: 1,
      phase: 'active',
      mode: 'inherit-current',
      registryId: identity.registryId,
      identityId: identity.identityId,
      projectId,
      revision: 1,
      runId: basic.runId,
      bootId,
      build: 'a'.repeat(64),
      cgroupDevice: '1',
      cgroupInode: '4',
      networkDevice: '1',
      networkInode: '5',
      cgroupName: distro === 'alpine' ? 'openrc.sakura-ssh-' + projectId : 'system.slice/' + p.unit,
      namespace: 'sk-' + projectId,
    });
    await mkdir(folder, { recursive: true });
    const record = {
      ...basic,
      binding: projectSshBinding(project),
      environment: sha(JSON.stringify([['SAKURA_SCOPE', 'test']])),
      execution: { identity, bootId, build: run.build, snapshotSha256 },
      ...(distro === 'alpine' ? { manager: 'openrc' as const } : {}),
      files: {
        ...common,
        [p.config + '/session.json']: snapshotSha256,
        [p.config + '/authorized_keys']: sha(key.publicText.trim() + '\n'),
        ...(distro === 'alpine'
          ? { [p.openrcPath]: sha('openrc'), [p.config + '/launch.py']: sha('launcher') }
          : { [p.unitPath]: sha('systemd') }),
      },
    };
    await writeFile(join(folder, 'runtime.json'), JSON.stringify(record));
    await writeFile(join(folder, 'id_rsa'), key.privateText);
    await writeFile(join(folder, 'id_rsa.pub'), key.publicText + '\n');
    const knownHosts = `sakura-${id}-${projectId} ${basic.hostPublicKey}\n`;
    await writeFile(join(folder, 'known_hosts'), knownHosts);
    let guestCalls = 0,
      state = 'running';
    let scopeFailure: Error | undefined;
    const machines = Object.assign(new EventEmitter(), {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ id, distro })`）。
       * Result: Return the branch-computed value (`({ id, distro })`).
       */
      get: () => ({ id, distro }),
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`state`）。
       * Result: Return the branch-computed value (`state`).
       */
      state: () => state,
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
       * 协作入口 / Collaborators: `JSON.stringify`.
       */
      exec: async () => {
        guestCalls++;
        return {
          code: 0,
          stderr: '',
          stdout: JSON.stringify({
            present: true,
            running: true,
            valid: true,
            processes: 2,
            reason: null,
            daemon: { pid: 100, startTicks: '200', bootId, cgroupName: run.cgroupName },
          }),
        };
      },
    }) as unknown as Machines;
    const spaces = {
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`project`），以 Promise 交付。
       * Result: Return the branch-computed value (`project`) through a Promise.
       */
      config: async () => project,
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`project`），以 Promise 交付。
       * Result: Return the branch-computed value (`project`) through a Promise.
       */
      resolvedConfig: async () => project,
      projects: {
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: _id: string; _projectId: string; action: () => Promise<unknown>。
         * 结果：返回分支计算值（`action()`），以 Promise 交付。
         * Result: Return the branch-computed value (`action()`) through a Promise.
         * 协作入口 / Collaborators: `action`.
         */
        inScope: async (_id: string, _projectId: string, action: /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
         * Result: The declared return type defines the result; its test provider supplies the implementation.
         */
        () => Promise<unknown>) => action(),
      },
    } as unknown as Workspaces;
    const service = new ProjectSsh(machines, spaces, {
      scopes: {
        /**
         * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
         * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new Error('status must not admit')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        beginSsh: async () => {
          throw new Error('status must not admit');
        },
        /**
         * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
         * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new Error('status must not admit')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        activateSsh: async () => {
          throw new Error('status must not admit');
        },
        /**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: 无 / none。
         * 结果：返回受控对象，公开字段包括 `identity, run, owner, sha256`；各分支以实际返回对象为准。
         * Result: Return a controlled object exposing fields such as `identity, run, owner, sha256`; the actual branch determines its shape.
         * 失败 / Failure: `scopeFailure`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        sshRun: async () => {
          if (scopeFailure) throw scopeFailure;
          return { identity, run,
            owner: { kind: 'ssh', bootId, runId: run.runId, cgroupName: run.cgroupName },
            sha256: snapshotSha256 };
        },
        /**
         * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
         * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
         * 输入 / Inputs: 无 / none。
         * 结果：返回列表形式的受控数据，供调用者遍历或比较。
         * Result: Return controlled data as a list for iteration or comparison.
         */
        sshRuns: async () => [],
        /**
         * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
         * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new Error('status must not recover cleanup authority')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         */
        recoverSshTicket: async () => {
          throw new Error('status must not recover cleanup authority');
        },
        /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         */
        closeAfterScopeStopped: async () => {},
      },
    });
    try {
      assert.equal((await service.status(id, project)).valid, true);
      for (const code of ['EGRESS_NNP_RESTART_REQUIRED', 'EGRESS_NNP_PENDING',
        'EGRESS_NNP_SERVICE_UNVERIFIED', 'EGRESS_NNP_PROCESS_CHANGED']) {
        scopeFailure = new AppError('account admission refused (' + code + ')', 409, 'PROJECT_IDENTITY_' + code);
        const refused = await service.status(id, project);
        assert.equal(refused.valid, false);
        assert.equal(refused.reason, scopeFailure.message,
          'an NNP admission failure must retain its actual reason instead of requesting an unrelated SSH rebuild');
        assert.equal(await service.endpoint(id, project), null, 'a detailed failure never authorizes a bridge');
      }
      scopeFailure = new AppError('changed original run', 409, 'PROJECT_IDENTITY_RUN_STALE');
      assert.match((await service.status(id, project)).reason || '', /完整账号票据/);
      scopeFailure = undefined;
      assert.equal((await service.status(id, project)).valid, true);
      await writeFile(join(folder, 'known_hosts'), 'unreviewed host pin\n');
      const changedPin = await service.status(id, project);
      assert.equal(changedPin.valid, false);
      assert.match(changedPin.reason || '', /客户端密钥或主机公钥/);
      await writeFile(join(folder, 'known_hosts'), knownHosts);
      await writeFile(join(folder, 'id_rsa'), createSshKey().privateText);
      assert.equal((await service.status(id, project)).valid, false);
      state = 'paused';
      const prior = guestCalls;
      assert.equal((await service.status(id, project)).valid, false);
      assert.equal(guestCalls, prior, 'paused instances never use a stale guest status to export a bridge');
    } finally {
      await service.close();
    }
  });
}

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: distro: 'alpine' | 'debian'; mode: string。
 * 结果：返回受控对象，公开字段包括 `service, id, folder, commands, counts, replacement`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, id, folder, commands, counts, replacement`; the actual branch determines its shape.
 * 状态影响 / State effects: `(service as any).bridges.stop`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `join`, `vmDir`.
 */
async function rollbackFixture(distro: 'alpine' | 'debian', mode: string) {
  const id = randomUUID(),
    instance = {},
    boot = randomUUID();
  const project = {
    ...projectSchema.parse({ directory: '/workspace/rollback', networkIsolation: 'private' }),
    _workspace: projectId,
  };
  const folder = join(vmDir(id), 'project-ssh', projectId);
  const commands: string[] = [];
  let checks = 0,
    stops = 0,
    bridgeStops = 0;
  let replacement: any, intent: any;
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, instance]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, distro })`）。
     * Result: Return the branch-computed value (`({ id, distro })`).
     */
    get: () => ({ id, distro }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_id: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action(),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 状态影响 / State effects: `replacement`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('owned rollback verification connection failed')`; `new Error('owned rollback stop connection failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `command.startsWith`, `JSON.stringify`, `command.includes`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command === 'cat /proc/sys/kernel/random/boot_id') return { code: 0, stdout: boot, stderr: '' };
      if (command.startsWith('# SAKURA_PROJECT_SSH_STATUS'))
        return {
          code: 0,
          stdout: JSON.stringify({
            present: false,
            running: false,
            valid: false,
            processes: 0,
            reason: null,
          }),
          stderr: '',
        };
      if (command.includes('# SAKURA_GUEST_TASK_RUN'))
        return {
          code: 0,
          stdout: 'SAKURA_SSH_HOST_KEY=ssh-ed25519 YWJjZA==\nSAKURA_SSH_BOOT_ID=' + boot + '\n',
          stderr: '',
        };
      if (command.includes('s.bind(')) return { code: 0, stdout: '22022\n', stderr: '' };
      if (command.startsWith('sha256sum '))
        return { code: 0, stdout: sha('hostkey') + '  hostkey\n', stderr: '' };
      if (
        command.includes('systemctl start ' + p.unit) ||
        command.includes('rc-service ' + p.openrcUnit + ' start')
      ) {
        if (mode === 'new-bridge' || mode === 'new-host-record') {
          const original = JSON.parse(await readFile(join(folder, 'runtime.json'), 'utf8'));
          replacement = { port: 22023, record: { ...original, runId: randomUUID() }, project };
          (service as any).endpoints.set(id + ':' + projectId, replacement);
          if (mode === 'new-host-record')
            await writeFile(join(folder, 'runtime.json'), JSON.stringify(replacement.record));
        }
        return { code: 1, stdout: '', stderr: 'owned original startup failure' };
      }
      if (command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK')) {
        ++checks;
        if ((mode === 'first-check-failure' && checks === 1) || mode === 'all-check-failures')
          throw new Error('owned rollback verification connection failed');
        if (mode === 'new-live') machines.live.set(id, {} as any);
        if (mode === 'changed-boot')
          return { code: 1, stdout: '', stderr: '客户机启动身份已改变；拒绝旧项目 SSH 回滚' };
        if (mode === 'changed-guest-run')
          return { code: 1, stdout: '', stderr: '项目 SSH 运行身份已改变；拒绝终止其他启动' };
        return { code: 0, stdout: 'SAKURA_PROJECT_SSH_OWNED\n', stderr: '' };
      }
      if (command.includes('sakura_rollback_owner=$(')) {
        ++stops;
        if ((mode === 'first-stop-failure' && stops === 1) || mode === 'all-stop-failures')
          throw new Error('owned rollback stop connection failed');
        if (mode === 'changed-before-stop') return { code: 1, stdout: '', stderr: '运行身份在停止前已改变' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
  }) as unknown as Machines;
  const spaces = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     */
    resolvedConfig: async () => project,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`project`），以 Promise 交付。
     * Result: Return the branch-computed value (`project`) through a Promise.
     */
    config: async () => project,
    projects: {
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`projectId`）。
       * Result: Return the branch-computed value (`projectId`).
       */
      current: () => projectId,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _id: string; _projectId: string; action: () => Promise<unknown>。
       * 结果：返回分支计算值（`action()`），以 Promise 交付。
       * Result: Return the branch-computed value (`action()`) through a Promise.
       * 协作入口 / Collaborators: `action`.
       */
      inScope: async (_id: string, _projectId: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => Promise<unknown>) => action(),
    },
  } as unknown as Workspaces;
  const identity = account(project);
  const service = new ProjectSsh(machines, spaces, {
    identities: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`'/usr/bin/python3 -I -S /fixed/controller.py metadata-only'`），以 Promise 交付。
       * Result: Return the branch-computed value (`'/usr/bin/python3 -I -S /fixed/controller.py metadata-only'`) through a Promise.
       */
      sshSessionCommand: async () => '/usr/bin/python3 -I -S /fixed/controller.py metadata-only',
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       */
      publishSshSnapshot: async () => {},
    },
    scopes: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`(intent ? [intent] : [])`），以 Promise 交付。
       * Result: Return the branch-computed value (`(intent ? [intent] : [])`) through a Promise.
       */
      sshRuns: async () => (intent ? [intent] : []),
      /**
       * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
       * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`null`），以 Promise 交付。
       * Result: Return the branch-computed value (`null`) through a Promise.
       */
      recoverSshTicket: async () => null,
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `intent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       */
      closeAfterScopeStopped: async () => {
        intent = undefined;
      },
      /**
       * 中文功能：生成或核对本组验证所需的摘要与身份材料。
       * English: Generate or verify digest and identity material required by this suite.
       * 输入 / Inputs: _vm; _project; runId; owner; environment。
       * 结果：返回受控对象，公开字段包括 `identity, owner, snapshot`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `identity, owner, snapshot`; the actual branch determines its shape.
       * 状态影响 / State effects: `intent`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `Buffer.from`, `JSON.stringify`, `createHash('sha256').update(input).digest`, `createHash('sha256').update`.
       */
      beginSsh: async (_vm, _project, runId, owner, environment) => {
        const input = Buffer.from(JSON.stringify(environment));
        intent = {
          runId,
          owner,
          identity,
          sha256: createHash('sha256').update(input).digest('hex'),
          phase: 'intent',
          run: null,
        };
        return {
          identity,
          owner,
          snapshot: {
            runId,
            input,
            build: 'a'.repeat(64),
            command: '/fixed/controller metadata-only',
            sha256: createHash('sha256').update(input).digest('hex'),
          },
        };
      },
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 失败 / Failure: `new Error('failed start must not activate')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      activateSsh: async () => {
        throw new Error('failed start must not activate');
      },
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 失败 / Failure: `new Error('failed start must not inspect')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      sshRun: async () => {
        throw new Error('failed start must not inspect');
      },
    },
  });
  (service as any).bridges.stop = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  async () => {
    ++bridgeStops;
  };
  return {
    service,
    id,
    folder,
    commands,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ checks, stops, bridgeStops })`）。
     * Result: Return the branch-computed value (`({ checks, stops, bridgeStops })`).
     */
    counts: () => ({ checks, stops, bridgeStops }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`replacement`）。
     * Result: Return the branch-computed value (`replacement`).
     */
    replacement: () => replacement,
  };
}

for (const distro of ['alpine', 'debian'] as const) {
  for (const mode of ['first-check-failure', 'first-stop-failure']) {
    /**
     * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
     * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `rollbackFixture`, `assert.rejects`, `f.service.start`, `f.counts`.
     * 检查边界 / Checked boundaries: `assert.rejects( f.service.start(f.id), (error: any) => error.code !== 'PROJECT_SSH_CLEANUP_FAILED' && /owned original startup fail…`; `assert.equal(counts.checks, 2)`.
     * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
     * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
     */
    test(`${distro} project SSH retries ${mode} and retains the original startup error and record`, async () => {
      const f = await rollbackFixture(distro, mode);
      try {
        await assert.rejects(
          f.service.start(f.id),
          (error: any) =>
            error.code !== 'PROJECT_SSH_CLEANUP_FAILED' &&
            /owned original startup failure/.test(error.message),
        );
        const counts = f.counts();
        assert.equal(counts.checks, 2);
        assert.equal(counts.stops, mode === 'first-stop-failure' ? 2 : 1);
        assert.equal(counts.bridgeStops, mode === 'first-stop-failure' ? 2 : 1);
        const record = JSON.parse(await readFile(join(f.folder, 'runtime.json'), 'utf8'));
        assert.equal(projectSshRecordSchema.safeParse(record).success, true);
        for (const command of f.commands.filter((value) => value.includes('sakura_rollback_owner=$('))) {
          assert.ok(command.includes(record.runId));
          assert.ok(command.includes('/proc/sys/kernel/random/boot_id'));
          assert.ok(
            command.indexOf('binding.get') <
              command.indexOf(distro === 'alpine' ? 'with open(path' : 'systemctl stop'),
          );
        }
      } finally {
        await f.service.close();
      }
    });
  }
  for (const mode of [
    'all-check-failures',
    'all-stop-failures',
    'changed-boot',
    'changed-guest-run',
    'changed-before-stop',
    'new-live',
    'new-bridge',
    'new-host-record',
  ]) {
    /**
     * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
     * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `rollbackFixture`, `assert.rejects`, `f.service.start`, `f.counts`.
     * 检查边界 / Checked boundaries: `assert.rejects( f.service.start(f.id), (error: any) => error.code === 'PROJECT_SSH_CLEANUP_FAILED' && /owned original startup fail…`; `assert.equal(counts.stops, 3)`.
     * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
     * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
     */
    test(`${distro} project SSH reports uncertain ${mode} without dropping its record or affecting a new bridge`, async () => {
      const f = await rollbackFixture(distro, mode);
      try {
        await assert.rejects(
          f.service.start(f.id),
          (error: any) =>
            error.code === 'PROJECT_SSH_CLEANUP_FAILED' &&
            /owned original startup failure/.test(error.message) &&
            /回滚清理未确认/.test(error.message) &&
            error.message.includes('runtime.json'),
        );
        const counts = f.counts();
        if (mode === 'all-stop-failures' || mode === 'changed-before-stop') assert.equal(counts.stops, 3);
        else {
          assert.equal(counts.stops, 0);
          assert.equal(counts.bridgeStops, 0);
        }
        if (mode === 'new-live') assert.equal(counts.checks, 1);
        else if (!mode.startsWith('new-')) assert.equal(counts.checks, 3);
        const record = JSON.parse(await readFile(join(f.folder, 'runtime.json'), 'utf8'));
        assert.equal(projectSshRecordSchema.safeParse(record).success, true);
        if (mode.startsWith('new-') && mode !== 'new-live')
          assert.equal((f.service as any).endpoints.get(f.id + ':' + projectId), f.replacement());
      } finally {
        await f.service.close();
      }
    });
  }
}

for (const stored of [true, false]) {
  /**
   * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
   * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `sshCleanupFixture`, `f.service.stop`, `assert.deepEqual`, `f.service.close`.
   * 检查边界 / Checked boundaries: `assert.deepEqual(f.events, [ 'recover-original', 'verify-original', 'close-bridge', 'stop-original', 'close-ticket', ])`.
   * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
   * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
   */
  test(`SSH stop recovers the full original native ticket before any service operation with ${stored ? 'a saved endpoint record' : 'only its durable intent'}`, async () => {
    const f = await sshCleanupFixture(stored);
    try {
      await f.service.stop(f.id);
      assert.deepEqual(f.events, [
        'recover-original',
        'verify-original',
        'close-bridge',
        'stop-original',
        'close-ticket',
      ]);
    } finally {
      await f.service.close();
    }
  });
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: SSH stop preserves the bridge and service when recovering an issued ticket fails or its build disagrees with the saved endpoint
 * 协作入口 / Collaborators: `sshCleanupFixture`, `assert.rejects`, `f.service.stop`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.stop(f.id), (error: any) => fault === 'query-failed' ? error.message === 'owned native recovery transport…`; `assert.deepEqual(f.events, ['recover-original'])`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('SSH stop preserves the bridge and service when recovering an issued ticket fails or its build disagrees with the saved endpoint', async () => {
  for (const fault of ['query-failed', 'changed-build'] as const) {
    const f = await sshCleanupFixture(true, fault);
    try {
      await assert.rejects(f.service.stop(f.id), (error: any) =>
        fault === 'query-failed'
          ? error.message === 'owned native recovery transport failed'
          : error.code === 'PROJECT_SSH_CLEANUP_FAILED',
      );
      assert.deepEqual(f.events, ['recover-original']);
    } finally {
      await f.service.close();
    }
  }
});

/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: stored: boolean; fault: 'query-failed' | 'changed-build'。
 * 结果：返回受控对象，公开字段包括 `id, events, service`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `id, events, service`; the actual branch determines its shape.
 * 状态影响 / State effects: `(service as any).bridges.stop`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `randomUUID`, `projectSchema.parse`, `account`, `sha`.
 */
async function sshCleanupFixture(stored: boolean, fault?: 'query-failed' | 'changed-build') {
  const id = randomUUID(),
    bootId = randomUUID(),
    runId = randomUUID(),
    instance = {},
    events: string[] = [];
  const project = {
    ...projectSchema.parse({ directory: '/workspace/ssh-stop', networkIsolation: 'private' }),
    _workspace: projectId,
  };
  const identity = account(project),
    snapshotSha256 = sha('owned-ssh-snapshot');
  const run = projectIdentityRunSchema.parse({
    version: 1,
    phase: 'active',
    mode: 'inherit-current',
    registryId: identity.registryId,
    identityId: identity.identityId,
    revision: identity.revision,
    projectId,
    runId,
    bootId,
    build: 'a'.repeat(64),
    cgroupName: 'openrc.sakura-ssh-' + projectId,
    cgroupDevice: '51',
    cgroupInode: '91579',
    networkDevice: '52',
    networkInode: '79159',
    namespace: 'sk-' + projectId,
  });
  const entry = {
    runId,
    owner: { kind: 'ssh' as const, bootId, runId, cgroupName: run.cgroupName },
    identity,
    sha256: snapshotSha256,
    phase: 'intent' as const,
    run: null,
  };
  if (stored) {
    const folder = join(vmDir(id), 'project-ssh', projectId);
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'runtime.json'),
      JSON.stringify(
        projectSshRecordSchema.parse({
          ...basic,
          runId,
          binding: projectSshBinding(project),
          manager: 'openrc',
          files: {
            ...common,
            [p.config + '/session.json']: snapshotSha256,
            [p.openrcPath]: sha('openrc'),
            [p.config + '/launch.py']: sha('launcher'),
          },
          execution: { identity, bootId, build: run.build, snapshotSha256 },
        }),
      ),
    );
  }
  const machines = Object.assign(new EventEmitter(), {
    live: new Map([[id, instance]]),
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, distro: 'alpine' })`）。
     * Result: Return the branch-computed value (`({ id, distro: 'alpine' })`).
     */
    get: () => ({ id, distro: 'alpine' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: _id: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `action`.
     */
    locked: async (_id: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => action(),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 失败 / Failure: `new Error('unexpected SSH cleanup command')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `command.startsWith`, `command.includes`, `assert.ok`, `events.includes`.
     * 检查边界 / Checked boundaries: `assert.ok(events.includes('recover-original'))`; `assert.ok(command.includes(run.cgroupInode), 'the stop must pin the recovered inode')`.
     */
    exec: async (_id: string, command: string) => {
      if (command === 'cat /proc/sys/kernel/random/boot_id') return { code: 0, stdout: bootId, stderr: '' };
      if (
        command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK') ||
        command.includes('sakura_rollback_owner=$(')
      ) {
        assert.ok(events.includes('recover-original'));
        assert.ok(command.includes(run.cgroupInode), 'the stop must pin the recovered inode');
        assert.ok(command.includes(run.cgroupDevice), 'the stop must pin the recovered device');
        assert.ok(command.indexOf('cgroupInode') < command.indexOf('binding.get'));
        events.push(
          command.startsWith('# SAKURA_PROJECT_SSH_ROLLBACK_CHECK') ? 'verify-original' : 'stop-original',
        );
        return { code: 0, stdout: command.startsWith('#') ? 'SAKURA_PROJECT_SSH_OWNED\n' : '', stderr: '' };
      }
      throw new Error('unexpected SSH cleanup command');
    },
  }) as unknown as Machines;
  const spaces = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   */
  config: async () => project } as unknown as Workspaces;
  const service = new ProjectSsh(machines, spaces, {
    scopes: {
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回列表形式的受控数据，供调用者遍历或比较。
       * Result: Return controlled data as a list for iteration or comparison.
       */
      sshRuns: async () => [entry],
      /**
       * 中文功能：控制异步完成或观察时序，使用例能够安排并发、取消或清理阶段。
       * English: Control asynchronous completion or observation timing so the test can arrange concurrency, cancellation or cleanup phases.
       * 输入 / Inputs: 无 / none。
       * 结果：返回受控对象，公开字段包括 `run, phase`；各分支以实际返回对象为准。
       * Result: Return a controlled object exposing fields such as `run, phase`; the actual branch determines its shape.
       * 失败 / Failure: `new Error('owned native recovery transport failed')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       * 协作入口 / Collaborators: `events.push`, `'b'.repeat`.
       */
      recoverSshTicket: async () => {
        events.push('recover-original');
        if (fault === 'query-failed') throw new Error('owned native recovery transport failed');
        return {
          ...entry,
          run: fault === 'changed-build' ? { ...run, build: 'b'.repeat(64) } : run,
          phase: 'active' as const,
        };
      },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 协作入口 / Collaborators: `assert.ok`, `events.includes`, `events.push`.
       * 检查边界 / Checked boundaries: `assert.ok(events.includes('stop-original'))`.
       */
      closeAfterScopeStopped: async () => {
        assert.ok(events.includes('stop-original'));
        events.push('close-ticket');
      },
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 失败 / Failure: `new Error('cleanup must not admit')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      beginSsh: async () => {
        throw new Error('cleanup must not admit');
      },
      /**
       * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
       * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 失败 / Failure: `new Error('cleanup must not activate')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      activateSsh: async () => {
        throw new Error('cleanup must not activate');
      },
      /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 失败 / Failure: `new Error('cleanup must not authorize a session')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
       */
      sshRun: async () => {
        throw new Error('cleanup must not authorize a session');
      },
    },
  });
  (service as any).bridges.stop = /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `events.push`.
   */
  async () => {
    events.push('close-bridge');
  };
  return { id, events, service };
}
