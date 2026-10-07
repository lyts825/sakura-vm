/**
 * 模块职责：解析任务重试目标并恢复项目上下文，缺少实例标识时拒绝重试。
 * Module purpose: Resolves retry VM targets and restores project context, refusing jobs without VM identity.
 */
import type { PluginContext } from '../plugin-api.ts';
import type { JobView } from '../../shared/contracts/jobs.ts';
import { AppError } from '../../shared/errors.ts';
import { services as projectsServices } from '../../plugins/projects/services.ts';

/**
 * 入口 / Entry: retryTarget.
 * 功能：在解析任务重试目标并恢复项目上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `id` 供上层消费（`plugins/retry.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugins/retry.ts`; this entry produces `id` for its caller. Module context: Resolves retry VM targets and restores project context, refusing jobs without VM identity.
 * 输入 / Inputs: job: JobView
 * 输出 / Returns: `id`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!id`; 异常 / errors `new AppError('任务缺少实例标识', 409)`.
 */
export function retryTarget(job: JobView) {
  const id = job.vmId || job.key;
  if (!id) throw new AppError('任务缺少实例标识', 409);
  return id;
}
/**
 * 入口 / Entry: retryInProject.
 * 功能：在解析任务重试目标并恢复项目上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `workspaces ? workspaces.projects.inScope(id, job.projectId || 'default', action) : action()` 供上层消费（`plugins/retry.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugins/retry.ts`; this entry produces `workspaces ? workspaces.projects.inScope(id, job.projectId || 'default', action) : action()` for its caller. Module context: Resolves retry VM targets and restores project context, refusing jobs without VM identity.
 * 处理：通过 `retryTarget`, `host.optional`, `workspaces.projects.inScope`, `action` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `retryTarget`, `host.optional`, `workspaces.projects.inScope`, `action`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: host: PluginContext; job: JobView; action: () => Promise<T>
 * 输出 / Returns: Promise<T>；结果来自 / values from `workspaces ? workspaces.projects.inScope(id, job.projectId || 'default', action) : action()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function retryInProject<T>(host: PluginContext, job: JobView, action: () => Promise<T>): Promise<T> {
  const id = retryTarget(job);
  const workspaces = host.optional(projectsServices.workspaces);
  return workspaces
    ? workspaces.projects.inScope(id, job.projectId || 'default', action)
    : action();
}
