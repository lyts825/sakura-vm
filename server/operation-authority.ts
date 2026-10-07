/**
 * 模块职责：构造操作授权检查，协调账户会话、锁状态及插件权限的持续有效性。
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
  equalToken(value: unknown): boolean;
  socketAuthorization(credential: string, mode: string, vmId: string, session?: string | null,
    project?: string | null): Principal | { role: 'owner' } | null;
  projects?: Pick<ProjectCatalogV1, 'list' | 'readCommittedList'>;
};

/** 核心与插件请求共用当前授权策略；具体协议的归属证明仍由对应领域处理器核验。 */
export function createOperationAuthority(options: AuthorityOptions) {
  const { machines, features, access, session, projectPermissions, browserExtensions,
    equalToken, socketAuthorization } = options;
  const gatewayProjects = options.projects || new ProjectCatalog(machines);
  return async (req: IncomingMessage, url: URL, entry: OperationEntry,
    parameters: Readonly<Record<string, string>>, requireEnabled: () => void): Promise<OperationBinding> => {

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
      input: async (input: unknown) => {
        if (policy.projectBinding !== 'input-scope') return;
        projectScoped = (input as { scope?: string }).scope !== 'instance';
        if (projectScoped) await bindProject();
      },
      identity: { ...(principal && 'id' in principal ? { actorId: principal.id } : {}),
        ...(vmId ? { vmId } : {}), ...(projectId ? { projectId } : {}), ...identity },
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
