import type { PluginContext } from '../plugin-api.ts';
import type { JobView } from '../jobs.ts';
import { AppError } from '../model.ts';

export function retryTarget(job: JobView) {
  const id = job.vmId || job.key;
  if (!id) throw new AppError('任务缺少实例标识', 409);
  return id;
}
export function retryInProject<T>(host: PluginContext, job: JobView, action: () => Promise<T>): Promise<T> {
  const id = retryTarget(job);
  return host.workspaces?.projects
    ? host.workspaces.projects.inScope(id, job.projectId || 'default', action)
    : action();
}
