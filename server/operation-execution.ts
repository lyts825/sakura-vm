/**
 * 模块职责：标识操作在业务效果发生前已拒绝，供结果记录区分拒绝与不确定执行状态。
 */
const refusals = new WeakMap<object, readonly string[] | undefined>();

/** Only a domain that has proved the requested effect has not begun may use this.
 * Authentication may still consume a challenge or count a failed attempt; this
 * marker confirms that no session or persistent account mutation was issued.
 * Never infer this guarantee from an HTTP status or exception type. */
export function rejectOperationBeforeEffect(error: object, operationIds?: readonly string[]): never {
  refusals.set(error, operationIds);
  throw error;
}

export function operationRefusedBeforeEffect(error: unknown, operationId: string) {
  if (error === null || typeof error !== 'object' || !refusals.has(error)) return false;
  const scope = refusals.get(error);
  return !scope || scope.includes(operationId);
}
