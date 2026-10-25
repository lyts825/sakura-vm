/**
 * 模块职责（中文）：“资源采样”插件服务端入口。激活时装配 Metrics，并处理声明的服务端操作。
 * Module responsibility (English): service composition for guest resource and process sampling, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, operations, route, responseContracts；职责覆盖装配客户机资源与进程采样的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, operations, route, responseContracts. The scope covers service composition for guest resource and process sampling, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { pluginRouteResponses, pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { services as metricsServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';

import { Metrics } from '../../server/metrics.ts';
import type { PluginOperation } from '../../server/plugin-api.ts';
import { IncidentSnapshotProvider } from '../../server/incident-snapshot-provider.ts';
import { suiteJson } from '../../shared/contracts/suite-common.ts';
/**
 * 中文：在本次插件激活中构造 Metrics，发布 metricsServices.metrics 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct Metrics within this activation and publish metricsServices.metrics service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  const metrics = host.provide(metricsServices.metrics, new Metrics(host.capabilities.vm));
  host.provide(metricsServices.snapshots, new IncidentSnapshotProvider('metrics',
    (target, work) => host.capabilities.execution.run(target, work),
    async target => suiteJson.parse(await metrics.sample(target.vmId))));
}
export const operations: Record<string, PluginOperation> = {
  sample: {
    response: pluginRouteResponses["metrics.sample"].schema,
    /**
     * 中文：执行登记的 插件 任务，将任务上下文和校验后的资源参数交给 this.use(metricsServices.metrics).sample；进度和失败通过原任务服务契约交付
     * English: Execute the registered plugin job, delegating its context and validated resource arguments to this.use(metricsServices.metrics).sample; deliver progress/failure through the existing job-service contract
     * 中文：输入：url：此处理器的调用值
     * English: Inputs: url: the invocation value for this handler
     */
    execute(url) {
      return this.use(metricsServices.metrics).sample(url.pathname.split('/')[3]);
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
export const responseContracts = pluginResponseContracts("metrics");
