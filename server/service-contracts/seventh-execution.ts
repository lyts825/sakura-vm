/** 四个固定工程档案各有独立服务标识，不开放profile选择器。 */
import type { z } from 'zod';
import type * as E from '../../shared/contracts/seventh-execution.ts';
import type { SeventhComputePortV1 } from '../../shared/contracts/seventh-common.ts';
export interface SuiteExecutionSessionsV1 {
  tool(): Promise<z.infer<typeof E.suiteExecutionTool>>;
  preview(input: z.infer<typeof E.suiteExecutionPreview>): Promise<E.SuiteExecutionPlan>;
  start(
    input: z.infer<typeof E.suiteExecutionApproval>,
    commitIntent: (challenge: E.SuiteExecutionChallenge) => Promise<{ intentDigest: string }>,
    authorize: () => Promise<void>,
  ): Promise<E.SuiteExecutionReceipt>;
  inspect(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  resolve(input: { workspaceId: string; planId: string }): Promise<E.SuiteExecutionReceipt | null>;
  cancel(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  reconcile(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  release(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  discardPreview(input: z.infer<typeof E.suiteExecutionApproval>): Promise<E.SuiteExecutionPlan>;
  output(input: z.infer<typeof E.suiteExecutionOutputInput>): Promise<z.infer<typeof E.suiteExecutionOutput>>;
}
export interface SchedulerProbeSessionsV1 extends SuiteExecutionSessionsV1 {}
export interface ExtensionBuildSessionsV1 extends SuiteExecutionSessionsV1 {}
export interface ProtocolScenarioSessionsV1 extends SuiteExecutionSessionsV1, SeventhComputePortV1 {}
export interface MultiServiceVirtualizationSessionsV1
  extends SuiteExecutionSessionsV1, SeventhComputePortV1 {}
