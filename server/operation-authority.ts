/**
 * 模块职责：构造操作授权检查，协调账户会话、锁状态及插件权限的持续有效性。
 * Module purpose: Creates operation authorization checks combining live account, session-lock and plugin authority.
 */
import type { ProjectCatalogV1 } from './service-contracts/v1.ts';
import type { IncomingMessage } from 'node:http';
import { AppError } from '../shared/errors.ts';
import { ProjectCatalog, projectIdSchema } from './project-catalog.ts';
import { vmLifetime } from './vm-lifetime.ts';
import { extensionOrigin, type BrowserExtensions } from './browser-extensions.ts';
import type { AccessControl, Principal } from './access-control.ts';
import type { SessionLock } from './session-lock.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import type { Features } from './features.ts';
import type { ProjectPermissions } from './project-permissions.ts';
import type { OperationEntry } from './operation-catalog.ts';
import type { OperationBinding } from './operation-gateway.ts';

type AuthorityOptions = {
  machines: Machines;
  features: Pick<Features, 'enabled' | 'migration'>;
  access: Pick<AccessControl, 'enabled' | 'authorize'>;
  session: Pick<SessionLock, 'requireUnlocked'>;
  projectPermissions: Pick<ProjectPermissions, 'require' | 'requireCommitted' | 'requiresApproval'>;
  browserExtensions: Pick<BrowserExtensions, 'authorize'>;
  /**
   * 签名 / Signature: AuthorityOptions.equalToken.
   * 功能：为构造操作授权检查声明 equalToken 的输入与结果契约，所属容器为 AuthorityOptions。
   * Purpose: Declares the input/result contract for equalToken in AuthorityOptions. Module responsibility: Creates operation authorization checks combining live account, session-lock and plugin authority.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  equalToken(value: unknown): boolean;
  /**
   * 签名 / Signature: AuthorityOptions.socketAuthorization.
   * 功能：为构造操作授权检查声明 socketAuthorization 的输入与结果契约，所属容器为 AuthorityOptions。
   * Purpose: Declares the input/result contract for socketAuthorization in AuthorityOptions. Module responsibility: Creates operation authorization checks combining live account, session-lock and plugin authority.
   * 输入 / Inputs: credential: string; mode: string; vmId: string; session: string | null optional; project: string | null optional
   * 输出 / Returns: Principal | { role: 'owner' } | null.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  socketAuthorization(credential: string, mode: string, vmId: string, session?: string | null,
    project?: string | null): Principal | { role: 'owner' } | null;
  projects?: Pick<ProjectCatalogV1, 'list' | 'readCommittedList'>;
};

/** 核心与插件请求共用当前授权策略；具体协议的归属证明仍由对应领域处理器核验。 */
/**
 * 入口 / Entry: createOperationAuthority.
 * 功能：为请求固定凭证和目标项目/实例，并返回可重复核对当前许可的授权绑定。
 * Purpose: Pins request credentials and project/VM targets, returning a binding that rechecks current authority.
 * 设计：凭证先于目标元数据，排队和异步读取后复核账户、锁代次、项目成员及运行身份，旧许可不能跨代次续用。
 * Design: Credentials precede target reads; asynchronous waits recheck account/lock/membership/runtime so stale grants cannot survive identity transitions.
 * 输入 / Inputs: options: AuthorityOptions
 * 输出 / Returns: `async (req: IncomingMessage, url: URL, entry: OperationEntry, parameters: Readonly<Record<string, string>>, requireEnabled: (…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function createOperationAuthority(options: AuthorityOptions) {
  const { machines, features, access, session, projectPermissions, browserExtensions,
    equalToken, socketAuthorization } = options;
  const gatewayProjects = options.projects || new ProjectCatalog(machines);
  /**
   * 入口 / Entry: createOperationAuthority.callback@36.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: req: IncomingMessage; url: URL; entry: OperationEntry; parameters: Readonly<Record<string, string>>; requireEnabled: () => void
   * 输出 / Returns: Promise<OperationBinding>；结果来自 / values from `{ input: async (input: unknown) => { if (policy.projectBinding !== 'input-scope') return; projectScoped = (input as { scope?:…`.
   * 副作用 / Effects: 更新 / updates `projectScoped`.
   * 拒绝 / Refusals: 条件 / conditions `principal && !policy.roles.includes(principal.role)`; `projectScoped && principal?.role === 'member' && 'id' in principal && vmId && projectId`; `!features.enabled.has('projects') || !policy.projectPermission`; 异常 / errors `new AppError('账户没有此操作权限', 403)`; `new AppError('未授予项目操作权限', 403)`.
   */
  return async (req: IncomingMessage, url: URL, entry: OperationEntry,
    parameters: Readonly<Record<string, string>>, requireEnabled:
    /**
     * 中文功能：在原操作身份中复核功能仍启用的准入检查。
     * English: Admission check confirming the feature remains enabled under the original operation identity.
     * 所属 / Owner: createOperationAuthority.requireEnabled.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void): Promise<OperationBinding> => {

    const policy = entry.declaration;
    // Credentials and target are captured before the first await. Never re-read a mutable request.
    const credential = req.headers['x-sakura-token'];
    const socketCredential = url.searchParams.get('token') || '';
    const vmId = parameters.vmId;
    const mode = policy.socketChannel || '';
    const terminalSession = url.searchParams.get('session');
    let projectId = url.searchParams.get('project');
    let projectScoped = policy.projectBinding === 'query' || policy.projectBinding === 'legacy-terminal-grant';
    // Pre-project terminal grants name the legacy session without a project; do not reinterpret them.
    if (policy.projectBinding === 'legacy-terminal-grant' && !projectId) projectScoped = false;
    const initialLive = vmId && policy.identity === 'fixed-vm' ? machines.live.get(vmId) : undefined;
    const lifetime = initialLive && vmId ? vmLifetime(vmId, initialLive) : undefined;
    const identity = lifetime?.capture();
    /**
     * 入口 / Entry: createOperationAuthority.authenticate.
     * 功能：在构造操作授权检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `principal` / `access.authorize(credential)` 供上层消费（`operation-authority.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-authority.ts`; this entry produces `principal` / `access.authorize(credential)` for its caller. Module context: Creates operation authorization checks combining live account, session-lock and plugin authority.
     * 处理：通过 `session.requireUnlocked`, `socketAuthorization`, `access.authorize`, `equalToken` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `session.requireUnlocked`, `socketAuthorization`, `access.authorize`, `equalToken`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `policy.session === 'required'`; `access.enabled`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `principal`; `access.authorize(credential)`; `{ role: 'owner' as const }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `policy.access === 'socket'`; `!principal`; `!equalToken(credential)`; 异常 / errors `new AppError('连接授权已撤销', 403)`; `new AppError('访问凭证已过期，请刷新页面', 401)`.
     */
    const authenticate = () => {
      if (policy.session === 'required') session.requireUnlocked();
      if (policy.access === 'socket') {
        const principal = socketAuthorization(socketCredential, mode, vmId || 'events', terminalSession, projectId);
        if (!principal) throw new AppError('连接授权已撤销', 403);
        return principal;
      }
      if (access.enabled) return access.authorize(credential);
      if (!equalToken(credential)) throw new AppError('访问凭证已过期，请刷新页面', 401);
      return { role: 'owner' as const };
    };
    const principal = ['controller', 'socket'].includes(policy.access) ? authenticate() : undefined;
    // Reject before loading project metadata. A GET endpoint still requires its explicit role grant.
    if (principal && !policy.roles.includes(principal.role)) throw new AppError('账户没有此操作权限', 403);
    requireEnabled();
    // Declared non-project plugin handlers validate input before their own VM lookup.
    // Project authority still requires the VM before loading grants or project metadata.
    const deferVmLookup = policy.owner !== 'core' && policy.contract === 'declared' && !projectScoped;
    if (vmId && !deferVmLookup) machines.get(vmId);
    /**
     * 入口 / Entry: createOperationAuthority.bindProject.
     * 功能：在构造操作授权检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`operation-authority.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-authority.ts`; this entry produces `void` for its caller. Module context: Creates operation authorization checks combining live account, session-lock and plugin authority.
     * 处理：通过 `gatewayProjects.list`, `projectIdSchema.parse`, `index.projects.some`, `url.searchParams.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `gatewayProjects.list`, `projectIdSchema.parse`, `index.projects.some`, `url.searchParams.set`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!vmId`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `url.searchParams.set`; 更新 / updates `projectId`.
     * 拒绝 / Refusals: 条件 / conditions `principal?.role === 'member' && !projectId`; `!index.projects.some(project => project.id === projectId)`; 异常 / errors `new AppError('项目成员请求必须指定项目 ID', 400)`; `new AppError('项目不存在', 404)`.
     */
    const bindProject = async () => {
      if (!vmId) return;
      if (principal?.role === 'member' && !projectId) throw new AppError('项目成员请求必须指定项目 ID', 400);
      const index = await gatewayProjects.list(vmId);
      projectId = projectIdSchema.parse(projectId || index.active);
      if (!index.projects.some(project => project.id === projectId)) throw new AppError('项目不存在', 404);
      // 固定本请求项目；之后保存的当前项目变化不能把原操作转到另一个项目。
      url.searchParams.set('project', projectId);
    };
    if (projectScoped) await bindProject();
    if (projectScoped && principal?.role === 'member' && 'id' in principal && vmId && projectId) {
      if (!features.enabled.has('projects') || !policy.projectPermission) throw new AppError('未授予项目操作权限', 403);
      await projectPermissions.require(principal, vmId, projectId, policy.projectPermission);
    }
    const extensionCredential = req.headers['x-sakura-extension-token'];
    const extensionSource = req.headers.origin || req.headers['x-sakura-extension-origin'];
    return {
      /**
       * 入口 / Entry: createOperationAuthority.input.
       * 功能：在构造操作授权检查中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`operation-authority.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-authority.ts`; this entry produces `void` for its caller. Module context: Creates operation authorization checks combining live account, session-lock and plugin authority.
       * 处理：通过 `bindProject` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `bindProject`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `policy.projectBinding !== 'input-scope'`; `projectScoped`.
       * 输入 / Inputs: input: unknown
       * 输出 / Returns: `void`.
       * 副作用 / Effects: 更新 / updates `projectScoped`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      input: async (input: unknown) => {
        if (policy.projectBinding !== 'input-scope') return;
        projectScoped = (input as { scope?: string }).scope !== 'instance';
        if (projectScoped) await bindProject();
      },
      identity: { ...(principal && 'id' in principal ? { actorId: principal.id } : {}),
        ...(vmId ? { vmId } : {}), ...(projectId ? { projectId } : {}), ...identity },
      /**
       * 入口 / Entry: createOperationAuthority.check.
       * 功能：在构造操作授权检查中，核对调用资格、输入或资源归属；本入口产生 `checked?.role` 供上层消费（`operation-authority.ts`）。
       * Purpose: Checks admission, input or resource ownership in `operation-authority.ts`; this entry produces `checked?.role` for its caller. Module context: Creates operation authorization checks combining live account, session-lock and plugin authority.
       * 处理：通过 `authenticate`, `session.requireUnlocked`, `requireEnabled`, `browserExtensions.authorize` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `authenticate`, `session.requireUnlocked`, `requireEnabled`, `browserExtensions.authorize`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!principal && policy.session === 'required'`; `policy.extensionAuth === 'paired'`; `policy.identity === 'fixed-vm'`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `checked?.role`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `policy.maintenance === 'block' && features.migration?.blocked`; `policy.extensionAuth === 'account' || policy.extensionAuth === 'paired'`; `!access.enabled`; 异常 / errors `new AppError('数据目录迁移维护中', 409, 'MAINTENANCE')`; `new AppError('请先启用账户模式', 409)`.
       */
      check: async () => {
        const currentPrincipal = principal ? authenticate() : undefined;
        if (!principal && policy.session === 'required')
          session.requireUnlocked();
        requireEnabled();
        if (policy.maintenance === 'block' && features.migration?.blocked)
          throw new AppError('数据目录迁移维护中', 409, 'MAINTENANCE');
        if (policy.extensionAuth === 'account' || policy.extensionAuth === 'paired') {
          if (!access.enabled) throw new AppError('请先启用账户模式', 409);
          if (policy.extensionAuth === 'paired')
            browserExtensions.authorize(extensionOrigin(extensionSource), extensionCredential);
        }
        if (vmId) {
          if (policy.identity === 'fixed-vm') machines.get(vmId);
          if (machines.records.has(vmId) && policy.vmLock === 'require-unlocked') machines.requireUnlocked(vmId);
          if (policy.identity === 'fixed-vm' && machines.live.get(vmId) !== initialLive)
            throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
          if (identity) lifetime!.assert(identity);
        }
        if (projectScoped && vmId && projectId) {
          const index = await gatewayProjects.readCommittedList(vmId);
          if (!index.projects.some(project => project.id === projectId)) throw new AppError('项目已移除', 409);
          if (currentPrincipal?.role === 'member' && 'id' in currentPrincipal) {
            if (!features.enabled.has('projects')) throw new AppError('项目工作区插件未启用', 403);
            if (!policy.projectPermission) throw new AppError('未声明项目权限', 403);
            await projectPermissions.requireCommitted(currentPrincipal, vmId, projectId, policy.projectPermission);
          }
          if (policy.approval === 'project-change' && projectPermissions.requiresApproval(vmId, projectId))
            throw new AppError('此项目的配置变更需要第二位账户审批', 409);
        }
        // 已提交元数据读取也会异步等待；读完再次核对账户、锁和实例身份，封住等待期间的撤销。
        if (policy.maintenance === 'block' && features.migration?.blocked)
          throw new AppError('数据目录迁移维护中', 409, 'MAINTENANCE');
        if (vmId && policy.identity === 'fixed-vm' && machines.live.get(vmId) !== initialLive)
          throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
        if (identity) lifetime!.assert(identity);
        const checked = principal ? authenticate() : undefined;
        if (principal && checked && (principal.role !== checked.role ||
            ('id' in principal && (!('id' in checked) || principal.id !== checked.id))))
          throw new AppError('请求账户归属已改变', 403);
        return checked?.role;
      },
    };
  };
}
