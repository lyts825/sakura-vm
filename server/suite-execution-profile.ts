/** 本体构造的固定档案；不通过公共服务接收命令、工具路径或档案选择器。 */
import type { z } from 'zod';
import type { SuiteExecutionProfileId, SuiteExecutionReceipt } from '../shared/contracts/suite-execution.ts';
export interface SuiteExecutionProfile {
  readonly id: SuiteExecutionProfileId;
  readonly consumers: readonly string[];
  readonly input: z.ZodType;
  readonly worker: URL;
  readonly probe: string;
  readonly probeResult: (stdout: string) => Record<string, string>;
  readonly outcome: (result: unknown) => SuiteExecutionReceipt['outcome'];
  readonly memoryMiB: number;
  readonly cpus: number;
  readonly maximumSeconds: number;
  readonly maximumInputBytes: number;
  readonly maximumOutputBytes: number;
}
