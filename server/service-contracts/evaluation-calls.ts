import type * as C from '../../shared/contracts/evaluation-calls.ts';
/** 本体只能调用已选本机模型；每次调用具有原消费者和持久意图。 */
export interface EvaluationCallsV1 {
  check(
    target: C.EvaluationTarget,
    authorize: () => Promise<C.EvaluationAuthorization>,
  ): Promise<C.EvaluationConnection>;
  execute(
    input: C.EvaluationCallInput,
    commitIntent: (requestDigest: string) => Promise<C.EvaluationAuthorization & { intentDigest: string }>,
  ): Promise<C.EvaluationCallReceipt>;
  inspect(id: string): Promise<C.EvaluationCallReceipt>;
  cancel(id: string): Promise<C.EvaluationCallReceipt>;
}
