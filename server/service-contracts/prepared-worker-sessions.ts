/** 宿主审核的固定工具会话。 Host-reviewed prepared tool sessions, never arbitrary commands. */
import type { z } from 'zod';
import type {
  workerPlanInputSchema,
  PreparedWorkerPlan,
  PreparedWorkerReceipt,
  IntegrationWorkerChallenge,
  IntegrationWorkerEvent,
} from '../../shared/contracts/integration-worker.ts';
export interface PreparedWorkerHooks {
  commitIntent(
    challenge: IntegrationWorkerChallenge,
  ): Promise<{ intentDigest: string; secretHeaders: Record<string, string> }>;
  observe(event: IntegrationWorkerEvent): Promise<void>;
}
export interface PreparedWorkerSessionsV1 {
  tool(): Promise<{ id: 'integration-http-v1'; digest: string }>;
  preview(input: z.infer<typeof workerPlanInputSchema>): Promise<PreparedWorkerPlan>;
  /** 顶层回调由服务代理恢复消费者权限，并持续核对双方代次。 Top-level callbacks retain broker authority. */
  start(
    planId: string,
    digest: string,
    commitIntent: PreparedWorkerHooks['commitIntent'],
    observe: PreparedWorkerHooks['observe'],
  ): Promise<PreparedWorkerReceipt>;
  inspect(receipt: PreparedWorkerReceipt): Promise<PreparedWorkerReceipt>;
  wait(receipt: PreparedWorkerReceipt): Promise<PreparedWorkerReceipt>;
  stop(receipt: PreparedWorkerReceipt): Promise<PreparedWorkerReceipt>;
}
