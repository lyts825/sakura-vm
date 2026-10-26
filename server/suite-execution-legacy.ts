/** 旧版服务边界仍使用冻结的五档案DTO；新增档案不扩展旧调用方的返回枚举。 */
import { SuiteExecutionSessions } from './suite-execution-sessions.ts';
import * as E from '../shared/contracts/suite-execution.ts';
import type { SuiteExecutionSessionsV1 } from './service-contracts/suite-execution.ts';
export function legacySuiteExecutionSessions(
  ...args: ConstructorParameters<typeof SuiteExecutionSessions>
): SuiteExecutionSessionsV1 & { init(): Promise<void>; close(): Promise<void> } {
  const runtime = new SuiteExecutionSessions(...args);
  return {
    init: () => runtime.init(),
    close: () => runtime.close(),
    tool: async () => E.suiteExecutionTool.parse(await runtime.tool()),
    preview: async (input) => E.suiteExecutionPlan.parse(await runtime.preview(input)),
    start: async (input, commit, authorize) =>
      E.suiteExecutionReceipt.parse(
        await runtime.start(
          input,
          async (challenge) => commit(E.suiteExecutionChallenge.parse(challenge)),
          authorize,
        ),
      ),
    inspect: async (input) => E.suiteExecutionReceipt.parse(await runtime.inspect(input)),
    cancel: async (input) => E.suiteExecutionReceipt.parse(await runtime.cancel(input)),
    reconcile: async (input) => E.suiteExecutionReceipt.parse(await runtime.reconcile(input)),
    release: async (input) => E.suiteExecutionReceipt.parse(await runtime.release(input)),
    discardPreview: async (input) => E.suiteExecutionPlan.parse(await runtime.discardPreview(input)),
    output: async (input) => E.suiteExecutionOutput.parse(await runtime.output(input)),
  };
}
