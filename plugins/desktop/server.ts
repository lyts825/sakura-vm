/**
 * 模块职责（中文）：“Linux 图形桌面”插件服务端入口。激活时装配 Desktops，并处理声明的服务端操作。
 * Module responsibility (English): service composition for graphical desktops, single-application windows and clipboard policy, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 operations, activate, route, installIme, httpHandlers, responseContracts；职责覆盖装配图形桌面、单应用窗口与剪贴板的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include operations, activate, route, installIme, httpHandlers, responseContracts. The scope covers service composition for graphical desktops, single-application windows and clipboard policy, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as projectsServices } from '../projects/services.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as desktopServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation, PluginRoute } from '../../server/plugin-api.ts';
import { retryTarget, retryInProject } from '../../server/plugins/retry.ts';

import { AppError } from '../../shared/errors.ts';

import { Desktops } from '../../server/desktop.ts';
import { x11ClipboardRequest } from '../../server/x11-clipboard.ts';

export const operations: Record<string, PluginOperation> = {
  'x11-clipboard-get': { response: pluginRouteResponses["desktop.x11-clipboard-get"].schema, /** 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(desktopServices.x11Clipboard).view；进度和失败通过原任务服务契约交付 | English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(desktopServices.x11Clipboard).view; deliver progress/failure through the existing job-service contract | 中文：输入：url：此处理器的调用值；_：此处理器的调用值；signal：本次调用的取消寿命 | English: Inputs: url: the invocation value for this handler; _: the invocation value for this handler; signal: cancellation lifetime for this invocation */ execute(url, _, signal) {
    return this.use(desktopServices.x11Clipboard).view(url.pathname.split('/')[3], signal);
  } },
  'x11-clipboard-action': { request: x11ClipboardRequest, response: pluginRouteResponses["desktop.x11-clipboard-action"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(desktopServices.x11Clipboard).action；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(desktopServices.x11Clipboard).action; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据；signal：本次调用的取消寿命
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation; signal: cancellation lifetime for this invocation
     */
    execute(url, input, signal) { return this.use(desktopServices.x11Clipboard).action(url.pathname.split('/')[3], input, signal); } },
  'wayland-clipboard-get': { response: pluginRouteResponses["desktop.wayland-clipboard-get"].schema, /** 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(desktopServices.waylandClipboard).view；进度和失败通过原任务服务契约交付 | English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(desktopServices.waylandClipboard).view; deliver progress/failure through the existing job-service contract | 中文：输入：url：此处理器的调用值；_：此处理器的调用值；signal：本次调用的取消寿命 | English: Inputs: url: the invocation value for this handler; _: the invocation value for this handler; signal: cancellation lifetime for this invocation */ execute(url, _, signal) {
    return this.use(desktopServices.waylandClipboard).view(url.pathname.split('/')[3], signal);
  } },
  'wayland-clipboard-action': { request: x11ClipboardRequest, response: pluginRouteResponses["desktop.wayland-clipboard-action"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(desktopServices.waylandClipboard).action；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(desktopServices.waylandClipboard).action; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据；signal：本次调用的取消寿命
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation; signal: cancellation lifetime for this invocation
     */
    execute(url, input, signal) { return this.use(desktopServices.waylandClipboard).action(url.pathname.split('/')[3], input, signal); } },
};

/**
 * 中文：在本次插件激活中构造 Desktops，发布 desktopServices.desktops、desktopServices.jobs、desktopServices.x11Clipboard、desktopServices.waylandClipboard 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Desktops within this activation and publish desktopServices.desktops, desktopServices.jobs, desktopServices.x11Clipboard, desktopServices.waylandClipboard service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  const desktops = host.provide(desktopServices.desktops,
    new Desktops(m, host.use(projectsServices.workspaces), { deferInitialization: true }));
  // 先把桌面服务登记给宿主，再启动其初始化，确保生命周期管理已经拥有该服务。
  desktops.init();
  host.provide(desktopServices.jobs, host.capabilities.jobs.create('input-method', { historyName: 'input-method' }));
  host.registerJobs(host.use(desktopServices.jobs), (job) => retryInProject(host, job, async () => installIme.call(host, retryTarget(job))));
  host.provide(desktopServices.x11Clipboard, desktops.clipboard);
  host.registerJobs(host.use(desktopServices.x11Clipboard).jobs,
    (job) => host.use(desktopServices.x11Clipboard).install(retryTarget(job)));
  host.provide(desktopServices.waylandClipboard, desktops.waylandClipboard);
  host.registerJobs(host.use(desktopServices.waylandClipboard).jobs,
    (job) => host.use(desktopServices.waylandClipboard).install(retryTarget(job)));
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["desktop.legacy.post.vms.vmId.desktop"]
        、httpRouteRequests["desktop.legacy.post.vms.vmId.single-app"] 等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["desktop.legacy.post.vms.vmId.desktop"]
        , httpRouteRequests["desktop.legacy.post.vms.vmId.single-app"]. Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：停止桌面不能提交外观设置；请先启动发行版。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 停止桌面不能提交外观设置; 请先启动发行版. These errors reach the direct caller or this function's catch handler
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
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts[3] === 'desktop' && parts.length === 4) {
    if (req.method === 'GET') return send(await this.use(desktopServices.desktops).view(id));
    if (req.method === 'POST') {
      const { action, preferences } = httpRouteRequests["desktop.legacy.post.vms.vmId.desktop"]
        .parse(await body(req, signal));
      if (action === 'stop') {
        if (preferences) throw new AppError('停止桌面不能提交外观设置');
        return send(await this.use(desktopServices.desktops).stop(id));
      }
      return send(this.use(desktopServices.desktops).start(id, action, preferences), 202);
    }
  }
  if (action === 'single-app' && parts.length === 4) {
    if (req.method === 'GET') return send({ sessions: await this.use(desktopServices.desktops).apps.list(id),
      clipboardPolicies: await this.use(desktopServices.desktops).apps.clipboardPolicies(id) });
    if (req.method === 'POST') {
      const input = httpRouteRequests["desktop.legacy.post.vms.vmId.single-app"].parse(await body(req, signal));
      if (input.action === 'start') {
        const { action: _, ...options } = input;
        return send(await this.use(desktopServices.desktops).apps.start(id, options, signal), 201);
      }
      if (input.action === 'stop') return send(await this.use(desktopServices.desktops).apps.stop(id, input.id));
      if (input.action === 'clipboard-save')
        return send(await this.use(desktopServices.desktops).apps.saveClipboardPolicy(id, input.program,
          input.clipboard));
      return send(await this.use(desktopServices.desktops).apps.removeClipboardPolicy(id, input.program));
    }
  }
  if (parts.length === 4) {
    if (action === 'ime') {
      if (req.method === 'GET') {
        send(this.use(desktopServices.jobs).view(id));
        return true;
      }
      if (req.method === 'POST') {
        if (this.vm.state(id) !== 'running') throw new AppError('请先启动发行版');
        send(installIme.call(this, id), 202);
        return true;
      }
    }
  }
  return false;
}
/**
 * 中文：仅为运行中的原客户机提交输入法安装任务，捕获客户机对象和当前项目；任务前后核对对象未替换，进入原项目作用域执行，非零退出码报告失败。
 * English: Submit IME installation only for the original running guest, capturing its live object/current project. Check the object before/after work, execute in the original project scope and report nonzero exit as failure.
 * 中文：输入：this：签名所示 PluginContext 业务值；id：目标资源标识
 * English: Inputs: this: the PluginContext domain value in the signature; id: target resource identifier
 * 中文：拒绝原因：请先启动发行版。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 请先启动发行版. These errors reach the direct caller or this function's catch handler
 */
export function installIme(this: PluginContext, id: string) {
  if (this.vm.state(id) !== 'running') throw new AppError('请先启动发行版');
  const workspaces = this.use(projectsServices.workspaces);
  const live = this.vm.live.get(id), projectId = workspaces.projects.current(id);
  /**
   * 中文：核对捕获的客户机对象仍是 live 表中的同一对象且运行中，变化时抛 DESKTOP_SCOPE_CHANGED，禁止任务漂移到新启动客户机。
   * English: Check the captured live guest is still the same object and running; throw DESKTOP_SCOPE_CHANGED on change, preventing work drifting to a restarted guest.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   * 中文：拒绝原因：原客户机在输入法任务准备期间已改变；DESKTOP_SCOPE_CHANGED。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 原客户机在输入法任务准备期间已改变; DESKTOP_SCOPE_CHANGED. These errors reach the direct caller or this function's catch handler
   */
  const original = () => {
    if (!live || this.vm.live.get(id) !== live || this.vm.state(id) !== 'running')
      throw new AppError('原客户机在输入法任务准备期间已改变', 409, 'DESKTOP_SCOPE_CHANGED');
  };
  original();
  return this.use(desktopServices.jobs).start(id, /** 中文：为输入法任务保留捕获的项目作用域，执行前后检查原客户机对象；若有项目进入 inScope，无项目沿用实例作用域。 | English: Retain the captured project scope for IME work and check the original guest before/after execution; use inScope when a project exists, otherwise retain VM scope. | 中文：输入：log：此处理器的调用值；signal：本次调用的取消寿命 | English: Inputs: log: the invocation value for this handler; signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (log, signal) => {
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 signal.throwIfAborted；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to signal.throwIfAborted; deliver progress/failure through the existing job-service contract
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
     * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
     */
    const execute = async () => {
      signal.throwIfAborted(); original();
      const result = await this.use(desktopServices.desktops).installIme(id, signal, log);
      original();
      if (result.code !== 0) throw new AppError(result.stderr || '输入法安装失败', 409);
    };
    if (projectId) await workspaces.projects.inScope(id, projectId, execute);
    else await execute();
  }, { title: '安装中文输入法', vmId: id, projectId, action: 'install' });
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.desktop": route,
  "legacy.post.vms.vmId.desktop": route,
  "legacy.get.vms.vmId.single-app": route,
  "legacy.post.vms.vmId.single-app": route,
  "legacy.get.vms.vmId.ime": route,
  "legacy.post.vms.vmId.ime": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("desktop");
