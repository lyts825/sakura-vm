/**
 * 模块职责：提供发布构建使用的网络运行时入口，复用统一网络作用域与运行时实例。
 */
// Standalone CLI/setup transport. Shares the controller implementation and worker asset.
export { networkFor, networkRuntime } from './network/index.ts';
