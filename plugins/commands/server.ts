/**
 * 模块职责（中文）：“收藏命令”插件服务端入口。激活时装配 CommandPresets，并处理声明的服务端操作。
 * Module responsibility (English): service composition for project command presets and execution, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, operations, route, responseContracts；职责覆盖装配项目命令预设与执行的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, operations, route, responseContracts. The scope covers service composition for project command presets and execution, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { services as commandsServices } from './services.ts';
import { services as projectsServices } from '../projects/services.ts';
export { manifest } from './manifest.ts';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';
import { z } from 'zod';
import { CommandPresets, presetSchema } from '../../server/command-presets.ts';
/**
 * 中文：在本次插件激活中构造 CommandPresets，发布 commandsServices.commands 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct CommandPresets within this activation and publish commandsServices.commands service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  host.provide(commandsServices.commands, new CommandPresets(host.vm, host.use(projectsServices.workspaces)));
}
/**
 * 中文：从已经匹配的实例路由第四个路径段提取实例 ID；资源存在性与授权由路由/领域能力继续检查。
 * English: Extract the VM ID from the fourth segment of an already matched VM route; routing/domain capabilities continue existence/authority checks.
 * 中文：输入：url：签名所示 URL 业务值
 * English: Inputs: url: the URL domain value in the signature
 */
const idFrom = (url: URL) => url.pathname.split('/')[3];

export const operations: Record<string, PluginOperation> = {
  list: {
    response: pluginRouteResponses["commands.list"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 idFrom；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to idFrom; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     * 中文：结果：包含 projectId、presets、job 的对象，字段供调用者读取状态或调用操作
     * English: Result: an object containing projectId, presets, job for caller state reads/operations
     */
    async execute(url) {
      const id = idFrom(url);
      this.vm.get(id);
      const workspaces = this.use(projectsServices.workspaces);
      const commands = this.use(commandsServices.commands);
      return {
        projectId: workspaces.projects.current(id),
        presets: await commands.list(id),
        job: commands.jobs.view(workspaces.projects.key(id)),
      };
    },
  },
  save: {
    request: presetSchema,
    response: pluginRouteResponses["commands.save"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(commandsServices.commands).save；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(commandsServices.commands).save; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return this.use(commandsServices.commands).save(idFrom(url), input);
    },
  },
  remove: {
    request: z.object({ id: z.uuid() }).strict(),
    response: pluginRouteResponses["commands.remove"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(commandsServices.commands).remove；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(commandsServices.commands).remove; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return this.use(commandsServices.commands).remove(idFrom(url), (input as { id: string }).id);
    },
  },
  run: {
    request: z.object({ id: z.uuid(), values: z.record(z.string(), z.string()).default({}) }).strict(),
    response: pluginRouteResponses["commands.run"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(commandsServices.commands).run；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(commandsServices.commands).run; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      const value = input as { id: string; values: Record<string, string> };
      return this.use(commandsServices.commands).run(idFrom(url), value.id, value.values);
    },
  },
};
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 */
export async function route(): Promise<boolean> {
  return false;
}

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("commands");
