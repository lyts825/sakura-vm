/**
 * 模块职责（中文）：“项目工作区”插件服务端入口。激活时装配 Workspaces、ProjectDirectoryMigrations，并处理声明的服务端操作。
 * Module responsibility (English): service composition for project configuration, identities and running services, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配项目配置、账号与运行服务的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for project configuration, identities and running services, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as secretsServices } from '../secrets/services.ts';
import { services as networkServices } from '../network/services.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as projectsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';

import { z } from 'zod';

import { Workspaces } from '../../server/workspaces.ts';
import { ProjectDirectoryMigrations } from '../../server/project-directory-migration.ts';

const directoryMigrations = new WeakMap<PluginContext, ProjectDirectoryMigrations>();

/**
 * 中文：在本次插件激活中构造 Workspaces、ProjectDirectoryMigrations，发布 projectsServices.workspaces 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Workspaces, ProjectDirectoryMigrations within this activation and publish projectsServices.workspaces service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(projectsServices.workspaces, new Workspaces(m, {
    // 可选服务通过 getter 按使用时查询，启停 secrets/network 后不会继续持有旧实例。
    /**
     * 中文：访问 getter 时重新解析可选密钥服务，已撤销依赖不会继续通过旧引用使用。
     * English: Re-resolve optional secrets on getter access so a revoked dependency cannot remain usable through an old reference.
     */
    get secrets() {
      return host.optional(secretsServices.secrets);
    },
    /**
     * 中文：访问 getter 时重新解析可选网络服务，项目流程可按依赖缺失处理降级。
     * English: Re-resolve optional networking on getter access so project flows can handle absent dependencies.
     */
    get network() {
      return host.optional(networkServices.network);
    },
  }));
  // 目录迁移器按宿主上下文隔离；关闭删除映射，新一次激活不能沿用旧的迁移操作上下文。
  directoryMigrations.set(host, new ProjectDirectoryMigrations(m, host.use(projectsServices.workspaces)));
  host.onDispose(/** 中文：在装配项目配置、账号与运行服务的服务，发布清单中声明的操作并随插件关闭清理流程中删除匹配条目；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In service composition for project configuration, identities and running services, publication of declared operations and lifecycle cleanup, delete matching entries. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    directoryMigrations.delete(host);
  });
  host.registerJobs(host.use(projectsServices.workspaces).jobs, (job) => {
    if (!job.action) throw new AppError('请回到原功能页面重新执行');
    const [action, service] = job.action.split(':');
    return retryInProject(host, job, () =>
      host.use(projectsServices.workspaces).run(
        retryTarget(job),
        z.enum(['setup', 'start', 'stop', 'terminal']).parse(action),
        service,
      ),
    );
  });
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["projects.legacy.post.vms.vmId.project-directory-migration"]
        、httpRouteRequests["projects.legacy.post.vms.vmId.projects"]
          、httpRouteRequests["projects.legacy.post.vms.vmId.project"]
           等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["projects.legacy.post.vms.vmId.project-directory-migration"]
        , httpRouteRequests["projects.legacy.post.vms.vmId.projects"]
          , httpRouteRequests["projects.legacy.post.vms.vmId.project"]
          . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：目录迁移服务未初始化。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 目录迁移服务未初始化. These errors reach the direct caller or this function's catch handler
 */
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: /** 中文：异步读取请求正文供路由 Schema 校验，不预先假设输入类型；这是 route 的调用契约 | English: Asynchronously read request data for route-schema validation without assuming an input type; this is the callable contract of route | 中文：输入：req：签名所示 IncomingMessage 业务值；signal：本次调用的取消寿命 | English: Inputs: req: the IncomingMessage domain value in the signature; signal: cancellation lifetime for this invocation | 中文：结果：Promise<any>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<any>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  /**
   * 中文：把服务结果按当前操作响应描述写入 HTTP 输出，并返回 true 标记本路由已认领请求
   * English: Write service results through the current operation response description and return true to mark the request claimed
   * 中文：输入：data：签名所示 unknown 业务值；status：此处理器的调用值（缺省 200）
   * English: Inputs: data: the unknown domain value in the signature; status: the invocation value for this handler (default 200)
   */
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && action === 'project-directory-migration') {
    const service = directoryMigrations.get(this);
    if (!service) throw new AppError('目录迁移服务未初始化', 503);
    if (req.method === 'GET') return send(await service.view(id));
    if (req.method === 'POST') {
      const input = httpRouteRequests["projects.legacy.post.vms.vmId.project-directory-migration"]
        .parse(await body(req, signal));
      return send(
        input.action === 'preview'
          ? await service.preview(id, signal)
          : await service.apply(id, input, signal),
      );
    }
  }
  if (parts.length === 4) {
    if (action === 'projects') {
      if (req.method === 'GET') {
        send(await this.use(projectsServices.workspaces).projects.list(id));
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["projects.legacy.post.vms.vmId.projects"]
          .parse(await body(req, signal));
        send(
          input.action === 'create'
            ? await this.use(projectsServices.workspaces).projects.create(id, input.name, /** 中文：在项目路由的实际执行寿命内保存已校验配置，将更新结果交给现有响应流程；保存失败保持失败结果。 | English: Save validated configuration within the project route's actual execution lifetime, delivering updates to the existing response flow and retaining failure on save error. | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                await this.use(projectsServices.workspaces).save(id, input.config);
              })
            : await this.use(projectsServices.workspaces).projects.update(
                id,
                input.projectId,
                input.action === 'rename' ? input.name : undefined,
              ),
        );
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'project') {
      if (req.method === 'GET') {
        send(await this.use(projectsServices.workspaces).view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.use(projectsServices.workspaces).save(id, await body(req, signal)));
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["projects.legacy.post.vms.vmId.project"]
          .parse(await body(req, signal));
        send(await this.use(projectsServices.workspaces).run(id, input.action, input.service), 202);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'project-runtime' && req.method === 'GET') {
      send(await this.use(projectsServices.workspaces).runtime(id, signal));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.projects": route,
  "legacy.post.vms.vmId.projects": route,
  "legacy.get.vms.vmId.project": route,
  "legacy.put.vms.vmId.project": route,
  "legacy.post.vms.vmId.project": route,
  "legacy.get.vms.vmId.project-runtime": route,
  "legacy.get.vms.vmId.project-directory-migration": route,
  "legacy.post.vms.vmId.project-directory-migration": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("projects");
