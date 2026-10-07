/**
 * 模块职责：用 WeakSet 登记原资源的清理函数，使普通函数无法冒充清理回执能力。
 */
const receipts = new WeakSet<Function>();
/** 仅由宿主或领域适配器登记已有资源的零参数清理函数；标记本身不证明资源已经释放。 */
export function cleanupReceipt<T extends () => unknown>(work: T): T { receipts.add(work); return work; }
export function isCleanupReceipt(value: unknown): value is () => unknown { return typeof value === 'function' && receipts.has(value); }
