/**
 * 模块职责：处理项目授权与项目执行请求，依据成员身份限制可见项目与动作。
 * Module purpose: Handles project permissions and execution requests, limiting visible projects and actions by current membership.
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import { policyBundlePreview, policyBundleTarget } from './policy-bundles.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

/**
 * 入口 / Entry: projectAccessHandlers.
 * 功能：创建项目目录、授权和项目执行请求的 HTTP 处理器。
 * Purpose: Builds handlers for project catalogues, grants and execution requests.
 * 设计：成员请求保持已捕获项目范围；管理动作核对角色和路径，执行仍走完整项目账户准入。
 * Design: Member requests retain captured scope; role/path checks precede management and execution uses complete project-account admission.
 * 输入 / Inputs: context: CoreHttpContext< 'access' | 'projectPermissions' | 'changeApprovals' | 'features' | '…
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `{ 'core.access.projects': accessProjectsHandler, 'core.access.changes': accessChangesHandler, 'core.access.createChange': acc…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function projectAccessHandlers(
  context: CoreHttpContext<
    'access' | 'projectPermissions' | 'changeApprovals' | 'features' | 'policyBundles'
  >,
): CoreHttpHandlers {
  const { services, authorizedBody } = context;
  /**
   * 入口 / Entry: projectAccessHandlers.accessProjectsHandler.
   * 功能：在处理项目授权与项目执行请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { projects: await projectPermissions.accessible(accountPrincipal) })` 供上层消费（`http-project-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-project-access.ts`; this entry produces `send(res, { projects: await projectPermissions.accessible(accountPrincipal) })` for its caller. Module context: Handles project permissions and execution requests, limiting visible projects and actions by current membership.
   * 处理：通过 `access.authorize`, `send`, `projectPermissions.accessible` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `projectPermissions.accessible`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { projects: await projectPermissions.accessible(accountPrincipal) })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/projects'`; `req.method !== 'GET' || accountPrincipal?.role !== 'member'`; 异常 / errors `new AppError('只有项目成员可查看授权项目', 403)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessProjectsHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, projectPermissions } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/projects') {
      if (req.method !== 'GET' || accountPrincipal?.role !== 'member')
        throw new AppError('只有项目成员可查看授权项目', 403);
      return send(res, { projects: await projectPermissions.accessible(accountPrincipal) });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: projectAccessHandlers.accessChangesHandler.
   * 功能：在处理项目授权与项目执行请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { changes: await changeApprovals.list(accountPrincipal) })` / `send(res, await changeApprovals.create(accountPrincipal, await authorizedBody(req, 65536)), 201)` 供上层消费（`http-project-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-project-access.ts`; this entry produces `send(res, { changes: await changeApprovals.list(accountPrincipal) })` / `send(res, await changeApprovals.create(accountPrincipal, await authorizedBody(req, 65536)), 201)` for its caller. Module context: Handles project permissions and execution requests, limiting visible projects and actions by current membership.
   * 处理：通过 `access.authorize`, `send`, `changeApprovals.list`, `changeApprovals.create` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `changeApprovals.list`, `changeApprovals.create`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { changes: await changeApprovals.list(accountPrincipal) })`; `send(res, await changeApprovals.create(accountPrincipal, await authorizedBody(req, 65536)), 201)`.
   * 副作用 / Effects: `send`; `changeApprovals.create`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/changes'`; `!accountPrincipal || !changeApprovals`; `req.method !== 'POST'`; 异常 / errors `new AppError('请先启用账户模式与项目工作区插件', 409)`; `new AppError('不支持此方法', 405)`.
   */
  const accessChangesHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, changeApprovals, features } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/changes') {
      if (!accountPrincipal || !changeApprovals) throw new AppError('请先启用账户模式与项目工作区插件', 409);
      if (req.method === 'GET') return send(res, { changes: await changeApprovals.list(accountPrincipal) });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await changeApprovals.create(accountPrincipal, await authorizedBody(req, 65536)), 201);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: projectAccessHandlers.accessDecideChangeHandler.
   * 功能：在处理项目授权与项目执行请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send( res, await changeApprovals.decide( accountPrincipal, url.pathname.split('/')[4], await authorizedBody(req, 4096), ), )` 供上层消费（`http-project-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-project-access.ts`; this entry produces `send( res, await changeApprovals.decide( accountPrincipal, url.pathname.split('/')[4], await authorizedBody(req, 4096), ), )` for its caller. Module context: Handles project permissions and execution requests, limiting visible projects and actions by current membership.
   * 处理：通过 `access.authorize`, `inline.test`, `send`, `changeApprovals.decide` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.test`, `send`, `changeApprovals.decide`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send( res, await changeApprovals.decide( accountPrincipal, url.pathname.split('/')[4], await authorizedBody(req, 4096), ), )`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/changes\/[a-f0-9-]{36}\/decision$/.test(url.pathname)`; `req.method !== 'POST' || !accountPrincipal || !changeApprovals`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  const accessDecideChangeHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, changeApprovals, features } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/changes\/[a-f0-9-]{36}\/decision$/.test(url.pathname)) {
      if (req.method !== 'POST' || !accountPrincipal || !changeApprovals)
        throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(
        res,
        await changeApprovals.decide(
          accountPrincipal,
          url.pathname.split('/')[4],
          await authorizedBody(req, 4096),
        ),
      );
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: projectAccessHandlers.accessApplyChangeHandler.
   * 功能：在处理项目授权与项目执行请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await changeApprovals.apply(accountPrincipal, url.pathname.split('/')[4]))` 供上层消费（`http-project-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-project-access.ts`; this entry produces `send(res, await changeApprovals.apply(accountPrincipal, url.pathname.split('/')[4]))` for its caller. Module context: Handles project permissions and execution requests, limiting visible projects and actions by current membership.
   * 处理：通过 `access.authorize`, `inline.test`, `z.object().strict().parse`, `z.object().strict` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.test`, `z.object().strict().parse`, `z.object().strict`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await changeApprovals.apply(accountPrincipal, url.pathname.split('/')[4]))`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/access\/changes\/[a-f0-9-]{36}\/apply$/.test(url.pathname)`; `req.method !== 'POST' || !accountPrincipal || !changeApprovals`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
  const accessApplyChangeHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, changeApprovals, features } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/access\/changes\/[a-f0-9-]{36}\/apply$/.test(url.pathname)) {
      if (req.method !== 'POST' || !accountPrincipal || !changeApprovals)
        throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await changeApprovals.apply(accountPrincipal, url.pathname.split('/')[4]));
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: projectAccessHandlers.accessProjectPermissionsHandler.
   * 功能：在处理项目授权与项目执行请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await projectPermissions.view(vmId, projectId))` / `send(res, await projectPermissions.configure(vmId, projectId, await authorizedBody(req, 32768)))` 供上层消费（`http-project-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-project-access.ts`; this entry produces `send(res, await projectPermissions.view(vmId, projectId))` / `send(res, await projectPermissions.configure(vmId, projectId, await authorizedBody(req, 32768)))` for its caller. Module context: Handles project permissions and execution requests, limiting visible projects and actions by current membership.
   * 处理：通过 `access.authorize`, `features.enabled.has`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `features.enabled.has`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await projectPermissions.view(vmId, projectId))`; `send(res, await projectPermissions.configure(vmId, projectId, await authorizedBody(req, 32768)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/project-permissions'`; `accountPrincipal?.role !== 'owner'`; `!features.enabled.has('projects')`; 异常 / errors `new AppError('只有管理员可管理项目权限', 403)`; `new AppError('项目工作区插件未启用', 403)`.
   */
  const accessProjectPermissionsHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, projectPermissions } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/access/project-permissions') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理项目权限', 403);
      if (!features.enabled.has('projects')) throw new AppError('项目工作区插件未启用', 403);
      const vmId = z.uuid().parse(url.searchParams.get('vmId'));
      const projectId = url.searchParams.get('projectId') || '';
      if (req.method === 'GET') return send(res, await projectPermissions.view(vmId, projectId));
      if (req.method !== 'PUT') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      return send(res, await projectPermissions.configure(vmId, projectId, await authorizedBody(req, 32768)));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: projectAccessHandlers.accessPolicyBundleKeysHandler.
   * 功能：在处理项目授权与项目执行请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, policyBundles.keys())` / `send(res, await policyBundles.action(await authorizedBody(req, 8192)))` 供上层消费（`http-project-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-project-access.ts`; this entry produces `send(res, policyBundles.keys())` / `send(res, await policyBundles.action(await authorizedBody(req, 8192)))` for its caller. Module context: Handles project permissions and execution requests, limiting visible projects and actions by current membership.
   * 处理：通过 `access.authorize`, `url.pathname.startsWith`, `features.enabled.has`, `send` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `url.pathname.startsWith`, `features.enabled.has`, `send`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `url.pathname === '/api/access/policy-bundles/export'`; `url.pathname === '/api/access/policy-bundles/preview'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, policyBundles.keys())`; `send(res, await policyBundles.action(await authorizedBody(req, 8192)))`; `send(res, { bundle: await policyBundles.export(target.vmId, target.projectId) })`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `url.pathname.startsWith`; `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname.startsWith('/api/access/policy-bundles/')`; `accountPrincipal?.role !== 'owner'`; `!features.enabled.has('projects')`; 异常 / errors `new AppError('只有管理员可管理项目策略包', 403)`; `new AppError('项目工作区插件未启用', 403)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
  const accessPolicyBundleKeysHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, policyBundles } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname.startsWith('/api/access/policy-bundles/')) {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理项目策略包', 403);
      if (!features.enabled.has('projects')) throw new AppError('项目工作区插件未启用', 403);
      if (url.pathname === '/api/access/policy-bundles/keys') {
        if (req.method === 'GET') return send(res, policyBundles.keys());
        if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        return send(res, await policyBundles.action(await authorizedBody(req, 8192)));
      }
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (url.pathname === '/api/access/policy-bundles/export') {
        const target = policyBundleTarget.parse(await authorizedBody(req, 4096));
        return send(res, { bundle: await policyBundles.export(target.vmId, target.projectId) });
      }
      if (url.pathname === '/api/access/policy-bundles/preview') {
        const input = policyBundlePreview.parse(await authorizedBody(req, 65536));
        return send(res, await policyBundles.preview(input.bundle, input.target));
      }
      if (url.pathname === '/api/access/policy-bundles/apply') {
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        const releaseMutation = features.operations.enter();
        try {
          return send(res, await policyBundles.apply(await authorizedBody(req, 65536)));
        } finally {
          releaseMutation();
        }
      }
      throw new AppError('接口不存在', 404);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  return {
    'core.access.projects': accessProjectsHandler,
    'core.access.changes': accessChangesHandler,
    'core.access.createChange': accessChangesHandler,
    'core.access.decideChange': accessDecideChangeHandler,
    'core.access.applyChange': accessApplyChangeHandler,
    'core.access.projectPermissions': accessProjectPermissionsHandler,
    'core.access.configureProjectPermissions': accessProjectPermissionsHandler,
    'core.access.policyBundleKeys': accessPolicyBundleKeysHandler,
    'core.access.policyBundleKeyAction': accessPolicyBundleKeysHandler,
    'core.access.exportPolicyBundle': accessPolicyBundleKeysHandler,
    'core.access.previewPolicyBundle': accessPolicyBundleKeysHandler,
    'core.access.applyPolicyBundle': accessPolicyBundleKeysHandler,
  };
}
