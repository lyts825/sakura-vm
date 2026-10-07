/**
 * 模块职责（中文）：“自动化调度”插件服务端入口。激活时装配 FeatureScheduler，并处理声明的服务端操作。
 * Module responsibility (English): service composition for scheduled start/stop, resource sampling and alerts, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route；职责覆盖装配计划启停、资源采样与告警的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route. The scope covers service composition for scheduled start/stop, resource sampling and alerts, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { services as automationServices } from '../automation/services.ts';
import { services as automationSchedulerServices } from './services.ts';
export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';
import { FeatureScheduler } from '../../server/feature-scheduler.ts';

/**
 * 中文：在本次插件激活中构造 FeatureScheduler，发布 automationSchedulerServices.scheduler 服务引用；依赖通过 host 获取，登记的任务和清理由本激活寿命拥有
 * English: Construct FeatureScheduler within this activation and publish automationSchedulerServices.scheduler service references. Resolve dependencies through host; this activation owns registered jobs/cleanup
 * 中文：输入：host：签名所示 PluginContext 业务值
 * English: Inputs: host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(host: PluginContext) {
  // 计划任务由独立插件持有；启用能力中心本身不会自动启动此调度器。
  host.provide(automationSchedulerServices.scheduler, new FeatureScheduler(host.use(automationServices.suite)));
}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Write operation-described responses; return false for unclaimed requests to the main router
 */
export async function route() {
  return false;
}
