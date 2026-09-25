import type { JobView } from '../server/jobs';
import type { VMView } from '../server/model';
import type { Project } from '../server/workspaces';
import type { Request } from './feature-shared';

export type ProjectAction = 'setup' | 'start' | 'stop' | 'terminal';

function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function executeProjectAction({
  request,
  vm,
  project,
  kind,
  refresh,
  signal,
}: {
  request: Request;
  vm: VMView;
  project: Project;
  kind: ProjectAction;
  refresh: () => Promise<unknown>;
  signal: AbortSignal;
}) {
  signal.throwIfAborted();
  if (vm.status !== 'running') await request(`/vms/${vm.id}/start`, 'POST', undefined, signal);
  const bootDeadline = Date.now() + 300000;
  while (true) {
    signal.throwIfAborted();
    if (Date.now() >= bootDeadline) throw new Error('启动超时');
    const state = await request<VMView>(`/vms/${vm.id}`, 'GET', undefined, signal);
    signal.throwIfAborted();
    if (state.status === 'running') break;
    if (['stopped', 'error', 'stopping'].includes(state.status))
      throw new Error(state.lastError || '启动未完成');
    await pause(1000, signal);
  }
  await refresh();
  const installDeadline = Date.now() + 1200000;
  while (true) {
    signal.throwIfAborted();
    const state = await request<{ job: JobView | null }>(`/vms/${vm.id}/project`, 'GET', undefined, signal);
    signal.throwIfAborted();
    if (state.job?.status !== 'running') break;
    if (Date.now() >= installDeadline) throw new Error('请等待当前安装结束');
    await pause(2000, signal);
  }
  // A boot or installation may finish after the panel has gone away. Never
  // submit that panel's old configuration or start a new job after cancellation.
  if (kind !== 'stop') await request(`/vms/${vm.id}/project`, 'PUT', project, signal);
  signal.throwIfAborted();
  await request(`/vms/${vm.id}/project`, 'POST', { action: kind }, signal);
}
