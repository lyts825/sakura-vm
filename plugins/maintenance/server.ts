/**
 * 模块职责（中文）：“磁盘与诊断”插件服务端入口。激活时装配 Maintenance，并处理声明的服务端操作。
 * Module responsibility (English): service composition for VM diagnostics, disk growth and maintenance, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route, httpHandlers, responseContracts；职责覆盖装配实例诊断、磁盘扩容与整理的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route, httpHandlers, responseContracts. The scope covers service composition for VM diagnostics, disk growth and maintenance, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { services as maintenanceServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';

import { AppError } from '../../shared/errors.ts';

import { Maintenance } from '../../server/maintenance.ts';
import { retryTarget } from '../../server/plugins/retry.ts';
import { CleanupPlans } from '../../server/cleanup-plan.ts';
import { backupBlocks } from '../../server/backup-blocks.ts';
import { maintenanceActions } from '../../server/delegated-maintenance.ts';

const cleanupCenters = new WeakMap<PluginContext, CleanupPlans>();

/**
 * 中文：在本次插件激活中构造 Maintenance，发布 maintenanceServices.maintenance 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Maintenance within this activation and publish maintenanceServices.maintenance service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const cleanup = new CleanupPlans();
  cleanup.register({ id: 'backup-blocks', label: '未引用备份块', description: '完整核验备份引用后回收孤儿块。',
    snapshot: (signal) => backupBlocks().cleanupSnapshot(signal),
    execute: (revision, signal) => backupBlocks().cleanupExecute(revision, signal) });
  const retention = () => {
    const service = host.system.optional('retention');
    if (!service) throw new AppError('日志保留服务暂不可用', 503);
    return service;
  };
  cleanup.register({ id: 'job-logs', label: '已完成任务日志', description: '按现有保留期限和容量清理成功任务的日志正文。',
    snapshot: () => retention().cleanupSnapshot(), execute: (revision, signal) => retention().cleanupExecute(revision, signal) });
  cleanupCenters.set(host, cleanup);
  host.onDispose(async () => { await cleanup.close(); cleanupCenters.delete(host); });
  const actions = maintenanceActions(host.capabilities.metadata.reference('delegated-actions', () => null), cleanup);
  host.onDispose(() => actions.close());
  await actions.init();
  host.provide(maintenanceServices.actions, actions);
  const m = host.vm;
  const maintenance = host.provide(maintenanceServices.maintenance, new Maintenance(m, { deferInitialization: true }));
  // 服务先纳入宿主再初始化维护工作，避免激活中的后台资源失去所属插件。
  maintenance.init();
  host.registerJobs(host.use(maintenanceServices.maintenance).jobs, (job) => {
    const id = retryTarget(job);
    if (job.action === 'diagnose') return host.use(maintenanceServices.maintenance).diagnose(id);
    if (job.action === 'finish-resize') return host.use(maintenanceServices.maintenance).finishResize(id);
    if (job.action === 'trim' || job.action === 'compact') return host.use(maintenanceServices.maintenance).diskRun(id, job.action);
    throw new AppError('请回到原功能页面重新执行');
  });
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；用 httpRouteRequests["maintenance.legacy.post.vms.vmId.disk-maintenance"]
        、httpRouteRequests["maintenance.legacy.post.vms.vmId.resize"]
         等公开 Schema 校验输入，响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Validate input with public schemas including httpRouteRequests["maintenance.legacy.post.vms.vmId.disk-maintenance"]
        , httpRouteRequests["maintenance.legacy.post.vms.vmId.resize"]
        . Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：输入：this：签名所示 PluginContext 业务值；req：签名所示 IncomingMessage 业务值；res：签名所示 ServerResponse 业务值；url：签名所示 URL 业务值；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命
 * English: Inputs: this: the PluginContext domain value in the signature; req: the IncomingMessage domain value in the signature; res: the ServerResponse domain value in the signature; url: the URL domain value in the signature; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：请输入目标磁盘容量。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 请输入目标磁盘容量. These errors reach the direct caller or this function's catch handler
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
  if (parts[1] === 'cleanup') {
    const cleanup = cleanupCenters.get(this);
    if (!cleanup) throw new AppError('清理中心未激活', 503);
    if (parts.length === 2 && req.method === 'GET') { send(cleanup.list()); return true; }
    if (parts.length === 3 && parts[2] === 'preview' && req.method === 'POST') {
      const input = httpRouteRequests['maintenance.cleanup.preview'].parse(await body(req, signal));
      send(await cleanup.preview(input.provider, signal)); return true;
    }
    if (parts.length === 3 && parts[2] === 'execute' && req.method === 'POST') {
      const input = httpRouteRequests['maintenance.cleanup.execute'].parse(await body(req, signal));
      send(await cleanup.execute(input.provider, input.token, signal)); return true;
    }
    return false;
  }
  if (parts[1] === 'storage' && parts.length === 2 && req.method === 'GET') {
    send(await this.use(maintenanceServices.maintenance).storage());
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4 && action === 'disk-maintenance') {
    if (req.method === 'GET') return send(await this.use(maintenanceServices.maintenance).diskView(id));
    if (req.method === 'PUT') return send(await this.use(maintenanceServices.maintenance).diskPolicy(id, await body(req, signal)));
    if (req.method === 'POST') {
      const input = httpRouteRequests["maintenance.legacy.post.vms.vmId.disk-maintenance"]
        .parse(await body(req, signal));
      return send(this.use(maintenanceServices.maintenance).diskRun(id, input.mode), 202);
    }
  }
  if (parts.length === 4) {
    if (action === 'diagnostics') {
      if (req.method === 'GET') {
        send({ report: this.use(maintenanceServices.maintenance).report(id), job: this.use(maintenanceServices.maintenance).jobs.view(id) });
        return true;
      }
      if (req.method === 'POST') {
        send(this.use(maintenanceServices.maintenance).diagnose(id), 202);
        return true;
      }
    }
  }
  if (parts.length === 4) {
    if (action === 'resize' && req.method === 'POST') {
      const value = httpRouteRequests["maintenance.legacy.post.vms.vmId.resize"]
        .parse(await body(req, signal));
      if (value.finish) send(this.use(maintenanceServices.maintenance).finishResize(id), 202);
      else if (value.diskGiB) send(this.use(maintenanceServices.maintenance).resize(id, value.diskGiB), 202);
      else throw new AppError('请输入目标磁盘容量');
      return true;
    }
  }
  if (parts.length === 4) {
    if (action === 'compact' && req.method === 'POST') {
      send(this.use(maintenanceServices.maintenance).compact(id), 202);
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  'cleanup.providers': route,
  'cleanup.preview': route,
  'cleanup.execute': route,
  "legacy.get.storage": route,
  "legacy.get.vms.vmId.diagnostics": route,
  "legacy.post.vms.vmId.diagnostics": route,
  "legacy.post.vms.vmId.resize": route,
  "legacy.post.vms.vmId.compact": route,
  "legacy.get.vms.vmId.disk-maintenance": route,
  "legacy.put.vms.vmId.disk-maintenance": route,
  "legacy.post.vms.vmId.disk-maintenance": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("maintenance");
