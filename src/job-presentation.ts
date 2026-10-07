/**
 * 模块职责：把任务状态、取消及执行结果映射为统一标签和说明，供任务列表与日志面板使用。
 */
import type { JobView } from '../shared/contracts/jobs.ts';

export const taskLabels = { running: '执行中', done: '已完成', error: '失败', cancelled: '已取消', interrupted: '已中断' };
export function jobPresentation(job: JobView) {
  if (job.admission === 'cleanup-pending' && !job.cleanupResolvedAt)
    return { state: 'cleanup-pending', label: '清理待确认', detail: '资源仍被保留，完成清理核对后才能再次执行。', retryable: false };
  if (job.status === 'running' && job.admission === 'queued')
    return { state: 'queued', label: '等待资源', detail: job.resourceWait?.reason || '任务已接收，正在等待可用额度。', retryable: false };
  if (job.status === 'running' && job.admission === 'cancelling')
    return { state: 'cancelling', label: '正在取消', detail: '正在等待进程、连接和文件操作结束。', retryable: false };
  if (job.status === 'interrupted')
    return { state: 'interrupted', label: '待核对', detail: '上次执行因重启中断，请核对结果后再决定是否重新执行。', retryable: true };
  return { state: job.status, label: taskLabels[job.status], detail: undefined, retryable: job.status !== 'running' };
}
