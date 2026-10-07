/**
 * 模块职责：处理项目授权与项目执行请求，依据成员身份限制可见项目与动作。
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import { policyBundlePreview, policyBundleTarget } from './policy-bundles.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

export function projectAccessHandlers(
  context: CoreHttpContext<
    'access' | 'projectPermissions' | 'changeApprovals' | 'features' | 'policyBundles'
  >,
): CoreHttpHandlers {
  const { services, authorizedBody } = context;
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
