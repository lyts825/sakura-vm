/**
 * 模块职责：回归验证模块，围绕 `project-directory-migration` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `project-directory-migration`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: allowlist excludes root, system folders, parent traversals and ambiguous paths; GET only reads saved host view, with no account reservation, source install or SSH.
 */
import { projectMetadataFile } from '../server/project-catalog.ts';
import { setVmStorageRoot } from '../server/paths.ts';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import type { Workspaces } from '../server/workspaces.ts';
import { projectSchema } from '../server/workspaces.ts';
import { projectIdentitySchema, projectIdentityAssetNames } from '../server/project-identity.ts';
import { AppError } from '../server/model.ts';
import { ProjectTerminals, assertProjectTerminalsStopped } from '../server/project-terminals.ts';
import {
  ProjectDirectoryMigrations,
  migrationDirectoryAllowed,
  migrationPlanDigest,
  directoryMigrationPlanSchema,
  directoryMigrationApplySchema,
  assertNoPendingProjectDirectoryMigration,
} from '../server/project-directory-migration.ts';

const parent = resolve('.data/project-directory-migration-unit-tests');
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, 'sakura-directory-migration-'));
const source = join(root, 'sources');
await mkdir(source);
const aggregate = createHash('sha256'),
  files: { name: string; size: number; sha256: string }[] = [];
