/**
 * 模块职责（中文）：把任务状态、取消及执行结果映射为统一标签和说明，供任务列表与日志面板使用。
 * Module responsibility (English): Providing consistent presentation semantics for job states, execution outcomes and cancellation.
 * 详细范围（中文）：公开入口包括 taskLabels, jobPresentation；职责覆盖统一任务状态、执行结论和取消结果的显示语义，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include taskLabels, jobPresentation. The scope covers Providing consistent presentation semantics for job states, execution outcomes and cancellation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { JobView } from '../shared/contracts/jobs.ts';

export const taskLabels = { running: '执行中', done: '已完成', error: '失败', cancelled: '已取消', interrupted: '已中断' };
/**
 * 中文：把任务状态与执行/取消证据合成徽标、结论和日志显示字段，避免仅凭 done 状态把失败命令标成成功。
 * English: Combine job state with execution/cancellation evidence into badge/outcome/log presentation, avoiding success labels for failed commands merely because a job is done.
 * 中文：输入：job：签名所示 JobView 业务值
 * English: Inputs: job: the JobView domain value in the signature
 * 中文：结果：包含 state、label、detail、retryable 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing state, label, detail, retryable for caller state reads/operations
 */
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
