/**
 * 模块职责：共享测试夹具模块，围绕 `project-protocol-fixture` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Shared test fixture for `project-protocol-fixture`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 */
import { randomUUID } from 'node:crypto';
import { Duplex, PassThrough } from 'node:stream';
import { projectVersion, type Project } from '../server/workspaces.ts';
import { projectIdentitySchema, projectIdentityRunSchema } from '../server/project-identity.ts';
import type { OwnedProjectProtocolStream, ProjectProtocolStreamRecord } from '../server/project-protocol-stream.ts';

/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`pair`）。
 * Result: Return the branch-computed value (`pair`).
 * 协作入口 / Collaborators: `Duplex.from`, `channel.on`.
 */
export function protocolPair() {
  const request = new PassThrough(), response = new PassThrough();
  const pair = [Duplex.from({ readable: response, writable: request }), Duplex.from({ readable: request, writable: response })] as const;
  for (const channel of pair) channel.on('error', () => {}); return pair;
}
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: project: Project。
 * 结果：返回分支计算值（`projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUI…`）。
 * Result: Return the branch-computed value (`projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUI…`).
 * 协作入口 / Collaborators: `randomUUID`, `projectIdentitySchema.parse`, `identityId.replaceAll('-', '').slice`, `identityId.replaceAll`.
 */
export function identityFor(project: Project) {
  const identityId = randomUUID();
  return projectIdentitySchema.parse({ version: 1, phase: 'active', registryId: randomUUID(),
    identityId, projectId: project._workspace || 'default', revision: 1,
    account: 'skp' + identityId.replaceAll('-', '').slice(0, 24), uid: 21000, gid: 21000,
    directory: project.directory, directoryDevice: '1', directoryInode: '2',
    home: '/var/lib/sakura-project-homes/' + identityId, homeDevice: '1', homeInode: '3',
    networkIsolation: project.networkIsolation || 'host' });
}
/**
 * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
 * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
 * 输入 / Inputs: identity: ReturnType<typeof identityFor>; runId = randomUUID(); bootId = randomUUID()。
 * 结果：返回分支计算值（`projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-cur…`）。
 * Result: Return the branch-computed value (`projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-cur…`).
 * 协作入口 / Collaborators: `projectIdentityRunSchema.parse`, `'a'.repeat`.
 */
export function runFor(identity: ReturnType<typeof identityFor>, runId = randomUUID(), bootId = randomUUID()) {
  return projectIdentityRunSchema.parse({ version: 1, phase: 'active', mode: 'inherit-current',
    registryId: identity.registryId, identityId: identity.identityId, revision: identity.revision,
    projectId: identity.projectId, runId, bootId, build: 'a'.repeat(64), networkDevice: '4', networkInode: '5',
    cgroupDevice: '6', cgroupInode: '7', cgroupName: 'sakura-task-' + runId,
    namespace: identity.networkIsolation === 'private' ? 'sk-' + identity.projectId : '' });
}
/**
 * 中文功能：生成或核对本组验证所需的摘要与身份材料。
 * English: Generate or verify digest and identity material required by this suite.
 * 输入 / Inputs: id: string; kind: 'lsp' | 'dap'; project: Project; stream: Duplex; verify: () => Promise<void>; cleanup: () => Promise<void>。
 * 结果：返回分支计算值（`owner`）。
 * Result: Return the branch-computed value (`owner`).
 * 协作入口 / Collaborators: `identityFor`, `runFor`, `randomUUID`, `projectVersion`.
 */
export function mockProtocolOwner(id: string, kind: 'lsp' | 'dap', project: Project, stream: Duplex,
  verify: /**
   * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
   * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<void>, cleanup: /**
   * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
   * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => Promise<void>) {
  const identity = identityFor(project), run = runFor(identity);
  const record: ProjectProtocolStreamRecord = { version: 1, vmId: id, kind,
    projectId: identity.projectId, identity, runId: run.runId, bootId: run.bootId, controlToken: randomUUID(),
    configSha256: projectVersion(project), sha256: 'a'.repeat(64), timeoutMs: 180000, phase: 'active', issued: true, run };
  let resolve!: /**
   * 中文功能：读取或解析本组夹具的可观察状态，供业务调用或后续断言使用。
   * English: Read or resolve observable fixture state for business calls or subsequent assertions.
   * 输入 / Inputs: 无 / none。
   * 结果：由声明的返回类型规定结果；实现责任由测试提供者承担。
   * Result: The declared return type defines the result; its test provider supplies the implementation.
   */
  () => void; const done = new Promise<void>(yes => { resolve = yes; });
  let closed = false;
  const owner: OwnedProjectProtocolStream = { stream, capture: { projectId: identity.projectId, project,
    resolved: project, configSha256: record.configSha256, live: {}, bootId: run.bootId, signal: new AbortController().signal },
    /**
     * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
     * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`structuredClone(record)`）。
     * Result: Return the branch-computed value (`structuredClone(record)`).
     * 协作入口 / Collaborators: `structuredClone`.
     */
    record: () => structuredClone(record), assertCurrent: verify, /**
     * 中文功能：核对测试输入、权威证据或输出条件；具体判定、断言或拒绝方式由函数体规定。
     * English: Check test inputs, authority evidence or output conditions; the body defines its decision, assertion or rejection behavior.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    assertNative: async () => {},
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     */
    detachRequest: () => {}, done, /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `closed`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     * 协作入口 / Collaborators: `cleanup`, `stream.destroy`, `resolve`.
     */
    close: async () => {
      if (closed) return; await cleanup(); closed = true; stream.destroy(); resolve();
    } };
  return owner;
}