for (const name of projectIdentityAssetNames) {
  const data = await readFile(resolve('native/project-identity', name));
  aggregate.update(name).update(data);
  await writeFile(join(source, name), data);
  files.push({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const build = aggregate.digest('hex');
await writeFile(join(source, 'manifest.json'), JSON.stringify({ version: 1, build, files }));
after(async () => {
  const owned = await realpath(root);
  assert.equal(dirname(owned), await realpath(parent));
  assert.match(basename(owned), /^sakura-directory-migration-/);
  await rm(owned, { recursive: true, force: true });
});
/**
 * 中文功能：创建独立宿主目录与项目配置，装配目录迁移服务及可切换故障的身份、传输和门闩适配器。
 * English: Create an isolated host directory and project configuration, then assemble directory migration with controllable identity, transport and latch adapters.
 * 输入 / Inputs: 无 / none。
 * 结果：返回受控对象，公开字段包括 `service, machines, workspaces, vmId, commands, requests, events, counts, removeSavedConfig`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `service, machines, workspaces, vmId, commands, requests, events, counts, removeSavedConfig`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `randomUUID`, `projectSchema.parse`.
 * 设计思路：将配置变更、目录重叠、忙碌、陈旧身份和客户机失联分开注入；公开计数和事件用于核对拒绝发生在资源预留或上传之前，测试注册的清理负责回收临时状态。
 * Design: Inject configuration drift, directory overlap, busy/stale authority and guest loss independently. Counters/events establish whether rejection preceded reservation or upload; registered test cleanup owns temporary state.
 */
async function fixture() {
  const directory = await mkdtemp(join(root, 'host-')),
    vmId = randomUUID(),
    identityId = randomUUID();
  let project = projectSchema.parse({ directory: '/srv/projects/alpha', networkIsolation: 'private' });
  setVmStorageRoot(vmId, directory);
  const configFile = projectMetadataFile(vmId, 'default');
  await mkdir(dirname(configFile), { recursive: true });
  await writeFile(configFile, JSON.stringify(project));
  let identity = projectIdentitySchema.parse({
    version: 1,
    phase: 'intent',
    registryId: randomUUID(),
    projectId: 'default',
    identityId,
    revision: 1,
    uid: 20000,
    gid: 20000,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24),
    home: '/var/lib/sakura-project-homes/' + identityId,
    homeDevice: '2049',
    homeInode: '800',
    directory: project.directory,
    directoryDevice: '2049',
    directoryInode: '900',
    networkIsolation: 'private',
  });
  const commands: string[] = [],
    requests: any[] = [],
    events: string[] = [];
  let reserved = 0,
    uploads = 0,
    busy = false,
    stale = false,
    hostGuard = false,
    lost = false,
    lostConfirm = false,
    guestPlan: any = null;
  let otherDirectory: string | null = null,
    latch: unknown = null;
  const live = { status: 'running' },
    running = new Map([[vmId, live]]);
  /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: result: unknown。
   * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result }) })`）。
   * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result }) })`).
   * 协作入口 / Collaborators: `JSON.stringify`.
   */
  const reply = (result: unknown) => ({ code: 0, stderr: '', stdout: JSON.stringify({ ok: true, result }) });
  const machines = {
    /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id: vmId, distro: 'debian' })`）。
     * Result: Return the branch-computed value (`({ id: vmId, distro: 'debian' })`).
     */
    get: () => ({ id: vmId, distro: 'debian' }),
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`'running'`）。
     * Result: Return the branch-computed value (`'running'`).
     */
    state: () => 'running',
    live: running,
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: key: string; action: () => Promise<unknown>。
     * 结果：返回分支计算值（`action()`），以 Promise 交付。
     * Result: Return the branch-computed value (`action()`) through a Promise.
     * 协作入口 / Collaborators: `events.push`, `action`.
     */
    locked: async (key: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => {
      events.push('lock:' + key);
      return action();
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    writeGuestFile: async () => {
      ++uploads;
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stderr, stdout`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stderr, stdout`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.includes`, `reply`, `randomUUID`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      if (command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS'))
        return { code: 0, stderr: '', stdout: busy ? 'unmanaged\n' : 'absent\n' };
      if (command.includes("/controller.py' '"))
        return reply({ version: 1, build, registryId: identity.registryId, bootId: randomUUID() });
      if (command.includes('project-directory-migrations'))
        return { code: 0, stderr: '', stdout: JSON.stringify(latch) };
      return { code: 0, stderr: '', stdout: '' };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string; bytes: Buffer。
     * 结果：返回分支计算值（`reply(guestPlan)`），以 Promise 交付。
     * Result: Return the branch-computed value (`reply(guestPlan)`) through a Promise.
     * 状态影响 / State effects: `guestPlan`, `guestPlan.proposal.identity.uid`, `guestPlan.proposal.identity.gid`, `guestPlan.sha256`, `guestPlan.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new Error('Owned apply ACK lost.')`; `Object.assign(new Error('Owned final confirm ACK lost.'), { migrationDetail: { code: 'CONTROL_UNCONF…`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `commands.push`, `JSON.parse`, `bytes.toString`, `requests.push`.
     * 检查边界 / Checked boundaries: `assert.equal(request.build, build)`; `assert.ok(command.includes('os.O_NOFOLLOW'))`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    execInput: async (_id: string, command: string, bytes: Buffer) => {
      commands.push(command);
      const request = JSON.parse(bytes.toString());
      requests.push(request);
      assert.equal(request.build, build);
      assert.ok(command.includes('os.O_NOFOLLOW'));
      assert.equal(request.identity.uid, identity.uid);
      assert.equal(request.controllerSha256, files[2].sha256);
      if (request.action === 'preview') {
        const entry = {
          path: '.',
          kind: 'directory',
          device: '2049',
          inode: '900',
          mountId: '25',
          filesystemId: '82',
          uid: 0,
          gid: 0,
          mode: 0o700,
          links: 2,
          size: 4096,
          mtimeNs: '10',
          ctimeNs: '11',
          sha256: null,
          targetMode: 0o700,
        };
        const proposal = {
          version: 1,
          planId: randomUUID(),
          createdAt: new Date().toISOString(),
          vmId,
          projectId: 'default',
          bootId: randomUUID(),
          identity: { ...identity },
          directory: project.directory,
          networkIsolation: 'private',
          configSha256: request.configSha256,
          projectsSha256: request.projectsSha256,
          policy: 'private-owner-v1',
          entries: [entry],
          summary: { files: 0, directories: 1, bytes: 0 },
        };
        guestPlan = {
          version: 1,
          proposal,
          sha256: migrationPlanDigest(proposal),
          state: 'preview',
          completed: [],
          attempt: null,
          lastError: null,
          activatedIdentity: null,
        };
        if (stale) {
          guestPlan.proposal.identity.uid = guestPlan.proposal.identity.gid = 20001;
          guestPlan.sha256 = migrationPlanDigest(guestPlan.proposal);
        }
      } else if (request.action === 'apply') {
        guestPlan.state = 'directory-applied';
        guestPlan.completed = ['.'];
        if (lost) {
          lost = false;
          throw new Error('Owned apply ACK lost.');
        }
      } else if (request.action === 'confirm') {
        guestPlan.state = 'applied';
        guestPlan.activatedIdentity = { ...identity };
        if (lostConfirm) {
          lostConfirm = false;
          throw Object.assign(new Error('Owned final confirm ACK lost.'), {
            migrationDetail: { code: 'CONTROL_UNCONFIRMED', plan: structuredClone(guestPlan) },
          });
        }
      }
      return reply(guestPlan);
    },
  };
  const workspaces = {
    jobs: { /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回列表形式的受控数据，供调用者遍历或比较。
     * Result: Return controlled data as a list for iteration or comparison.
     */
    list: () => [] },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`() => {}`）。
     * Result: Return the branch-computed value (`() => {}`).
     */
    beforeConfigChange: () => () => {},
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
       * 结果：返回分支计算值（`'default'`）。
       * Result: Return the branch-computed value (`'default'`).
       */
      current: () => 'default',
      /**
       * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
       * English: Read or resolve observable fixture state for business calls or subsequent assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ projects: [{ id: 'default' }, ...(otherDirectory ? [{ id: 'aaaaaaaaaaaaaaaa' …`），以 Promise 交付。
       * Result: Return the branch-computed value (`({ projects: [{ id: 'default' }, ...(otherDirectory ? [{ id: 'aaaaaaaaaaaaaaaa' …`) through a Promise.
       */
      list: async () => ({
        projects: [{ id: 'default' }, ...(otherDirectory ? [{ id: 'aaaaaaaaaaaaaaaa' }] : [])],
      }),
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _vm: string; id: string; action: () => Promise<unknown>。
       * 结果：返回分支计算值（`id === 'default' ? action() : projectSchema.parse({ directory: otherDirectory! }…`），以 Promise 交付。
       * Result: Return the branch-computed value (`id === 'default' ? action() : projectSchema.parse({ directory: otherDirectory! }…`) through a Promise.
       * 协作入口 / Collaborators: `action`, `projectSchema.parse`.
       */
      inScope: async (_vm: string, id: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => Promise<unknown>) =>
        id === 'default' ? action() : projectSchema.parse({ directory: otherDirectory! }),
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: _vm: string; _id: string; action: () => Promise<unknown>。
       * 结果：返回分支计算值（`action()`），以 Promise 交付。
       * Result: Return the branch-computed value (`action()`) through a Promise.
       * 协作入口 / Collaborators: `action`.
       */
      with: async (_vm: string, _id: string, action: /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
       * Result: The declared return type defines the result; its test provider supplies the implementation.
       */
      () => Promise<unknown>) => action(),
    },
  };
  const scopes = {
    /**
     * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
     * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
     * 输入 / Inputs: _id: string; projectId: string; action: (access: any) => Promise<unknown>。
     * 结果：返回分支计算值（`action({ recoverStoppedTasks: async () => { events.push('recover-stopped-tasks')…`），以 Promise 交付。
     * Result: Return the branch-computed value (`action({ recoverStoppedTasks: async () => { events.push('recover-stopped-tasks')…`) through a Promise.
     * 协作入口 / Collaborators: `assert.ok`, `events.some`, `events.push`, `action`.
     * 检查边界 / Checked boundaries: `assert.ok(events.some((value) => value === 'lock:' + vmId))`.
     */
    withLock: async (_id: string, projectId: string, action: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: access: any。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    (access: any) => Promise<unknown>) => {
      assert.ok(events.some((value) => value === 'lock:' + vmId));
      events.push('identity-lock:' + projectId);
      return action({
        /**
         * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
         * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 协作入口 / Collaborators: `events.push`.
         */
        recoverStoppedTasks: async () => {
          events.push('recover-stopped-tasks');
        },
        /**
         * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
         * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         * 失败 / Failure: `new AppError('Owned active journal.', 409, 'PROJECT_IDENTITY_RUNS_MUST_STOP')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
         * 协作入口 / Collaborators: `events.push`.
         */
        guard: async () => {
          events.push('host-run-guard');
          if (hostGuard) throw new AppError('Owned active journal.', 409, 'PROJECT_IDENTITY_RUNS_MUST_STOP');
        },
        /**
         * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
         * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`identity`），以 Promise 交付。
         * Result: Return the branch-computed value (`identity`) through a Promise.
         * 协作入口 / Collaborators: `events.push`.
         */
        reserve: async () => {
          events.push('reserve-fixed-account');
          ++reserved;
          return identity;
        },
        /**
         * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
         * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
         * 输入 / Inputs: 无 / none。
         * 结果：返回分支计算值（`identity`），以 Promise 交付。
         * Result: Return the branch-computed value (`identity`) through a Promise.
         * 状态影响 / State effects: `identity`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
         */
        identity: async () => {
          identity = { ...identity, phase: 'active' };
          return identity;
        },
      });
    },
  };
  const service = new ProjectDirectoryMigrations(
    machines as unknown as Machines,
    workspaces as unknown as Workspaces,
    { scopes: scopes as any, sourceDirectory: source, rootDirectory: directory },
  );
  return {
    service,
    machines,
    workspaces,
    vmId,
    commands,
    requests,
    events,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ reserved, uploads })`）。
     * Result: Return the branch-computed value (`({ reserved, uploads })`).
     */
    counts: () => ({ reserved, uploads }),
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 协作入口 / Collaborators: `rm`.
     */
    removeSavedConfig: async () => {
      await rm(configFile);
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: string。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `busy`, `stale`, `hostGuard`, `lost`, `lostConfirm`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    set: (value: string) => {
      busy = value === 'busy';
      stale = value === 'stale';
      hostGuard = value === 'host-guard';
      lost = value === 'lost';
      lostConfirm = value === 'lost-confirm';
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `project`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    changeConfig: () => {
      project = { ...project, command: 'new-command' };
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `otherDirectory`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    overlap: () => {
      otherDirectory = '/srv/projects';
    },
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: unknown。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `latch`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    setLatch: (value: unknown) => {
      latch = value;
    },
  };
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: allowlist excludes root, system folders, parent traversals and ambiguous paths
 * 协作入口 / Collaborators: `assert.equal`, `migrationDirectoryAllowed`.
 * 检查边界 / Checked boundaries: `assert.equal(migrationDirectoryAllowed(directory), false, directory)`; `assert.equal(migrationDirectoryAllowed(directory), true, directory)`.
 */
test('allowlist excludes root, system folders, parent traversals and ambiguous paths', () => {
  for (const directory of [
    '/root',
    '/root/project',
    '/',
    '/srv',
    '/opt/projects',
    '/workspace/a/../b',
    '/workspace/a//b',
    '/workspace/a\0b',
  ])
    assert.equal(migrationDirectoryAllowed(directory), false, directory);
  for (const directory of ['/workspace', '/workspace/a', '/srv/projects/a', '/opt/projects/a'])
    assert.equal(migrationDirectoryAllowed(directory), true, directory);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: GET only reads saved host view, with no account reservation, source install or SSH
 * 协作入口 / Collaborators: `fixture`, `f.service.view`, `assert.equal`, `assert.deepEqual`.
 * 检查边界 / Checked boundaries: `assert.equal(view.plan, null)`; `assert.equal(f.commands.length, 0)`.
 */
test('GET only reads saved host view, with no account reservation, source install or SSH', async () => {
  const f = await fixture();
  const view = await f.service.view(f.vmId);
  assert.equal(view.plan, null);
  assert.equal(f.commands.length, 0);
  assert.deepEqual(f.counts(), { reserved: 0, uploads: 0 });
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: unsaved project preview refuses before account reservation and SSH
 * 协作入口 / Collaborators: `fixture`, `f.removeSavedConfig`, `assert.rejects`, `f.service.preview`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_CONFIG_NOT_SAVED' })`; `assert.deepEqual(f.counts(), { reserved: 0, uploads: 0 })`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('unsaved project preview refuses before account reservation and SSH', async () => {
  const f = await fixture();
  await f.removeSavedConfig();
  await assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_CONFIG_NOT_SAVED' });
  assert.deepEqual(f.counts(), { reserved: 0, uploads: 0 });
  assert.equal(f.commands.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: POST preview pins complete identity and bounded inert data under VM then identity locks
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `assert.equal`, `f.counts`.
 * 检查边界 / Checked boundaries: `assert.equal(view.plan?.state, 'preview')`; `assert.equal(f.counts().reserved, 1)`.
 */
test('POST preview pins complete identity and bounded inert data under VM then identity locks', async () => {
  const f = await fixture();
  const view = await f.service.preview(f.vmId);
  assert.equal(view.plan?.state, 'preview');
  assert.equal(f.counts().reserved, 1);
  assert.deepEqual(f.events.slice(0, 2), ['lock:' + f.vmId, 'identity-lock:default']);
  assert.deepEqual(f.events.slice(2, 5), [
    'reserve-fixed-account',
    'recover-stopped-tasks',
    'host-run-guard',
  ]);
  assert.equal(f.requests[0].identity.phase, 'intent');
  assert.equal(f.requests[0].action, 'preview');
  assert.equal(f.requests[0].projects.length, 1);
  assert.equal(view.plan?.proposal.summary.directories, 1);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: apply requires exact version, explicit review and same cached proposal before reservation
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `assert.equal`, `directoryMigrationApplySchema.safeParse`.
 * 检查边界 / Checked boundaries: `assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, reviewed: false }).success, false)`; `assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, version: 2 }).success, false)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('apply requires exact version, explicit review and same cached proposal before reservation', async () => {
  const f = await fixture();
  const view = await f.service.preview(f.vmId),
    plan = view.plan!;
  const apply = {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  };
  assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, reviewed: false }).success, false);
  assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, version: 2 }).success, false);
  assert.equal(directoryMigrationApplySchema.safeParse({ ...apply, directory: '/root' }).success, false);
  await assert.rejects(f.service.apply(f.vmId, { ...apply, planId: randomUUID() }), {
    code: 'PROJECT_DIRECTORY_PLAN_CHANGED',
  });
  assert.equal(f.counts().reserved, 1);
  f.changeConfig();
  await assert.rejects(f.service.apply(f.vmId, apply), { code: 'PROJECT_DIRECTORY_PLAN_CHANGED' });
  assert.equal(f.counts().reserved, 1);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: active legacy main and open host run journal prevent permission helper entry
 * 协作入口 / Collaborators: `fixture`, `f.set`, `assert.rejects`, `f.service.preview`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.preview(f.vmId), /Owned active journal|全部后代/)`; `assert.equal(f.counts().reserved, mode === 'host-guard' ? 1 : 0)`.
 */
test('active legacy main and open host run journal prevent permission helper entry', async () => {
  for (const mode of ['busy', 'host-guard']) {
    const f = await fixture();
    f.set(mode);
    await assert.rejects(f.service.preview(f.vmId), /Owned active journal|全部后代/);
    assert.equal(f.counts().reserved, mode === 'host-guard' ? 1 : 0);
    assert.equal(f.requests.length, 0);
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: overlapping saved project is actionable and never reaches permission helper
 * 协作入口 / Collaborators: `fixture`, `f.overlap`, `assert.rejects`, `f.service.preview`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.preview(f.vmId), /独立目录/)`; `assert.equal(f.requests.length, 0)`.
 */
test('overlapping saved project is actionable and never reaches permission helper', async () => {
  const f = await fixture();
  f.overlap();
  await assert.rejects(f.service.preview(f.vmId), /独立目录/);
  assert.equal(f.requests.length, 0);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a valid-looking guest reply cannot choose a different UID/GID from pinned account
 * 协作入口 / Collaborators: `fixture`, `f.set`, `assert.rejects`, `f.service.preview`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_CONTROL_FAILED' })`; `assert.equal((await f.service.view(f.vmId)).plan, null)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('a valid-looking guest reply cannot choose a different UID/GID from pinned account', async () => {
  const f = await fixture();
  f.set('stale');
  await assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_CONTROL_FAILED' });
  assert.equal((await f.service.view(f.vmId)).plan, null);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: apply finalizes full directory receipt only after active identity and rechecked confirm
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `f.service.apply`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(result.plan?.state, 'applied')`; `assert.equal(result.plan?.activatedIdentity?.phase, 'active')`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('apply finalizes full directory receipt only after active identity and rechecked confirm', async () => {
  const f = await fixture(),
    preview = await f.service.preview(f.vmId),
    plan = preview.plan!;
  const result = await f.service.apply(f.vmId, {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  });
  assert.equal(result.plan?.state, 'applied');
  assert.equal(result.plan?.activatedIdentity?.phase, 'active');
  assert.deepEqual(
    f.requests.map((value) => value.action),
    ['preview', 'apply', 'confirm'],
  );
  assert.equal(result.plan?.sha256, plan.sha256);
  assert.equal(
    directoryMigrationPlanSchema.safeParse({ ...result.plan, sha256: '0'.repeat(64) }).success,
    false,
  );
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost apply ACK preserves original plan and permits explicit same-plan recovery
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `f.set`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.apply(f.vmId, input), /ACK lost/)`; `assert.equal(failed.plan?.sha256, plan.sha256)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost apply ACK preserves original plan and permits explicit same-plan recovery', async () => {
  const f = await fixture(),
    preview = await f.service.preview(f.vmId),
    plan = preview.plan!;
  const input = {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  };
  f.set('lost');
  await assert.rejects(f.service.apply(f.vmId, input), /ACK lost/);
  const failed = await f.service.view(f.vmId);
  assert.equal(failed.plan?.sha256, plan.sha256);
  assert.ok(failed.lastFailure);
  const retried = await f.service.apply(f.vmId, input);
  assert.equal(retried.plan?.state, 'applied');
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: lost final confirm remains visibly unconfirmed and supports explicit same-plan retry
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `f.set`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(f.service.apply(f.vmId, input), /Owned final confirm ACK lost/)`; `assert.equal(failed.plan?.sha256, plan.sha256)`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('lost final confirm remains visibly unconfirmed and supports explicit same-plan retry', async () => {
  const f = await fixture(),
    plan = (await f.service.preview(f.vmId)).plan!;
  const input = {
    action: 'apply',
    version: 1,
    planId: plan.proposal.planId,
    sha256: plan.sha256,
    reviewed: true,
  };
  f.set('lost-confirm');
  await assert.rejects(f.service.apply(f.vmId, input), /Owned final confirm ACK lost/);
  const failed = await f.service.view(f.vmId);
  assert.equal(failed.plan?.sha256, plan.sha256);
  assert.equal(failed.plan?.state, 'applied');
  assert.ok(failed.lastFailure);
  const recovered = await f.service.apply(f.vmId, input);
  assert.equal(recovered.plan?.state, 'applied');
  assert.equal(recovered.lastFailure, null);
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: prepared task lease blocks preview and apply before any account or guest work
 * 状态影响 / State effects: `lease`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `terminals.prepare`, `f.counts`.
 * 检查边界 / Checked boundaries: `assert.throws(() => assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'default'), { code: 'PROJECT_DIRECTOR…`; `assert.doesNotThrow(() => assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'aaaaaaaaaaaaaaaa'), )`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('prepared task lease blocks preview and apply before any account or guest work', async () => {
  const f = await fixture(),
    plan = (await f.service.preview(f.vmId)).plan!,
    terminals = new ProjectTerminals(
      f.machines as unknown as Machines,
      f.workspaces as unknown as Workspaces,
    ),
    peer = new ProjectTerminals(f.machines as unknown as Machines, f.workspaces as unknown as Workspaces),
    abort = new AbortController();
  let lease: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
  try {
    lease = await terminals.prepare(f.vmId, 'default', null, false, abort.signal, undefined, { mode: 'task' });
    const before = { counts: f.counts(), commands: f.commands.length, requests: f.requests.length };
    await peer.close();
    assert.throws(() => assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'default'), {
      code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP',
    });
    assert.doesNotThrow(() =>
      assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'aaaaaaaaaaaaaaaa'),
    );
    await assert.rejects(f.service.preview(f.vmId), { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' });
    await assert.rejects(
      f.service.apply(f.vmId, {
        action: 'apply',
        version: 1,
        planId: plan.proposal.planId,
        sha256: plan.sha256,
        reviewed: true,
      }),
      { code: 'PROJECT_DIRECTORY_RUNS_MUST_STOP' },
    );
    assert.deepEqual(
      { counts: f.counts(), commands: f.commands.length, requests: f.requests.length },
      before,
    );
    abort.abort();
    await lease.release();
    assert.doesNotThrow(() =>
      assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'default'),
    );
    const result = await f.service.apply(f.vmId, {
      action: 'apply',
      version: 1,
      planId: plan.proposal.planId,
      sha256: plan.sha256,
      reviewed: true,
    });
    assert.equal(result.plan?.state, 'applied');
  } finally {
    abort.abort();
    await lease?.release();
    await terminals.close();
    await peer.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: all pending latch phases block normal and readonly terminal preparation before root tools
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `f.setLatch`, `assert.rejects`.
 * 检查边界 / Checked boundaries: `assert.rejects(terminals.prepare(f.vmId, 'default', null), { code: 'PROJECT_DIRECTORY_MIGRATION_PENDING', })`; `assert.rejects(terminals.prepare(f.vmId, 'default', 'owned', true, undefined, randomUUID()), { code: 'PROJECT_DIRECTORY_MIGRATION_…`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('all pending latch phases block normal and readonly terminal preparation before root tools', async () => {
  const f = await fixture(),
    plan = (await f.service.preview(f.vmId)).plan!,
    terminals = new ProjectTerminals(
      f.machines as unknown as Machines,
      f.workspaces as unknown as Workspaces,
    );
  try {
    for (const phase of ['applying', 'failed', 'directory-applied']) {
      f.setLatch({
        version: 1,
        projectId: 'default',
        planId: plan.proposal.planId,
        sha256: plan.sha256,
        phase,
        identity: plan.proposal.identity,
      });
      const before = f.commands.length;
      await assert.rejects(terminals.prepare(f.vmId, 'default', null), {
        code: 'PROJECT_DIRECTORY_MIGRATION_PENDING',
      });
      await assert.rejects(terminals.prepare(f.vmId, 'default', 'owned', true, undefined, randomUUID()), {
        code: 'PROJECT_DIRECTORY_MIGRATION_PENDING',
      });
      assert.equal(f.commands.length, before + 2);
      for (const command of f.commands.slice(before)) {
        assert.ok(command.includes('project-directory-migrations'));
        assert.doesNotMatch(command, /apk add|apt-get|mkdir -p|tmux new|ip netns/);
      }
      assert.doesNotThrow(() =>
        assertProjectTerminalsStopped(f.machines as unknown as Machines, f.vmId, 'default'),
      );
    }
  } finally {
    await terminals.close();
  }
});
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: early latch guard fails closed on unknown/malformed state and blocks pending phases
 * 协作入口 / Collaborators: `fixture`, `f.service.preview`, `assert.rejects`, `assertNoPendingProjectDirectoryMigration`.
 * 检查边界 / Checked boundaries: `assert.rejects( assertNoPendingProjectDirectoryMigration(transport, f.vmId, 'default'), phase === 'unknown' ? { code: 'PROJECT_DIR…`; `assert.rejects( assertNoPendingProjectDirectoryMigration( { exec: async () => ({ code: 1, stderr: '', stdout: '' }) }, f.vmId, 'de…`.
 * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
 * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
 */
test('early latch guard fails closed on unknown/malformed state and blocks pending phases', async () => {
  const f = await fixture(),
    preview = await f.service.preview(f.vmId),
    plan = preview.plan!;
  for (const phase of ['applying', 'failed', 'directory-applied', 'unknown']) {
    const latch = {
      version: 1,
      projectId: 'default',
      planId: plan.proposal.planId,
      sha256: plan.sha256,
      phase,
      identity: plan.proposal.identity,
    };
    const transport = { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: JSON.stringify(latch) })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: JSON.stringify(latch) })`) through a Promise.
     * 验证场景 / Scenario: early latch guard fails closed on unknown/malformed state and blocks pending phases
     * 协作入口 / Collaborators: `JSON.stringify`.
     */
    exec: async () => ({ code: 0, stderr: '', stdout: JSON.stringify(latch) }) };
    await assert.rejects(
      assertNoPendingProjectDirectoryMigration(transport, f.vmId, 'default'),
      phase === 'unknown'
        ? { code: 'PROJECT_DIRECTORY_LATCH_CHANGED' }
        : { code: 'PROJECT_DIRECTORY_MIGRATION_PENDING' },
    );
  }
  await assertNoPendingProjectDirectoryMigration(
    { /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ code: 0, stderr: '', stdout: 'null' })`），以 Promise 交付。
     * Result: Return the branch-computed value (`({ code: 0, stderr: '', stdout: 'null' })`) through a Promise.
     * 验证场景 / Scenario: early latch guard fails closed on unknown/malformed state and blocks pending phases
     */
    exec: async () => ({ code: 0, stderr: '', stdout: 'null' }) },
    f.vmId,
    'default',
  );
  await assert.rejects(
    assertNoPendingProjectDirectoryMigration(
      { /**
       * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
       * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ code: 1, stderr: '', stdout: '' })`），以 Promise 交付。
       * Result: Return the branch-computed value (`({ code: 1, stderr: '', stdout: '' })`) through a Promise.
       * 验证场景 / Scenario: early latch guard fails closed on unknown/malformed state and blocks pending phases
       */
      exec: async () => ({ code: 1, stderr: '', stdout: '' }) },
      f.vmId,
      'default',
    ),
    { code: 'PROJECT_DIRECTORY_LATCH_CHANGED' },
  );
});
