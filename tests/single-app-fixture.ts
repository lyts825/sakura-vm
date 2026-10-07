/**
 * 模块职责：共享测试夹具模块，围绕 `single-app-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `single-app-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Machines } from '../server/machines.ts';
import { AppError, setVmStorageRoot } from '../server/model.ts';
import { Workspaces, projectSchema, projectVersion } from '../server/workspaces.ts';
import { projectIdentitySchema, projectIdentityRunSchema, type ProjectIdentityRun } from '../server/project-identity.ts';
import { SingleAppWindows } from '../server/single-app-windows.ts';
import { appIdentity, appReceiptSchema, appOriginHash, type AppReceipt, type AppOrigin } from '../server/single-app-sandbox.ts';

export const APP_BUILD = 'a'.repeat(64), NATIVE_BUILD = 'b'.repeat(64);
/**
 * 中文功能：装配单应用业务服务、项目工作区和受控运行回执，提供启动、故障注入、日志查询与精确收尾能力。
 * English: Assemble single-app services, workspaces and controlled run receipts, exposing launch, fault injection, journal reads and exact final cleanup.
 * 输入 / Inputs: configuration: { exitPollMs?: number } = {}。
 * 结果：返回受控对象，公开字段包括 `root, id, file, bootId, rebootId, live, machines, workspaces, configs`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `root, id, file, bootId, rebootId, live, machines, workspaces, configs`; the actual branch determines its shape.
 * 状态影响 / State effects: `workspaces.config`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `randomUUID`.
 * 设计思路：使用本轮独立目录和启动身份区分旧运行与邻居；最终关闭先取消失败注入，再关闭业务与工作区，复核临时目录归属后删除，避免失败测试影响后续用例。
 * Design: A private directory and boot identity distinguish old runs from neighbors. Final close disables injected faults, closes business/workspace services, and verifies temporary-directory ownership before deletion so failing tests do not contaminate later cases.
 */
