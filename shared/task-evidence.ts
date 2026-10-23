/** 任务与恢复记录的关联规则；上下文相同不等于因果相同。
 * Correlate jobs and recovery records without treating shared context as causal evidence. */
import type { JobView } from './contracts/jobs.ts';
import type { RecoveryView } from './contracts/recovery.ts';

/** 只用持久身份或确切资源 ID 确认关联；实例/项目匹配单独标记为参考。
 * Confirm links by durable identities or exact resource IDs; mark VM/project matches as contextual only. */
export function recoveryRelation(job: JobView, record: RecoveryView): 'direct' | 'context' | undefined {
  const { binding } = record;
  if (binding.vmId && job.vmId && binding.vmId !== job.vmId) return;
  if (binding.projectId && job.projectId && binding.projectId !== job.projectId) return;
  if ((job.id && (binding.jobId === job.id || binding.operationId === job.id)) ||
      (job.correlationId && binding.operationId === job.correlationId) ||
      [job.resourceLeaseId, job.cleanupLeaseId].some(id => id && record.resourceIds.includes(id))) return 'direct';
  if (job.vmId && binding.vmId === job.vmId &&
      (!job.projectId || !binding.projectId || job.projectId === binding.projectId)) return 'context';
}
