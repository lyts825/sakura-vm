/**
 * 模块职责（中文）：跨主机激活、副本检查和退役请求/结果契约，约束主机协作的资源身份。
 * Module responsibility (English): cross-host replica activation, checking and retirement.
 * 详细范围（中文）：公开入口包括 peerActivationInput, peerReplicaActivationInput, peerActivationResult, peerActivationCheckResult, peerRetirementResult；职责覆盖跨主机副本激活、检查与退役，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include peerActivationInput, peerReplicaActivationInput, peerActivationResult, peerActivationCheckResult, peerRetirementResult. The scope covers cross-host replica activation, checking and retirement. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

/** Immutable import authority shared by source coordination and target validation. */
export const peerActivationInput = z.object({
  transferId: z.uuid(), remoteVmId: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const peerReplicaActivationInput = peerActivationInput.safeExtend({ sourceVmId: z.uuid(), snapshotId: z.uuid() });
export const peerActivationResult = z.object({
  id: z.uuid(), status: z.enum(['stopped', 'starting', 'running', 'paused', 'stopping', 'error']),
}).strict();
export const peerActivationCheckResult = z.object({
  ready: z.literal(true), id: z.uuid(), status: peerActivationResult.shape.status,
}).strict();
export const peerRetirementResult = z.object({ id: z.uuid(), retired: z.literal(true) }).strict();