export async function singleAppFixture(configuration: { exitPollMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sakura-single-app-run-')), id = randomUUID(), bootId = randomUUID(), rebootId = randomUUID();
  setVmStorageRoot(id, root); await mkdir(join(root, id));
  const file = join(root, id, 'single-app-runs.json');
  await writeFile(join(root, id, 'projects.json'), JSON.stringify({ active: 'default', projects: [
    { id: 'default', name: '默认项目' }, { id: '1234567890abcdef', name: '其他项目' }] }));
  const commands: string[] = [], actions: { action: string; id?: string; origin?: AppOrigin; environment?: Record<string, string> }[] = [];
  const faults = { prepareAckLost: false, missingNativeTicket: false, unknownGroup: false, startAckLost: false,
    stopFail: false, stopAckLost: false, endpointChanged: false, stopForeignRun: false, missingDirectory: false, statusExited: false, reboot: false };
  const live = { status: 'running' }, runs = new Map<string, ProjectIdentityRun>(), receipts = new Map<string, AppReceipt>();
  let releases = 0, nextUid = 1100;
  const locks = new Set<string>();
  const machines = Object.assign(new EventEmitter(), {
    records: new Map([[id, { id }]]), live: new Map([[id, live]]), /**
     * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
     * English: Read or resolve observable fixture state for business calls or subsequent assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`({ id, distro: 'alpine', template: 'none' })`）。
     * Result: Return the branch-computed value (`({ id, distro: 'alpine', template: 'none' })`).
     */
    get: () => ({ id, distro: 'alpine', template: 'none' }),
    /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    requireUnlocked: () => {}, /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`live.status`）。
     * Result: Return the branch-computed value (`live.status`).
     */
    state: () => live.status,
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: key: string; task: () => Promise<unknown>。
     * 结果：返回分支计算值（`await task()`），以 Promise 交付。
     * Result: Return the branch-computed value (`await task()`) through a Promise.
     * 失败 / Failure: `new Error('another operation is running')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `locks.has`, `locks.add`, `task`, `locks.delete`.
     * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
     * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
     */
    locked: async (key: string, task: /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
     * Result: The declared return type defines the result; its test provider supplies the implementation.
     */
    () => Promise<unknown>) => {
      if (locks.has(key)) throw new Error('another operation is running');
      locks.add(key); try { return await task(); } finally { locks.delete(key); }
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; command: string。
     * 结果：返回受控对象，公开字段包括 `code, stdout, stderr`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `code, stdout, stderr`; the actual branch determines its shape.
     * 协作入口 / Collaborators: `commands.push`, `command.includes`.
     */
    exec: async (_id: string, command: string) => {
      commands.push(command);
      return { code: 0, stdout: command === 'cat /proc/sys/kernel/random/boot_id' ? (faults.reboot ? rebootId : bootId) + '\n'
        : command.includes('SAKURA_PROJECT_MAIN_LEGACY_STATUS') ? 'absent\n' : '', stderr: '' };
    },
  }) as unknown as Machines;
  const workspaces = new Workspaces(machines), configs = new Map([
    ['default', projectSchema.parse({ directory: '/private/project', networkIsolation: 'private', environment: { LITERAL: '$(never-run)' } })],
    ['1234567890abcdef', projectSchema.parse({ directory: '/other/project', networkIsolation: 'host' })],
  ]);
  workspaces.config = /**
   * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
   * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
   * 输入 / Inputs: vmId。
   * 结果：返回分支计算值（`project`），以 Promise 交付。
   * Result: Return the branch-computed value (`project`) through a Promise.
   * 协作入口 / Collaborators: `workspaces.projects.current`, `structuredClone`, `configs.get`, `Object.defineProperty`.
   */
  async vmId => {
    const scope = workspaces.projects.current(vmId), project = structuredClone(configs.get(scope)!);
    Object.defineProperty(project, '_workspace', { value: scope, enumerable: false });
    return project;
  };
  const registryId = randomUUID(), identities = new Map<string, ReturnType<typeof projectIdentitySchema.parse>>();
  const scopes = { /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: _id: string; project: Awaited<ReturnType<Workspaces['config']>>。
   * 结果：返回分支计算值（`identity`），以 Promise 交付。
   * Result: Return the branch-computed value (`identity`) through a Promise.
   * 状态影响 / State effects: `identity`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `identities.get`, `randomUUID`, `projectIdentitySchema.parse`, `identityId.replaceAll('-', '').slice`.
   */
  identity: async (_id: string, project: Awaited<ReturnType<Workspaces['config']>>) => {
    const scope = project._workspace || 'default';
    let identity = identities.get(scope);
    if (!identity) {
      const identityId = randomUUID();
      identity = projectIdentitySchema.parse({ version: 1, phase: 'active', registryId, projectId: scope, identityId, revision: 1,
        account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 20000 + identities.size, gid: 20000 + identities.size,
        home: '/var/lib/sakura-project-homes/' + identityId, directory: project.directory,
        directoryDevice: '1', directoryInode: '2', homeDevice: '1', homeInode: '3', networkIsolation: project.networkIsolation || 'host' });
      identities.set(scope, identity);
    }
    return identity;
  } };
  const terminals = { /**
   * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
   * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
   * 输入 / Inputs: _id: string; scope: string | null | undefined。
   * 结果：返回受控对象，公开字段包括 `command, terminalId, projectId, networkIsolation, captured, release`；各分支以实际返回对象为准。
   * Result: Return a controlled object exposing fields such as `command, terminalId, projectId, networkIsolation, captured, release`; the actual branch determines its shape.
   * 失败 / Failure: `new AppError('请先显式准备并迁移原目录', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `workspaces.projects.inScope`, `projectVersion`, `machines.live.get`.
   */
  prepare: async (_id: string, scope: string | null | undefined) => {
    if (faults.missingDirectory) throw new AppError('请先显式准备并迁移原目录', 409, 'PROJECT_IDENTITY_DIRECTORY_MISSING');
    const project = await workspaces.projects.inScope(id, scope!, () => workspaces.config(id));
    let released = false;
    return { command: '', terminalId: undefined, projectId: scope!, networkIsolation: project.networkIsolation || 'host',
      captured: { project, configVersion: projectVersion(project), live: machines.live.get(id)! },
      /**
       * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
       * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
       * 输入 / Inputs: 无 / none。
       * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
       * Result: No explicit result value; callers observe completion, state changes or an exception.
       * 状态影响 / State effects: `released`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
       * 协作入口 / Collaborators: `assert.equal`.
       * 检查边界 / Checked boundaries: `assert.equal(released, false, 'preparation lease released twice')`.
       */
      release: () => { assert.equal(released, false, 'preparation lease released twice'); released = true; releases++; } };
  }, /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   */
  close: async () => {} };
  const core = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`NATIVE_BUILD`），以 Promise 交付。
   * Result: Return the branch-computed value (`NATIVE_BUILD`) through a Promise.
   */
  install: async () => NATIVE_BUILD,
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _id: string; identity: ReturnType<typeof projectIdentitySchema.parse>; options: { runId?: string } = {}。
     * 结果：返回分支计算值（`run`），以 Promise 交付。
     * Result: Return the branch-computed value (`run`) through a Promise.
     * 失败 / Failure: `new AppError('native ACK lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`, `assert.ok`, `journal.sessions.some`.
     * 检查边界 / Checked boundaries: `assert.ok(journal.sessions.some((session: { id: string; phase: string; run: unknown }) => session.id === runId && session.phase ==…`.
     */
    prepare: async (_id: string, identity: ReturnType<typeof projectIdentitySchema.parse>, options: { runId?: string } = {}) => {
    const runId = options.runId!;
    const journal = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(journal.sessions.some((session: { id: string; phase: string; run: unknown }) =>
      session.id === runId && session.phase === 'intent' && session.run === null), 'intent must precede native mutation');
    actions.push({ action: 'native-prepare', id: runId });
    const run = projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'independent', registryId: identity.registryId,
      identityId: identity.identityId, projectId: identity.projectId, runId, revision: identity.revision, bootId, build: NATIVE_BUILD,
      networkDevice: '4', networkInode: '5', cgroupDevice: '6', cgroupInode: String(100 + runs.size),
      cgroupName: 'sakura-identity-' + runId, namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
    if (!faults.missingNativeTicket) runs.set(runId, run);
    if (faults.prepareAckLost || faults.missingNativeTicket) throw new AppError('native ACK lost', 502, 'PROJECT_IDENTITY_CONTROL_FAILED');
    return run;
  }, /**
   * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
   * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
   * 输入 / Inputs: _id: string; _identity: unknown; runId: string。
   * 结果：返回分支计算值（`run`），以 Promise 交付。
   * Result: Return the branch-computed value (`run`) through a Promise.
   * 失败 / Failure: `new AppError('missing', 409, 'PROJECT_IDENTITY_RECORD_ABSENT')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
   * 协作入口 / Collaborators: `runs.get`.
   */
  runReadonly: async (_id: string, _identity: unknown, runId: string) => {
    const run = runs.get(runId); if (!run) throw new AppError('missing', 409, 'PROJECT_IDENTITY_RECORD_ABSENT'); return run;
  } };
  const image = { path: '/usr/bin/xterm', command: '/usr/bin/xterm', device: '1', inode: '12', sha256: 'c'.repeat(64) };
  const tool = { ...image, command: image.path };
  const control = { /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`APP_BUILD`），以 Promise 交付。
   * Result: Return the branch-computed value (`APP_BUILD`) through a Promise.
   */
  install: async () => APP_BUILD, /**
   * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
   * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：返回列表形式的受控数据，供调用者遍历或比较。
   * Result: Return controlled data as a list for iteration or comparison.
   */
  legacy: async () => [],
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: vmId: string; _build: string; request: { id: string; identity: ReturnType<typeof projectIdentitySchema.p…。
     * 结果：返回分支计算值（`core.prepare(vmId, request.identity, { runId: request.id })`），以 Promise 交付。
     * Result: Return the branch-computed value (`core.prepare(vmId, request.identity, { runId: request.id })`) through a Promise.
     * 协作入口 / Collaborators: `core.prepare`.
     */
    prepareRun: async (vmId: string, _build: string, request: { id: string; identity: ReturnType<typeof projectIdentitySchema.parse> }) =>
      core.prepare(vmId, request.identity, { runId: request.id }),
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: build: string; origin: AppOrigin。
     * 结果：返回分支计算值（``/fixed/${build}/controller.py stream ${origin.run.runId} ${appOriginHash(origin…`）。
     * Result: Return the branch-computed value (``/fixed/${build}/controller.py stream ${origin.run.runId} ${appOriginHash(origin…`).
     * 协作入口 / Collaborators: `appOriginHash`.
     */
    streamCommand: (build: string, origin: AppOrigin) => `/fixed/${build}/controller.py stream ${origin.run.runId} ${appOriginHash(origin)}`,
    /**
     * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
     * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
     * 输入 / Inputs: _id: string; _build: string; request: { id: string; bootId: string; nativeBuild: string }。
     * 结果：返回分支计算值（`run ? { run, absence: null } : { run: null, absence: { version: 1 as const, id: …`），以 Promise 交付。
     * Result: Return the branch-computed value (`run ? { run, absence: null } : { run: null, absence: { version: 1 as const, id: …`) through a Promise.
     * 失败 / Failure: `new AppError('unknown original cgroup', 503, 'SINGLE_APP_INTENT_CLEANUP_UNCONFIRMED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `actions.push`, `runs.get`.
     */
    recover: async (_id: string, _build: string, request: { id: string; bootId: string; nativeBuild: string }) => {
      actions.push({ action: 'recover', id: request.id });
      if (faults.unknownGroup) throw new AppError('unknown original cgroup', 503, 'SINGLE_APP_INTENT_CLEANUP_UNCONFIRMED');
      const run = runs.get(request.id);
      return run ? { run, absence: null } : { run: null, absence: { version: 1 as const, id: request.id, bootId: request.bootId,
        nativeBuild: request.nativeBuild, currentBootId: bootId, ticketAbsent: true as const, cgroupAbsent: true as const,
        guestReceiptAbsent: true as const, runtimeAbsent: true as const } };
    },
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: _id: string; _build: string; action: 'prepare' | 'start' | 'status' | 'stop'; origin: AppOrigin; environment: Record<string, string>。
     * 结果：返回受控对象，公开字段包括 `receipt, run, retirement, state, bootId, endpoint`；各分支以实际返回对象为准。
     * Result: Return a controlled object exposing fields such as `receipt, run, retirement, state, bootId, endpoint`; the actual branch determines its shape.
     * 状态影响 / State effects: `receipt.state`, `receipt.firewall`, `receipt.retirement`, `faults.stopAckLost`, `receipt.directoryView`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 失败 / Failure: `new AppError('original cleanup unknown', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED')`; `new AppError('stop ACK lost', 503, 'SINGLE_APP_CONTROL_UNCONFIRMED')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
     * 协作入口 / Collaborators: `actions.push`, `appIdentity`, `appReceiptSchema.parse`, `String`.
     * 检查边界 / Checked boundaries: `assert.ok(receipt, 'native guest receipt required')`.
     * 设计思路：根据受控条件分别注入拒绝或结果，保持分支证据可观察，供调用者失败恢复用例复用。
     * Design: Inject rejection or results under controlled conditions while keeping branch evidence observable for caller recovery tests.
     */
    call: async (_id: string, _build: string, action: 'prepare' | 'start' | 'status' | 'stop', origin: AppOrigin,
      environment?: Record<string, string>) => {
      actions.push({ action, id: origin.run.runId, origin, environment });
      const runId = origin.run.runId;
      if (action === 'prepare') {
        const account = appIdentity(runId), uid = nextUid++, display = 10 + receipts.size;
        const receipt = appReceiptSchema.parse({ version: 1, id: runId, build: APP_BUILD, origin, identity: origin.identity, run: origin.run,
          state: 'prepared', uid, gid: uid, user: account.user, home: account.home, homeDevice: '1', homeInode: String(uid),
          runtime: '/run/sakura-single-app-uid/' + runId, runtimeDevice: '7', runtimeInode: String(uid + 1), password: 'Abc/123+',
          display, port: 5900 + display, image, tools: { group: tool, account: tool, ipv4: tool, ipv6: tool,
            vnc: tool, password: tool, wm: tool, probe: tool }, directoryView: null, supervisor: null, endpoint: null,
          processes: null, retirement: null, firewall: 'active' });
        receipts.set(runId, receipt); return structuredClone(receipt);
      }
      const receipt = receipts.get(runId);
      if (action === 'stop') {
        if (faults.stopFail) throw new AppError('original cleanup unknown', 503, 'SINGLE_APP_CLEANUP_UNCONFIRMED');
        const retirement = faults.reboot ? { reason: 'guest-reboot' as const, bootId: rebootId } : null;
        if (receipt) { receipt.state = 'stopped'; receipt.firewall = 'closed'; receipt.retirement = retirement; }
        const closed = { ...origin.run, phase: faults.reboot ? 'active' as const : 'closed' as const };
        runs.set(runId, closed);
        if (faults.stopAckLost) { faults.stopAckLost = false; throw new AppError('stop ACK lost', 503, 'SINGLE_APP_CONTROL_UNCONFIRMED'); }
        return { receipt: receipt ? structuredClone(receipt) : null,
          run: faults.stopForeignRun ? { ...closed, cgroupInode: '999' } : closed, retirement };
      }
      assert.ok(receipt, 'native guest receipt required');
      if (action === 'start') {
        receipt.state = 'running';
        receipt.directoryView = { version: 1, device: '8', inode: String(receipt.uid), directoryDevice: origin.identity.directoryDevice,
          directoryInode: origin.identity.directoryInode, directoryMode: 0o700, mountFlags: 6, projectUid: origin.identity.uid,
          projectGid: origin.identity.gid, uid: receipt.uid, gid: receipt.gid, desktopRunId: runId, bootId: origin.run.bootId, route: null };
        receipt.supervisor = { pid: receipt.uid, created: '10', image: '/usr/bin/python3', device: '1', inode: '99' };
        receipt.endpoint = { pid: receipt.uid + 1, created: '11', image: image.path, device: image.device, inode: image.inode, kernelInode: '55' };
        receipt.processes = { application: { pid: receipt.uid + 2, created: '12', image: image.path, device: '1', inode: '12' },
          wm: { pid: receipt.uid + 3, created: '13', image: image.path, device: '1', inode: '12' } };
        if (faults.startAckLost) throw new AppError('start ACK lost', 503, 'SINGLE_APP_CONTROL_UNCONFIRMED');
        return structuredClone(receipt);
      }
      return { state: faults.statusExited ? 'exited' : receipt.state === 'running' ? 'running' : 'stopped', receipt: structuredClone(receipt), bootId,
        endpoint: faults.endpointChanged ? { ...receipt.endpoint!, created: '99' } : structuredClone(receipt.endpoint) };
    } };
  const options = { terminals, scopes, identities: core, control, /**
   * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
   * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
   * 输入 / Inputs: 无 / none。
   * 结果：返回分支计算值（`NATIVE_BUILD`），以 Promise 交付。
   * Result: Return the branch-computed value (`NATIVE_BUILD`) through a Promise.
   */
  nativeBuild: async () => NATIVE_BUILD,
    exitPollMs: configuration.exitPollMs ?? 60_000 };
  const apps = new SingleAppWindows(machines, workspaces, options);
  return { root, id, file, bootId, rebootId, live, machines, workspaces, configs, apps, options, actions, commands, faults, receipts, runs,
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`releases`）。
     * Result: Return the branch-computed value (`releases`).
     */
    releaseCount: () => releases,
    /**
     * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
     * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`JSON.parse(await readFile(file, 'utf8'))`），以 Promise 交付。
     * Result: Return the branch-computed value (`JSON.parse(await readFile(file, 'utf8'))`) through a Promise.
     * 协作入口 / Collaborators: `JSON.parse`, `readFile`.
     */
    journal: async () => JSON.parse(await readFile(file, 'utf8')),
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `faults.stopFail`, `faults.unknownGroup`, `faults.stopForeignRun`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `apps.close`, `workspaces.close`, `setVmStorageRoot`, `realpath`.
     * 检查边界 / Checked boundaries: `assert.equal(dirname(path), resolve(tmpdir()))`; `assert.ok(basename(path).startsWith('sakura-single-app-run-'))`.
     * 设计思路：按源码中的等待顺序推进受控步骤，测试可在各异步边界安排响应、取消或状态变化。
     * Design: Advance controlled steps in the source await order, allowing responses, cancellation or state changes to be arranged at asynchronous boundaries.
     */
    async close() {
      faults.stopFail = faults.unknownGroup = faults.stopForeignRun = false;
      await apps.close(); await workspaces.close(); setVmStorageRoot(id);
      const path = await realpath(root);
      assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith('sakura-single-app-run-'));
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } };
}
