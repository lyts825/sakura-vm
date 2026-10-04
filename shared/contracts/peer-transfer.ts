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
