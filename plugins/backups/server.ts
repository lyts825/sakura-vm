/**
 * 模块职责（中文）：“备份策略”插件服务端入口。激活时装配 Backups、BackupRecovery，并处理声明的服务端操作。
 * Module responsibility (English): service composition for backup policy, retention and file recovery, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, operations, route, httpHandlers, responseContracts；职责覆盖装配备份策略、保留与文件恢复的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, operations, route, httpHandlers, responseContracts. The scope covers service composition for backup policy, retention and file recovery, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as snapshotsServices } from '../snapshots/services.ts';
import { services as secretsServices } from '../secrets/services.ts';
import { services as transfersServices } from '../transfers/services.ts';
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as backupsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginOperation } from '../../server/plugin-api.ts';

import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';

import { Backups } from '../../server/backups.ts';
import { retryTarget } from '../../server/plugins/retry.ts';
import { BackupRecovery } from '../../server/backup-recovery.ts';
import { backupRecoverySchema } from '../../shared/backup-recovery.ts';


/**
 * 中文：在本次插件激活中构造 Backups、BackupRecovery，发布 backupsServices.backups、backupsServices.backupRecovery 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Backups, BackupRecovery within this activation and publish backupsServices.backups, backupsServices.backupRecovery service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const m = host.vm;
  host.provide(backupsServices.backups, new Backups(m, host.use(snapshotsServices.bundles), host.use(secretsServices.secrets)));
  host.registerJobs(host.use(backupsServices.backups).jobs, (job) => {
    // 只复用可重建输入的备份运行任务；文件恢复必须重新选择备份和目标，不能从任务日志猜测输入。
    if (job.action !== 'run') throw new AppError('请回到原功能页面重新执行');
    return host.use(backupsServices.backups).run(retryTarget(job));
  });
  const recovery = host.provide(backupsServices.backupRecovery, new BackupRecovery(m, host.use(backupsServices.backups), host.use(snapshotsServices.bundles)));
  await recovery.init();
  host.registerJobs(recovery.jobs, () => {
    throw new AppError('请在备份文件恢复面板重新选择备份和文件', 409);
  });
}
export const operations: Record<string, PluginOperation> = {
  'recovery-view': {
    response: pluginRouteResponses["backups.recovery-view"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(backupsServices.backupRecovery).view；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(backupsServices.backupRecovery).view; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(backupsServices.backupRecovery).view(url.pathname.split('/')[3]);
    },
  },
  'recovery-run': {
    request: backupRecoverySchema,
    response: pluginRouteResponses["backups.recovery-run"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(backupsServices.backupRecovery).run；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(backupsServices.backupRecovery).run; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值；input：尚待校验的输入数据
     * English: Inputs: url: the invocation value for this handler; input: input data requiring validation
     */
    execute(url, input) {
      return this.use(backupsServices.backupRecovery).run(url.pathname.split('/')[3], input);
    },
  },
  'recovery-artifact': {
    response: pluginRouteResponses["backups.recovery-artifact"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(backupsServices.backupRecovery).artifact；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(backupsServices.backupRecovery).artifact; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(backupsServices.backupRecovery).artifact(
        url.pathname.split('/')[3],
        z.uuid().parse(url.searchParams.get('run')),
        z.uuid().parse(url.searchParams.get('artifact')),
      );
    },
  },
};
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["backups.legacy.post.vms.vmId.backup-download"]
        、httpRouteRequests["backups.legacy.post.vms.vmId.backups"]
           等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["backups.legacy.post.vms.vmId.backup-download"]
        , httpRouteRequests["backups.legacy.post.vms.vmId.backups"]
          . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：请选择备份。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 请选择备份. These errors reach the direct caller or this function's catch handler
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
  if (parts.length === 4) {
    if (action === 'backup-download' && req.method === 'POST') {
      const input = httpRouteRequests["backups.legacy.post.vms.vmId.backup-download"]
        .parse(await body(req, signal));
      const content = await this.use(backupsServices.backups).downloadable(id, input.backupId);
      send(
        content.type === 'stream'
          ? this.use(transfersServices.downloads).issueStream(id, content)
          : await this.use(transfersServices.downloads).issueLocal(id, { path: content.path, name: content.name }),
      );
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'backups') {
      if (req.method === 'GET') {
        send(await this.use(backupsServices.backups).view(id));
        return true;
      }
      if (req.method === 'PUT') {
        send(await this.use(backupsServices.backups).policy(id, await body(req, signal)));
        return true;
      }
      if (req.method === 'POST') {
        const input = httpRouteRequests["backups.legacy.post.vms.vmId.backups"]
          .parse(await body(req, signal));
        if (input.action === 'run') send(await this.use(backupsServices.backups).run(id, input.password), 202);
        else {
          if (!input.backupId) throw new AppError('请选择备份');
          send(await this.use(backupsServices.backups).operate(id, input.backupId, input.action, input.name, input.password));
        }
        return true;
      }
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.get.vms.vmId.backups": route,
  "legacy.put.vms.vmId.backups": route,
  "legacy.post.vms.vmId.backups": route,
  "legacy.post.vms.vmId.backup-download": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("backups");
