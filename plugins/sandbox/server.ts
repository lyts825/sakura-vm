/**
 * 模块职责（中文）：“沙箱工作台”插件服务端入口。激活时装配 Sandboxes，并处理声明的服务端操作。
 * Module responsibility (English): service composition for isolated environments, timed execution and expiry cleanup, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, operations, route, responseContracts；职责覆盖装配隔离环境、限时执行与到期清理的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, operations, route, responseContracts. The scope covers service composition for isolated environments, timed execution and expiry cleanup, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { services as sandboxServices } from './services.ts';
export { manifest } from './manifest.ts';
import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';
import { Sandboxes, sandboxCreateSchema, sandboxRunSchema } from '../../server/sandboxes.ts';


/**
 * 中文：在本次插件激活中构造 Sandboxes，发布 sandboxServices.sandboxes 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Sandboxes within this activation and publish sandboxServices.sandboxes service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const service = host.provide(sandboxServices.sandboxes, new Sandboxes(host.vm));
  await service.init();
  host.registerJobs(service.jobs, () => {
    throw new AppError('请在沙箱工作台检查命令后重新执行');
  });
}




/**
 * 中文：从已经匹配的实例路由第四个路径段提取实例 ID；资源存在性与授权由路由/领域能力继续检查。
 * English: Extract the VM ID from the fourth segment of an already matched VM route; routing/domain capabilities continue existence/authority checks.
 * 中文：输入：url：签名所示 URL 业务值
 * English: Inputs: url: the URL domain value in the signature
 */
const idFrom = (url: URL) => url.pathname.split('/')[3];
/**
 * 中文：通过宿主强制获取沙箱服务，缺失由 broker 按插件能力契约拒绝。
 * English: Require the sandbox service through host; broker rejects absence under the plugin-capability contract.
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 */
const service = (host: PluginContext) => host.use(sandboxServices.sandboxes);

export const operations: Record<string, PluginOperation> = {
  artifact: {
    response: pluginRouteResponses["sandbox.artifact"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 service(this).artifact；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to service(this).artifact; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return service(this).artifact(
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
  list: {
    response: pluginRouteResponses["sandbox.list"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 service(this).list；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to service(this).list; deliver progress/failure through the existing job-service contract
     */
    execute() {
      return service(this).list();
    },
  },
  create: {
    request: sandboxCreateSchema,
    response: pluginRouteResponses["sandbox.create"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 service(this).create；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to service(this).create; deliver progress/failure through the existing job-service contract
     * 中文：输入：_url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: _url: the invocation value for this handler; input: input data requiring validation
     */
    execute(_url, input) {
      return service(this).create(input);
    },
  },
  inspect: {
    response: pluginRouteResponses["sandbox.inspect"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 service(this).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to service(this).view; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return service(this).view(idFrom(url));
    },
  },
  control: {
    request: z.object({ action: z.enum(['start', 'stop']) }).strict(),
    response: pluginRouteResponses["sandbox.control"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 service(this).control；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to service(this).control; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return service(this).control(idFrom(url), (input as { action: 'start' | 'stop' }).action);
    },
  },
  destroy: {
    response: pluginRouteResponses["sandbox.destroy"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 service(this).control；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to service(this).control; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return service(this).control(idFrom(url), 'destroy');
    },
  },
  run: {
    request: sandboxRunSchema,
    response: pluginRouteResponses["sandbox.run"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 service(this).run；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to service(this).run; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return service(this).run(idFrom(url), input);
    },
  },
};
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Write operation-described responses; return false for unclaimed requests to the main router
 */
export async function route() {
  return false;
}

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("sandbox");
