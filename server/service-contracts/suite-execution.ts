/** 五种固定会话分别注册；没有任意工具名、命令或路径输入。 */
import type { z } from 'zod';
import type * as E from '../../shared/contracts/suite-execution.ts';
export interface SuiteExecutionSessionsV1 {
  tool(): Promise<z.infer<typeof E.suiteExecutionTool>>;
  preview(input: z.infer<typeof E.suiteExecutionPreview>): Promise<E.SuiteExecutionPlan>;
  start(
    input: z.infer<typeof E.suiteExecutionApproval>,
    commitIntent: (challenge: E.SuiteExecutionChallenge) => Promise<{ intentDigest: string }>,
    authorize: () => Promise<void>,
  ): Promise<E.SuiteExecutionReceipt>;
  inspect(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  cancel(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  reconcile(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  release(input: z.infer<typeof E.suiteExecutionPin>): Promise<E.SuiteExecutionReceipt>;
  discardPreview(input: z.infer<typeof E.suiteExecutionApproval>): Promise<E.SuiteExecutionPlan>;
  output(input: z.infer<typeof E.suiteExecutionOutputInput>): Promise<z.infer<typeof E.suiteExecutionOutput>>;
}
export interface BrowserSessionsV1 extends SuiteExecutionSessionsV1 {}
export interface DatabaseRehearsalV1 extends SuiteExecutionSessionsV1 {}
export interface EventSessionsV1 extends SuiteExecutionSessionsV1 {}
export interface MediaTasksV1 extends SuiteExecutionSessionsV1 {}
export interface LearningToolSessionsV1 extends SuiteExecutionSessionsV1 {}
