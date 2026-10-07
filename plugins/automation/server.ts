/**
 * 模块职责（中文）：“自动化与运维”插件服务端入口。激活时装配 FeatureSuite，并处理声明的服务端操作。
 * Module responsibility (English): service composition for resource policy, packages and engineering tasks, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配资源策略、软件包与工程任务的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for resource policy, packages and engineering tasks, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as projectsServices } from '../projects/services.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as serviceHealthServices } from '../service-health/services.ts';
import { services as secretsServices } from '../secrets/services.ts';
import { services as containersServices } from '../containers/services.ts';
import { services as automationServices } from './services.ts';
import { services as ideServices } from '../ide/services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { FeatureSuite } from '../../server/feature-suite.ts';
import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';
import { z } from 'zod';


/**
 * 中文：在本次插件激活中构造 FeatureSuite，发布 automationServices.suite 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct FeatureSuite within this activation and publish automationServices.suite service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(automationServices.suite, new FeatureSuite(m, host.use(projectsServices.workspaces), {
    /**
     * 中文：调用时重新查询可选 IDE 服务，插件缺失时返回 undefined；不在激活时强持有可被撤销的可选依赖。
     * English: Resolve the optional IDE service on invocation, returning undefined when absent rather than retaining a revocable optional dependency at activation.
     */
    editor: () => host.optional(ideServices.ide),
    /**
     * 中文：复制宿主当前任务视图为数组，供自动化领域核对正在运行的任务。
     * English: Copy current host job views into an array for automation-domain reconciliation of running work.
     */
    jobs: () => [...host.jobViews()],
    /**
     * 中文：查询指定实例的可选健康服务观察结果，依赖未启用时回退空列表。
     * English: Read observed health services for the VM, falling back to an empty list when the optional dependency is disabled.
     * 中文：输入：id：目标资源标识
     * English: Inputs: id: target resource identifier
     */
    services: (id) => host.optional(serviceHealthServices.health)?.observed(id) || [],
    /**
     * 中文：异步查询指定实例的可选密钥轮换状态，未启用依赖不伪造状态。
     * English: Asynchronously read optional secret-rotation state for the VM without fabricating state when the dependency is disabled.
     * 中文：输入：id：目标资源标识
     * English: Inputs: id: target resource identifier
     */
    secrets: async (id) => host.optional(secretsServices.secrets)?.rotation(id),
    /**
     * 中文：在调用时获取容器服务，缺失抛出 409 前置条件错误；否则把实例、输入、取消及日志交给私有数据库操作。
     * English: Resolve containers on invocation and throw a prerequisite-409 error when absent; otherwise delegate VM/input/cancellation/logging to private-database work.
     * 中文：输入：id：目标资源标识；input：尚待校验的输入数据；signal：本次调用的取消寿命；log：此处理器的调用值
     * English: Inputs: id: target resource identifier; input: input data requiring validation; signal: cancellation lifetime for this invocation; log: the invocation value for this handler
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：拒绝原因：私有数据库需要启用容器插件。这些错误交给直接调用者或本函数 catch 处理
     * English: Refusal reasons: 私有数据库需要启用容器插件. These errors reach the direct caller or this function's catch handler
     */
    privateDatabase: async (id, input, signal, log) => {
      const service = host.optional(containersServices.containers);
      if (!service) throw new AppError('私有数据库需要启用容器插件', 409);
      await service.privateDatabase(id, input, signal, log);
    },
  }, {}, host.system));
  host.registerJobs(host.use(automationServices.suite).jobs, /**
   * 中文功能：根据 Job 动作解析可重建的软件包或工程操作，在原项目作用域重试；无法由动作字符串恢复完整输入时拒绝。
   * English: Parse reproducible package/engineering operations from the Job action and retry in its original project scope; reject when the action string cannot recover complete inputs.
   * 输入 / Inputs: job.
   * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
   * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
   * 设计思路：先用枚举限制动作和管理器，再交 retryInProject 恢复项目上下文；不通过猜测补齐 worktree 或数据库参数。
   * Design: Constrain actions/managers through enums before retryInProject restores project context; do not guess missing worktree/database parameters.
   */
  (job) => {
    const id = retryTarget(job);
    if (job.action?.startsWith('package:')) {
      const [operationValue, ...nameParts] = job.action.slice(8).split(':');
      const operation = z.enum(['list', 'search', 'install', 'remove', 'update', 'upgrade', 'upgrade-all',
        'cache-list', 'cache-prefetch', 'cache-install', 'cache-clear']).parse(operationValue);
      return retryInProject(host, job, () =>
        Promise.resolve(
          host.use(automationServices.suite).package(id, {
            operation,
            name: nameParts.join(':') || undefined,
          }),
        ),
      );
    }
    if (job.action?.startsWith('dev:')) {
      const [operationValue, managerValue] = job.action.slice(4).split(':');
      const operation = z
        .enum([
          'test',
          'test-discover',
          'lint',
          'format',
          'dependencies',
          'lock',
          'lock-check',
          'install-locked',
          'prefetch-dependencies',
          'install-cached-dependencies',
          'worktree-list',
          'worktree-add',
          'worktree-remove',
          'database',
        ])
        .parse(operationValue);
      // 带目标路径或数据库参数的任务无法仅由动作标识重建，重试必须回界面重新提交完整输入。
      if (['worktree-add', 'worktree-remove', 'database'].includes(operation))
        throw new AppError('此开发任务包含参数，请回到能力中心重新执行');
      const manager = ['prefetch-dependencies', 'install-cached-dependencies'].includes(operation)
        ? z.enum(['npm', 'pip']).parse(managerValue) : undefined;
      return retryInProject(host, job, () => Promise.resolve(host.use(automationServices.suite).dev(id, { operation, manager })));
    }
    throw new AppError('请回到原功能页面重新执行');
  });
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 */
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: Parameters<PluginRoute>[3],
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
  if (parts[1] === 'feature-suite' && parts.length === 2 && req.method === 'GET') {
    send(await this.use(automationServices.suite).catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && req.method === 'POST' && action === 'suspend')
    return send(await this.vm.suspend(id));
  if (parts.length === 4 && req.method === 'POST' && action === 'resume')
    return send(await this.vm.resume(id));
  if (parts.length === 4) {
    if (action === 'packages') {
      if (req.method === 'GET') {
        const mode = url.searchParams.get('mode') || 'installed';
        const query = url.searchParams.get('query') || '';
        const page = Number(url.searchParams.get('page') || 1);
        const limit = Number(url.searchParams.get('limit') || 50);
        return send(await this.use(automationServices.suite).packageWorkbench.query(id,
          { mode, query, page, limit }, signal));
      }
      if (req.method === 'POST')
        return send(await this.use(automationServices.suite).packageWorkbench.action(id, await body(req, signal), signal), 202);
    }
    if (action === 'advanced') {
      if (req.method === 'GET') {
        send(await this.use(automationServices.suite).view(id, Number(url.searchParams.get('limit') || 120)));
        return true;
      }
      if (req.method === 'PUT') {
        const input = await body(req, signal);
        if (input?.schedule || input?.alerts) this.require('automation-scheduler');
        send(await this.use(automationServices.suite).update(id, input));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.use(automationServices.suite).action(id, await body(req, signal), signal), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.feature-suite": route,
  "legacy.get.vms.vmId.advanced": route,
  "legacy.put.vms.vmId.advanced": route,
  "legacy.post.vms.vmId.advanced": route,
  "legacy.get.vms.vmId.packages": route,
  "legacy.post.vms.vmId.packages": route,
  "legacy.post.vms.vmId.suspend": route,
  "legacy.post.vms.vmId.resume": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("automation");
