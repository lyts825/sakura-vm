/**
 * 模块职责：按 POSIX shell 的单引号规则引用参数，供客户机固定命令安全传递字符串。
 * Module purpose: Quotes strings by POSIX single-quote rules for fixed guest commands.
 */
/** POSIX shell argument quoting; has no filesystem or service dependencies. */
/**
 * 入口 / Entry: quote.
 * 功能：从当前输入或状态计算 `"'" + value.replaceAll("'", "'\\''") + "'"`，供调用方后续验证或使用。
 * Purpose: Computes `"'" + value.replaceAll("'", "'\\''") + "'"` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `"'" + value.replaceAll("'", "'\\''") + "'"`.
 * 副作用 / Effects: `value.replaceAll`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
