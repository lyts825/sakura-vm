/**
 * 模块职责：解析任务重试目标并恢复项目上下文，缺少实例标识时拒绝重试。
 */
import type { PluginContext } from '../plugin-api.ts';
import type { JobView } from '../../shared/contracts/jobs.ts';
import { AppError } from '../../shared/errors.ts';
import { services as projectsServices } from '../../plugins/projects/services.ts';

export function retryTarget(job: JobView) {
  const id = job.vmId || job.key;
  if (!id) throw new AppError('任务缺少实例标识', 409);
  return id;
}
export function retryInProject<T>(host: PluginContext, job: JobView, action: () => Promise<T>): Promise<T> {
  const id = retryTarget(job);
  const workspaces = host.optional(projectsServices.workspaces);
  return workspaces
    ? workspaces.projects.inScope(id, job.projectId || 'default', action)
    : action();
}
