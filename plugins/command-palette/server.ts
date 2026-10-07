/**
 * 模块职责（中文）：“快捷命令面板”插件服务端入口。提供插件入口和声明对应的请求处理。
 * Module responsibility (English): service composition for command search and navigation, publication of declared operations and lifecycle cleanup.
 * 详细范围（中文）：公开入口包括 activate, route；职责覆盖装配命令搜索与导航的服务，发布清单中声明的操作并随插件关闭清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include activate, route. The scope covers service composition for command search and navigation, publication of declared operations and lifecycle cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */

export { manifest } from './manifest.ts';
import type { PluginContext } from '../../server/plugin-api.ts';

/**
 * 中文：该插件仅贡献清单或界面，空激活满足宿主协议，不创建后台服务
 * English: This plugin contributes manifests/UI; empty activation satisfies the host protocol without creating background services
 * 中文：输入：_host：签名所示 PluginContext 业务值
 * English: Inputs: _host: the PluginContext domain value in the signature
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 */
export async function activate(_host: PluginContext) {}
/**
 * 中文：按 HTTP 方法与路径将本插件请求分派给领域服务；响应按操作描述写出，未认领请求返回 false 交回总路由
 * English: Dispatch this plugin's requests by HTTP method/path to domain services. Write operation-described responses; return false for unclaimed requests to the main router
 * 中文：结果：Promise<boolean>，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Promise<boolean> carrying the described computation/transport result; throwing branches do not provide success
 */
export async function route(): Promise<boolean> {
  return false;
}
