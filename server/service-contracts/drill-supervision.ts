/** 宿主监管窄接口；票据按真实消费者核验，HTTP 不暴露授权方法。
 * Host supervision boundary; tickets are checked against real consumers, never HTTP-supplied identities. */
import type {
  DrillCapability,
  DrillDelegation,
  DrillEvidence,
  DrillIdentity,
  DrillPreparation,
  DrillSample,
  DrillToken,
} from '../../shared/contracts/drill-supervision.ts';
export interface DrillSupervisionV1 {
  capabilities(): Promise<DrillCapability>;
  prepare(input: DrillPreparation): Promise<DrillIdentity>;
  delegate(input: DrillDelegation): Promise<DrillToken>;
  arm(delegation: DrillToken): Promise<DrillToken>;
  recoverLease(delegation: DrillToken): Promise<DrillToken>;
  retireDelegation(delegation: DrillToken): Promise<DrillEvidence>;
  authorizeStep(lease: DrillToken, stepId: number): Promise<DrillToken>;
  inject(ticket: DrillToken, idempotencyKey: string): Promise<DrillEvidence>;
  observe(ticket: DrillToken): Promise<DrillEvidence>;
  probe(ticket: DrillToken, requestId: string): Promise<DrillSample>;
  recover(ticket: DrillToken): Promise<DrillEvidence>;
  contain(
    lease: DrillToken,
    reason: 'cancelled' | 'expired' | 'reconcile' | 'withdraw',
  ): Promise<DrillEvidence>;
  reconcile(lease: DrillToken): Promise<DrillEvidence>;
  release(lease: DrillToken): Promise<DrillEvidence>;
}
