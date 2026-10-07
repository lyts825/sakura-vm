/**
 * 模块职责（中文）：“平台扩展适配器”插件服务端入口。激活时装配 NextFeatures、ObjectBackup、WireGuardOverlay，并处理声明的服务端操作。
 * Module responsibility (English): service composition for remote, security, disaster-recovery and collaboration capabilities, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 operations, activate, route, httpHandlers, responseContracts；职责覆盖装配远程、安全、灾备与协作能力的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include operations, activate, route, httpHandlers, responseContracts. The scope covers service composition for remote, security, disaster-recovery and collaboration capabilities, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as projectsServices } from '../projects/services.ts';
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as backupsServices } from '../backups/services.ts';
import { services as snapshotsServices } from '../snapshots/services.ts';
import { services as secretsServices } from '../secrets/services.ts';
import { services as platformServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { NextFeatures } from '../../server/next-features.ts';
import { ObjectBackup } from '../../server/object-backup.ts';
import { WireGuardOverlay } from '../../server/wireguard-overlay.ts';

import { retryInProject, retryTarget } from '../../server/plugins/retry.ts';
import { AppError } from '../../shared/errors.ts';

import type { PluginOperation } from '../../server/plugin-api.ts';

export const operations: Record<string, PluginOperation> = {
  'browser-ide-link': {
    response: pluginRouteResponses["platform.browser-ide-link"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(platformServices.next).browserIdeLink；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(platformServices.next).browserIdeLink; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(platformServices.next).browserIdeLink(url.pathname.split('/')[3]);
    },
  },
  'notebook-link': {
    response: pluginRouteResponses["platform.notebook-link"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(platformServices.next).notebookLink；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(platformServices.next).notebookLink; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(platformServices.next).notebookLink(url.pathname.split('/')[3]);
    },
  },
};

/**
 * 中文：在本次插件激活中构造 NextFeatures、ObjectBackup、WireGuardOverlay，发布 platformServices.next 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct NextFeatures, ObjectBackup, WireGuardOverlay within this activation and publish platformServices.next service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  const service = host.provide(platformServices.next, new NextFeatures(m, host.use(projectsServices.workspaces), host.system, {
    // 备份、签名包和秘密服务在操作时查询；可选插件启停后适配器读取当前服务而非旧对象。
    objectBackup: new ObjectBackup(m, () => ({
      backups: host.optional(backupsServices.backups),
      bundles: host.optional(snapshotsServices.bundles),
      secrets: host.optional(secretsServices.secrets),
    })),
    wireGuardOverlay: new WireGuardOverlay(m, () => host.optional(secretsServices.secrets)),
    /**
     * 中文：调用时查询可选快照合并服务，未启用快照插件时不构造替代服务。
     * English: Resolve optional snapshot-merge service on invocation without constructing a replacement when snapshots are disabled.
     */
    snapshotMerge: () => host.optional(snapshotsServices.snapshotMerge),
  }));
  await service.init();
  host.registerJobs(host.use(platformServices.next).jobs, (job) => {
    if (!job.action?.startsWith('next:')) throw new AppError('请回到原功能页面重新执行');
    const featureId = job.action.slice('next:'.length);
    return retryInProject(host, job, () => Promise.resolve(host.use(platformServices.next).action(
      retryTarget(job), { action: 'run', featureId })));
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
  if (parts[1] === 'next-features' && parts.length === 2 && req.method === 'GET') {
    send(await this.use(platformServices.next).catalog());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'next-features') {
      if (req.method === 'GET') {
        send(await this.use(platformServices.next).view(id));
        return true;
      }
      if (req.method === 'POST') {
        send(await this.use(platformServices.next).action(id, await body(req, signal), signal), 202);
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.next-features": route,
  "legacy.get.vms.vmId.next-features": route,
  "legacy.post.vms.vmId.next-features": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("platform");
