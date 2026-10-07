/**
 * 模块职责（中文）：领域恢复票据、来源和证明契约，绑定恢复目标、摘要及令牌以校验恢复请求。
 * Module responsibility (English): original domain-recovery tickets, origins and completion proofs.
 * 详细范围（中文）：公开入口包括 recoveryOriginSchema, RecoveryOrigin, domainRecoveryTicketSchema, DomainRecoveryTicket, DomainRecoveryPort, domainRecoveryProofSchema, DomainRecoveryProof；职责覆盖原领域恢复票据、来源和完成证明，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include recoveryOriginSchema, RecoveryOrigin, domainRecoveryTicketSchema, DomainRecoveryTicket, DomainRecoveryPort, domainRecoveryProofSchema, DomainRecoveryProof. The scope covers original domain-recovery tickets, origins and completion proofs. Types, validation branches and cleanup paths define its data/behavior boundaries
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
  /**
   * 中文：声明列出领域原始恢复票据的异步能力，票据包含修订、原归属与可恢复证据，供目录核对。
   * English: Declare asynchronous enumeration of original domain recovery tickets carrying revision/original ownership/recoverability evidence for catalog reconciliation.
   * 中文：结果：Promise<DomainRecoveryTicket[]>；调用者依赖此类型约定，Promise 拒绝表示异步失败
   * English: Result: Promise<DomainRecoveryTicket[]>; callers depend on this type contract, with promise rejection representing asynchronous failure
   */
  recoveryTickets(): Promise<DomainRecoveryTicket[]>;
  /**
   * 中文：声明由原领域核对完整原票据并恢复到其持久终态的能力；成功兑现需领域确认，不能只凭通用任务状态完成。
   * English: Declare recovery by the original domain after verifying its full original receipt and durable terminal state; successful fulfillment requires domain confirmation, not a generic job status.
   * 中文：输入：ticket：签名所示 DomainRecoveryTicket 业务值
   * English: Inputs: ticket: the DomainRecoveryTicket domain value in the signature
   * 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败
   * English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure
   */
  recoverTicket(ticket: DomainRecoveryTicket): Promise<void>;
}

export const domainRecoveryProofSchema = z.object({
  id: token, revision: digest, origin: recoveryOriginSchema.optional(), confirmedAt: z.iso.datetime(),
}).strict();
export type DomainRecoveryProof = z.infer<typeof domainRecoveryProofSchema>;
