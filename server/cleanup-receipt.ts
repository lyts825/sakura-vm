/**
 * 模块职责：用 WeakSet 登记原资源的清理函数，使普通函数无法冒充清理回执能力。
 * Module purpose: Registers original resource cleanup functions in a WeakSet; registration identifies a capability, not completed cleanup.
 */
const receipts = new WeakSet<Function>();
/** 仅由宿主或领域适配器登记已有资源的零参数清理函数；标记本身不证明资源已经释放。 */
/**
 * 入口 / Entry: cleanupReceipt.
 * 功能：从当前输入或状态计算 `work`，供调用方后续验证或使用。
 * Purpose: Computes `work` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: work: T
 * 输出 / Returns: T；结果来自 / values from `work`.
 * 副作用 / Effects: `receipts.add`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function cleanupReceipt<T extends () => unknown>(work: T): T { receipts.add(work); return work; }
/**
 * 入口 / Entry: isCleanupReceipt.
 * 功能：从当前输入或状态计算 `typeof value === 'function' && receipts.has(value)`，供调用方后续验证或使用。
 * Purpose: Computes `typeof value === 'function' && receipts.has(value)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: value is () => unknown；结果来自 / values from `typeof value === 'function' && receipts.has(value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function isCleanupReceipt(value: unknown): value is () => unknown { return typeof value === 'function' && receipts.has(value); }
