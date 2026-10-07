/**
 * 模块职责：将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器。
 * Module purpose: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { accessHandoffInput, accessPasswordInput } from './access-control.ts';
import { sendJson as send } from './http-response.ts';
import { passkeyRemove } from './passkeys.ts';
import { projectIdSchema } from './project-catalog.ts';
import { type SsoProvider } from './sso.ts';
import { terminalShareInput } from './terminal-sharing.ts';
import { noteOperationResultActor } from './operation-results.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

/**
 * 入口 / Entry: accountAccessHandlers.
 * 功能：构造账户、会话、项目权限和 SSO 相关操作处理器目录。
 * Purpose: Builds handlers for account/session/project-grant/SSO operations.
 * 设计：每个处理器按路径与输入契约读取请求，变更仍由账户和授权领域执行；目录构造本身不处理外部请求。
 * Design: Handlers read paths/inputs under contracts and delegate effects to account/authorization domains; building the directory does not process requests.
 * 输入 / Inputs: context: CoreHttpContext< | 'access' | 'sso' | 'features' | 'machines' | 'session' | 'terminal…
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `{ 'core.access.ssoView': accessSsoViewHandler, 'core.access.ssoOidcConfigure': accessSsoOidcConfigureHandler, 'core.access.ss…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function accountAccessHandlers(
  context: CoreHttpContext<
    | 'access'
    | 'sso'
    | 'features'
    | 'machines'
    | 'session'
    | 'terminalSharing'
    | 'jitPrivileges'
    | 'passkeys'
    | 'token'
    | 'projectPermissions'
    | 'browserExtensions'
    | 'mobileCompanion'
    | 'requireService'
  >,
): CoreHttpHandlers {
  const {
    services,
    authorizedBody,
    authorized,
    terminateCredentialSockets,
    terminateTerminalGrantSockets,
    requirePasskeyOrigin,
    terminateAccountSockets,
    terminateSockets,
  } = context;
  /**
   * 入口 / Entry: accountAccessHandlers.accessSsoViewHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, sso.view(accountPrincipal.role === 'owner' ? undefined : accountPrincipal.id))` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, sso.view(accountPrincipal.role === 'owner' ? undefined : accountPrincipal.id))` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `send`, `sso.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `sso.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, sso.view(accountPrincipal.role === 'owner' ? undefined : accountPrincipal.id))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/sso'`; `req.method !== 'GET' || !accountPrincipal`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessSsoViewHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, sso } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/sso') {
      if (req.method !== 'GET' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      return send(res, sso.view(accountPrincipal.role === 'owner' ? undefined : accountPrincipal.id));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessSsoOidcConfigureHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await sso.disable(providerId))` / `send( res, providerId === 'oidc' ? await sso.configureOidc(input) : await sso.configureSaml(input), )` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, await sso.disable(providerId))` / `send( res, providerId === 'oidc' ? await sso.configureOidc(input) : await sso.configureSaml(input), )` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `url.pathname.endsWith`, `send`, `sso.disable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `url.pathname.endsWith`, `send`, `sso.disable`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'DELETE'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await sso.disable(providerId))`; `send( res, providerId === 'oidc' ? await sso.configureOidc(input) : await sso.configureSaml(input), )`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/sso/oidc' || url.pathname === '/api/access/sso/saml'`; `accountPrincipal?.role !== 'owner'`; `features.migration?.blocked`; 异常 / errors `new AppError('仅管理员可配置单点登录', 403)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessSsoOidcConfigureHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, sso } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/sso/oidc' || url.pathname === '/api/access/sso/saml') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('仅管理员可配置单点登录', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const providerId: SsoProvider = url.pathname.endsWith('oidc') ? 'oidc' : 'saml';
      if (req.method === 'DELETE') return send(res, await sso.disable(providerId));
      if (req.method !== 'PUT') throw new AppError('不支持此方法', 405);
      const input = await authorizedBody(req, providerId === 'saml' ? 700_000 : 8192);
      return send(
        res,
        providerId === 'oidc' ? await sso.configureOidc(input) : await sso.configureSaml(input),
      );
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessSsoUnlinkHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await sso.unlink(accountPrincipal.id, url.pathname.split('/').at(-1) as SsoProvider))` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, await sso.unlink(accountPrincipal.id, url.pathname.split('/').at(-1) as SsoProvider))` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `inline.test`, `send`, `sso.unlink` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.test`, `send`, `sso.unlink`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await sso.unlink(accountPrincipal.id, url.pathname.split('/').at(-1) as SsoProvider))`.
   * 副作用 / Effects: `send`; `sso.unlink`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/sso\/link\/(oidc|saml)$/.test(url.pathname)`; `req.method !== 'DELETE' || !accountPrincipal`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessSsoUnlinkHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, sso } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/sso\/link\/(oidc|saml)$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await sso.unlink(accountPrincipal.id, url.pathname.split('/').at(-1) as SsoProvider));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessViewHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { role: principal.role, checkedAt: new Date().toISOString(), desktopAvailable: features.socketEnabled('desktop'), v…` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, { role: principal.role, checkedAt: new Date().toISOString(), desktopAvailable: features.socketEnabled('desktop'), v…` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `authorized`, `machines.records.keys`, `Promise.all`, `ids.filter().map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authorized`, `machines.records.keys`, `Promise.all`, `ids.filter().map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { role: principal.role, checkedAt: new Date().toISOString(), desktopAvailable: features.socketEnabled('desktop'), v…`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/view'`; `req.method !== 'GET' || !access.enabled`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessViewHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, machines } = services;
    const principal = authorized(req);
    if (url.pathname === '/api/access/view') {
      if (req.method !== 'GET' || !access.enabled) throw new AppError('不支持此方法', 405);
      const ids = principal.role === 'viewer' ? principal.vmIds : [...machines.records.keys()];
      const vms = await Promise.all(
        ids.filter((id) => machines.records.has(id)).map((id) => machines.view(id)),
      );
      return send(res, {
        role: principal.role,
        checkedAt: new Date().toISOString(),
        desktopAvailable: features.socketEnabled('desktop'),
        vms: vms.map(({ id, name, status, distro, cpus, memoryMiB, diskGiB }) => ({
          id,
          name,
          status,
          distro,
          cpus,
          memoryMiB,
          diskGiB,
        })),
      });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessLogoutHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, result)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.logout`, `terminateCredentialSockets`, `send` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.logout`, `terminateCredentialSockets`, `send`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `typeof credential === 'string'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/logout'`; `req.method !== 'POST'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessLogoutHandler: HttpOperationHandler = async (req, res, url) => {
    const { access } = services;
    if (url.pathname === '/api/access/logout') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const credential = req.headers['x-sakura-token'];
      const result = access.logout(credential);
      if (typeof credential === 'string') terminateCredentialSockets(credential);
      return send(res, result);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessHandoffCreateHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, access.cancelHandoff(req.headers['x-sakura-token']))` / `send(res, await access.createHandoff(req.headers['x-sakura-token']))` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, access.cancelHandoff(req.headers['x-sakura-token']))` / `send(res, await access.createHandoff(req.headers['x-sakura-token']))` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `send`, `access.cancelHandoff`, `accessHandoffInput.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `access.cancelHandoff`, `accessHandoffInput.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'DELETE'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, access.cancelHandoff(req.headers['x-sakura-token']))`; `send(res, await access.createHandoff(req.headers['x-sakura-token']))`.
   * 副作用 / Effects: `send`; `access.createHandoff`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/handoff'`; `!accountPrincipal`; `req.method !== 'POST'`; 异常 / errors `new AppError('账户模式未启用', 409)`; `new AppError('不支持此方法', 405)`.
   */
  const accessHandoffCreateHandler: HttpOperationHandler = async (req, res, url) => {
    const { access } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/handoff') {
      if (!accountPrincipal) throw new AppError('账户模式未启用', 409);
      if (req.method === 'DELETE') return send(res, access.cancelHandoff(req.headers['x-sakura-token']));
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const input = accessHandoffInput.parse(await authorizedBody(req, 4096));
      const proof = await access.login({ username: accountPrincipal.username, password: input.password });
      access.logout(proof.token);
      return send(res, await access.createHandoff(req.headers['x-sakura-token']));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessTerminalSharesHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { grants: terminalSharing.list( accountPrincipal.role === 'viewer' ? accountPrincipal.id : undefined, vmId || undef…` / `send(res, result, 201)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, { grants: terminalSharing.list( accountPrincipal.role === 'viewer' ? accountPrincipal.id : undefined, vmId || undef…` / `send(res, result, 201)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `services.requireService`, `access.authorize`, `url.searchParams.get`, `z.uuid().parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `access.authorize`, `url.searchParams.get`, `z.uuid().parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `vmId`; `projectId !== null`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { grants: terminalSharing.list( accountPrincipal.role === 'viewer' ? accountPrincipal.id : undefined, vmId || undef…`; `send(res, result, 201)`.
   * 副作用 / Effects: `send`; `terminalSharing.create`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/terminal-shares'`; `!accountPrincipal`; `req.method === 'GET'`; 异常 / errors `new AppError('账户模式未启用', 409)`; `new AppError('实例不在账户范围内', 403)`.
   */
  const accessTerminalSharesHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, machines, session } = services;
    const terminalSharing = services.requireService('terminalSharing');
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/terminal-shares') {
      if (!accountPrincipal) throw new AppError('账户模式未启用', 409);
      if (req.method === 'GET') {
        const vmId = url.searchParams.get('vmId');
        const projectId = url.searchParams.get('project');
        if (vmId) z.uuid().parse(vmId);
        if (projectId !== null) projectIdSchema.parse(projectId);
        if (accountPrincipal.role === 'viewer' && vmId && !accountPrincipal.vmIds.includes(vmId))
          throw new AppError('实例不在账户范围内', 403);
        return send(res, {
          grants: terminalSharing.list(
            accountPrincipal.role === 'viewer' ? accountPrincipal.id : undefined,
            vmId || undefined,
            projectId || undefined,
          ),
        });
      }
      if (req.method !== 'POST' || accountPrincipal.role !== 'owner')
        throw new AppError('只有管理员可共享终端', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      if (!features.socketEnabled('terminal-session')) throw new AppError('请先启用可恢复终端会话插件', 409);
      const input = terminalShareInput.parse(await authorizedBody(req, 4096));
      machines.requireUnlocked(input.vmId);
      const viewer = access
        .users()
        .find(
          (user) =>
            user.id === input.viewerId &&
            user.role === 'viewer' &&
            user.vmIds.includes(input.vmId) &&
            (user.expiresAt === null || user.expiresAt > Date.now()),
        );
      if (!viewer) throw new AppError('只读账户无此实例权限', 403);
      const result = await terminalSharing.create(input);
      terminateTerminalGrantSockets(result.id);
      return send(res, result, 201);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessTerminalShareRevokeHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, result)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `services.requireService`, `access.authorize`, `inline.test`, `url.pathname.split().at` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `access.authorize`, `inline.test`, `url.pathname.split().at`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/terminal-shares\/[a-f0-9-]{36}$/.test(url.pathname)`; `req.method !== 'DELETE' || accountPrincipal?.role !== 'owner'`; `features.migration?.blocked`; 异常 / errors `new AppError('只有管理员可撤销终端共享', 403)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessTerminalShareRevokeHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features } = services;
    const terminalSharing = services.requireService('terminalSharing');
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/terminal-shares\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可撤销终端共享', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const id = url.pathname.split('/').at(-1)!;
      const result = await terminalSharing.revoke(id);
      terminateTerminalGrantSockets(id);
      return send(res, result);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessJitListHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { requests: jitPrivileges.list(accountPrincipal) })` / `send(res, await jitPrivileges.create(accountPrincipal, await authorizedBody(req, 4096)), 201)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, { requests: jitPrivileges.list(accountPrincipal) })` / `send(res, await jitPrivileges.create(accountPrincipal, await authorizedBody(req, 4096)), 201)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `send`, `jitPrivileges.list`, `jitPrivileges.create` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `jitPrivileges.list`, `jitPrivileges.create`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { requests: jitPrivileges.list(accountPrincipal) })`; `send(res, await jitPrivileges.create(accountPrincipal, await authorizedBody(req, 4096)), 201)`.
   * 副作用 / Effects: `send`; `jitPrivileges.create`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/jit'`; `!accountPrincipal`; `req.method !== 'POST' || accountPrincipal.role !== 'viewer'`; 异常 / errors `new AppError('账户模式未启用', 409)`; `new AppError('只有只读账户可申请临时授权', 403)`.
   */
  const accessJitListHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, jitPrivileges } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/jit') {
      if (!accountPrincipal) throw new AppError('账户模式未启用', 409);
      if (req.method === 'GET') return send(res, { requests: jitPrivileges.list(accountPrincipal) });
      if (req.method !== 'POST' || accountPrincipal.role !== 'viewer')
        throw new AppError('只有只读账户可申请临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await jitPrivileges.create(accountPrincipal, await authorizedBody(req, 4096)), 201);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessJitDecisionHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send( res, await jitPrivileges.decide( accountPrincipal, url.pathname.split('/')[4], await authorizedBody(req, 4096), ), )` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send( res, await jitPrivileges.decide( accountPrincipal, url.pathname.split('/')[4], await authorizedBody(req, 4096), ), )` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `inline.test`, `send`, `jitPrivileges.decide` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.test`, `send`, `jitPrivileges.decide`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send( res, await jitPrivileges.decide( accountPrincipal, url.pathname.split('/')[4], await authorizedBody(req, 4096), ), )`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/jit\/[a-f0-9-]{36}\/decision$/.test(url.pathname)`; `req.method !== 'POST' || accountPrincipal?.role !== 'owner'`; `features.migration?.blocked`; 异常 / errors `new AppError('只有管理员可审批临时授权', 403)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessJitDecisionHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, jitPrivileges } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/jit\/[a-f0-9-]{36}\/decision$/.test(url.pathname)) {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可审批临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(
        res,
        await jitPrivileges.decide(
          accountPrincipal,
          url.pathname.split('/')[4],
          await authorizedBody(req, 4096),
        ),
      );
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessJitExecuteHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await jitPrivileges.execute(accountPrincipal, url.pathname.split('/')[4]))` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, await jitPrivileges.execute(accountPrincipal, url.pathname.split('/')[4]))` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `inline.test`, `z.object().strict().parse`, `z.object().strict` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.test`, `z.object().strict().parse`, `z.object().strict`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await jitPrivileges.execute(accountPrincipal, url.pathname.split('/')[4]))`.
   * 副作用 / Effects: `send`; `jitPrivileges.execute`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/jit\/[a-f0-9-]{36}\/execute$/.test(url.pathname)`; `req.method !== 'POST' || accountPrincipal?.role !== 'viewer'`; `features.migration?.blocked`; 异常 / errors `new AppError('只有申请账户可执行临时授权', 403)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
  const accessJitExecuteHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, jitPrivileges } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/jit\/[a-f0-9-]{36}\/execute$/.test(url.pathname)) {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'viewer')
        throw new AppError('只有申请账户可执行临时授权', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await jitPrivileges.execute(accountPrincipal, url.pathname.split('/')[4]));
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessPasskeysHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { passkeys: access.passkeysFor(accountPrincipal.id) })` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, { passkeys: access.passkeysFor(accountPrincipal.id) })` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `send`, `access.passkeysFor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `access.passkeysFor`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { passkeys: access.passkeysFor(accountPrincipal.id) })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/passkeys'`; `req.method !== 'GET' || !accountPrincipal`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessPasskeysHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/passkeys') {
      if (req.method !== 'GET' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      return send(res, { passkeys: access.passkeysFor(accountPrincipal.id) });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessPasskeyRegisterOptionsHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await passkeys.beginRegistration(accountPrincipal, await authorizedBody(req, 4096)))` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, await passkeys.beginRegistration(accountPrincipal, await authorizedBody(req, 4096)))` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `requirePasskeyOrigin`, `send`, `passkeys.beginRegistration` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `requirePasskeyOrigin`, `send`, `passkeys.beginRegistration`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await passkeys.beginRegistration(accountPrincipal, await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/passkeys/register/options'`; `req.method !== 'POST' || !accountPrincipal`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessPasskeyRegisterOptionsHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/passkeys/register/options') {
      if (req.method !== 'POST' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      return send(res, await passkeys.beginRegistration(accountPrincipal, await authorizedBody(req, 4096)));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessPasskeyRegisterVerifyHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send( res, await passkeys.finishRegistration(accountPrincipal, await authorizedBody(req, 65536)), 201, )` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send( res, await passkeys.finishRegistration(accountPrincipal, await authorizedBody(req, 65536)), 201, )` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `requirePasskeyOrigin`, `send`, `passkeys.finishRegistration` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `requirePasskeyOrigin`, `send`, `passkeys.finishRegistration`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send( res, await passkeys.finishRegistration(accountPrincipal, await authorizedBody(req, 65536)), 201, )`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/passkeys/register/verify'`; `req.method !== 'POST' || !accountPrincipal`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessPasskeyRegisterVerifyHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, passkeys } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/passkeys/register/verify') {
      if (req.method !== 'POST' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(
        res,
        await passkeys.finishRegistration(accountPrincipal, await authorizedBody(req, 65536)),
        201,
      );
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessPasskeyRemoveHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, result)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `inline.test`, `passkeyRemove.parse`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.test`, `passkeyRemove.parse`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/passkeys\/[A-Za-z0-9_-]{16,1024}$/.test(url.pathname)`; `req.method !== 'DELETE' || !accountPrincipal`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessPasskeyRemoveHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, passkeys } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/passkeys\/[A-Za-z0-9_-]{16,1024}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || !accountPrincipal) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const input = passkeyRemove.parse(await authorizedBody(req, 4096));
      const proof = await access.login({ username: accountPrincipal.username, password: input.password });
      access.logout(proof.token);
      const result = await access.removePasskey(accountPrincipal.id, url.pathname.split('/').at(-1)!);
      terminateAccountSockets(accountPrincipal.id);
      return send(res, result);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessEnableHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, result)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.enable`, `authorizedBody`, `access.users().find`, `access.users` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.enable`, `authorizedBody`, `access.users().find`, `access.users`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result)`.
   * 副作用 / Effects: `send`; 更新 / updates `services.token`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/enable'`; `req.method !== 'POST' || access.enabled`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessEnableHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features } = services;
    if (url.pathname === '/api/access/enable') {
      if (req.method !== 'POST' || access.enabled) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const result = await access.enable(await authorizedBody(req, 4096));
      const owner = access.users().find((account) => account.role === 'owner')!;
      noteOperationResultActor(owner.id);
      services.token = randomBytes(32).toString('hex');
      terminateSockets();
      return send(res, result);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessUsersHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { users: access.users() })` / `send(res, await access.createViewer(input), 201)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, { users: access.users() })` / `send(res, await access.createViewer(input), 201)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `send`, `access.users`, `authorizedBody`, `z.array().min().max().parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `access.users`, `authorizedBody`, `z.array().min().max().parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { users: access.users() })`; `send(res, await access.createViewer(input), 201)`.
   * 副作用 / Effects: `send`; `access.createViewer`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/users'`; `!access.enabled`; `req.method === 'POST'`; 异常 / errors `new AppError('账户模式未启用', 409)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessUsersHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, machines } = services;
    if (url.pathname === '/api/access/users') {
      if (!access.enabled) throw new AppError('账户模式未启用', 409);
      if (req.method === 'GET') return send(res, { users: access.users() });
      if (req.method === 'POST') {
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        const input = await authorizedBody(req, 4096);
        const vmIds = z
          .array(z.uuid())
          .min(1)
          .max(32)
          .parse((input as { vmIds?: unknown }).vmIds);
        for (const id of vmIds) machines.get(id);
        return send(res, await access.createViewer(input), 201);
      }
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessCreateMemberHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await access.createMember(await authorizedBody(req, 4096)), 201)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, await access.createMember(await authorizedBody(req, 4096)), 201)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `send`, `access.createMember`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `access.createMember`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await access.createMember(await authorizedBody(req, 4096)), 201)`.
   * 副作用 / Effects: `send`; `access.createMember`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/members'`; `req.method !== 'POST' || accountPrincipal?.role !== 'owner'`; `features.migration?.blocked`; 异常 / errors `new AppError('只有管理员可创建项目成员', 403)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessCreateMemberHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/members') {
      if (req.method !== 'POST' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可创建项目成员', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await access.createMember(await authorizedBody(req, 4096)), 201);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessRemoveMemberHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, result)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `access.authorize`, `inline.test`, `url.pathname.split().at`, `url.pathname.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.test`, `url.pathname.split().at`, `url.pathname.split`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/members\/[a-f0-9-]{36}$/.test(url.pathname)`; `req.method !== 'DELETE' || accountPrincipal?.role !== 'owner'`; `features.migration?.blocked`; 异常 / errors `new AppError('只有管理员可删除项目成员', 403)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessRemoveMemberHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, projectPermissions } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/members\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可删除项目成员', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const id = url.pathname.split('/').at(-1)!;
      const result = await access.removeMember(id);
      terminateAccountSockets(id);
      await projectPermissions.revokeMember(id);
      return send(res, result);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessRemoveViewerHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, result)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `services.requireService`, `inline.test`, `url.pathname.split().at`, `url.pathname.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `inline.test`, `url.pathname.split().at`, `url.pathname.split`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/users\/[a-f0-9-]{36}$/.test(url.pathname)`; `req.method !== 'DELETE'`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessRemoveViewerHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features } = services;
    const terminalSharing = services.requireService('terminalSharing');
    if (/^\/api\/access\/users\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const id = url.pathname.split('/').at(-1)!;
      const result = await access.removeViewer(id);
      terminateAccountSockets(id);
      await terminalSharing.revokeViewer(id);
      return send(res, result);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.accessPasswordHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result)` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, result)` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `services.requireService`, `access.authorize`, `accessPasswordInput.parse`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `access.authorize`, `accessPasswordInput.parse`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/password'`; `req.method !== 'POST' || !access.enabled`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessPasswordHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, mobileCompanion } = services;
    const browserExtensions = services.requireService('browserExtensions');
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/password') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const input = accessPasswordInput.parse(await authorizedBody(req, 4096));
      const proof = await access.login({ username: accountPrincipal!.username, password: input.password });
      access.logout(proof.token);
      await browserExtensions.revokeAll();
      await mobileCompanion.revokeAll();
      const result = await access.changeOwnerPassword(input);
      terminateSockets();
      return send(res, result);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.sessionLockHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, url.pathname.endsWith('/lock') ? session.lock() : session.activity())` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, url.pathname.endsWith('/lock') ? session.lock() : session.activity())` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `z.object().strict().parse`, `z.object().strict`, `z.object`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.object().strict().parse`, `z.object().strict`, `z.object`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, url.pathname.endsWith('/lock') ? session.lock() : session.activity())`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/session/lock' || url.pathname === '/api/session/activity'`; `req.method !== 'POST'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const sessionLockHandler: HttpOperationHandler = async (req, res, url) => {
    const { session } = services;
    if (url.pathname === '/api/session/lock' || url.pathname === '/api/session/activity') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      return send(res, url.pathname.endsWith('/lock') ? session.lock() : session.activity());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: accountAccessHandlers.sessionSettingsHandler.
   * 功能：在将账户、通行密钥、SSO 与权限操作连接到核心 HTTP 网关处理器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, session.view())` / `send(res, await session.configure(input))` 供上层消费（`http-account-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-account-access.ts`; this entry produces `send(res, session.view())` / `send(res, await session.configure(input))` for its caller. Module context: Connects accounts, passkeys, SSO and permissions to the shared core HTTP gateway handlers.
   * 处理：通过 `send`, `session.view`, `features.operations.enter`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `session.view`, `features.operations.enter`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, session.view())`; `send(res, await session.configure(input))`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/session/settings'`; `req.method !== 'PATCH'`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
  const sessionSettingsHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, session } = services;
    if (url.pathname === '/api/session/settings') {
      if (req.method === 'GET') return send(res, session.view());
      if (req.method !== 'PATCH') throw new AppError('不支持此方法', 405);
      const releaseMutation = features.operations.enter();
      try {
        const input = await authorizedBody(req, 4096);
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        return send(res, await session.configure(input));
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  return {
    'core.access.ssoView': accessSsoViewHandler,
    'core.access.ssoOidcConfigure': accessSsoOidcConfigureHandler,
    'core.access.ssoOidcDisable': accessSsoOidcConfigureHandler,
    'core.access.ssoSamlConfigure': accessSsoOidcConfigureHandler,
    'core.access.ssoSamlDisable': accessSsoOidcConfigureHandler,
    'core.access.ssoUnlink': accessSsoUnlinkHandler,
    'core.access.view': accessViewHandler,
    'core.access.logout': accessLogoutHandler,
    'core.access.handoffCreate': accessHandoffCreateHandler,
    'core.access.handoffCancel': accessHandoffCreateHandler,
    'core.access.terminalShares': accessTerminalSharesHandler,
    'core.access.terminalShareCreate': accessTerminalSharesHandler,
    'core.access.terminalShareRevoke': accessTerminalShareRevokeHandler,
    'core.access.jitList': accessJitListHandler,
    'core.access.jitCreate': accessJitListHandler,
    'core.access.jitDecision': accessJitDecisionHandler,
    'core.access.jitExecute': accessJitExecuteHandler,
    'core.access.passkeys': accessPasskeysHandler,
    'core.access.passkeyRegisterOptions': accessPasskeyRegisterOptionsHandler,
    'core.access.passkeyRegisterVerify': accessPasskeyRegisterVerifyHandler,
    'core.access.passkeyRemove': accessPasskeyRemoveHandler,
    'core.access.enable': accessEnableHandler,
    'core.access.users': accessUsersHandler,
    'core.access.createViewer': accessUsersHandler,
    'core.access.createMember': accessCreateMemberHandler,
    'core.access.removeMember': accessRemoveMemberHandler,
    'core.access.removeViewer': accessRemoveViewerHandler,
    'core.access.password': accessPasswordHandler,
    'core.session.lock': sessionLockHandler,
    'core.session.activity': sessionLockHandler,
    'core.session.settings': sessionSettingsHandler,
    'core.session.configure': sessionSettingsHandler,
  };
}
