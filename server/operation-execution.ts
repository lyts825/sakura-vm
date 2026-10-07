/**
 * 模块职责：标识操作在业务效果发生前已拒绝，供结果记录区分拒绝与不确定执行状态。
 * Module purpose: Marks rejection before business effects, distinguishing refusal from uncertain execution in durable outcomes.
 */
const refusals = new WeakMap<object, readonly string[] | undefined>();

/** Only a domain that has proved the requested effect has not begun may use this.
 * Authentication may still consume a challenge or count a failed attempt; this
 * marker confirms that no session or persistent account mutation was issued.
 * Never infer this guarantee from an HTTP status or exception type. */
/**
 * 入口 / Entry: rejectOperationBeforeEffect.
 * 功能：在标识操作在业务效果发生前已拒绝中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`operation-execution.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-execution.ts`; the calls and state transitions below complete the operation. Module context: Marks rejection before business effects, distinguishing refusal from uncertain execution in durable outcomes.
 * 处理：通过 `refusals.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `refusals.set`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: error: object; operationIds: readonly string[] optional
 * 输出 / Returns: never.
 * 副作用 / Effects: `refusals.set`.
 * 拒绝 / Refusals: 异常 / errors `error`.
 */
export function rejectOperationBeforeEffect(error: object, operationIds?: readonly string[]): never {
  refusals.set(error, operationIds);
  throw error;
}

/**
 * 入口 / Entry: operationRefusedBeforeEffect.
 * 功能：在标识操作在业务效果发生前已拒绝中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `!scope || scope.includes(operationId)` 供上层消费（`operation-execution.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `operation-execution.ts`; this entry produces `false` / `!scope || scope.includes(operationId)` for its caller. Module context: Marks rejection before business effects, distinguishing refusal from uncertain execution in durable outcomes.
 * 处理：通过 `refusals.has`, `refusals.get`, `scope.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `refusals.has`, `refusals.get`, `scope.includes`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `error === null || typeof error !== 'object' || !refusals.has(error)`.
 * 输入 / Inputs: error: unknown; operationId: string
 * 输出 / Returns: `false`; `!scope || scope.includes(operationId)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function operationRefusedBeforeEffect(error: unknown, operationId: string) {
  if (error === null || typeof error !== 'object' || !refusals.has(error)) return false;
  const scope = refusals.get(error);
  return !scope || scope.includes(operationId);
}
