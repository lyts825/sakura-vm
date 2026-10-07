/**
 * 模块职责：领域恢复票据、来源和证明契约，绑定恢复目标、摘要及令牌以校验恢复请求。
 */
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const token = z.string().min(1).max(200).regex(/^[^\x00-\x1f\x7f]+$/);
/** Legacy domain receipts omit this field; a new activation never supplies a legacy identity. */
export const recoveryOriginSchema = z.object({
  owner: token, pluginId: token.optional(), pluginInstanceId: token.optional(),
  pluginGeneration: token.optional(), artifactDigest: digest.optional(), operationId: token.optional(),
  resourceIds: z.array(token).max(8192),
}).strict();
export type RecoveryOrigin = z.infer<typeof recoveryOriginSchema>;
export const domainRecoveryTicketSchema = z.object({
  id: token, revision: digest, vmId: token, projectId: token.optional(),
  origin: recoveryOriginSchema.optional(), state: z.enum(['pending', 'resolved']), available: z.boolean(),
  error: z.string().max(1024).optional(),
}).strict();
export type DomainRecoveryTicket = z.infer<typeof domainRecoveryTicketSchema>;
/** A domain verifies its complete original receipt and confirms its own durable terminal state. */
// 恢复证明必须由原业务领域确认持久化终态；控制面不能仅凭通用任务状态宣告业务已经恢复。
export interface DomainRecoveryPort {
  recoveryTickets(): Promise<DomainRecoveryTicket[]>;
  recoverTicket(ticket: DomainRecoveryTicket): Promise<void>;
}

export const domainRecoveryProofSchema = z.object({
  id: token, revision: digest, origin: recoveryOriginSchema.optional(), confirmedAt: z.iso.datetime(),
}).strict();
export type DomainRecoveryProof = z.infer<typeof domainRecoveryProofSchema>;
