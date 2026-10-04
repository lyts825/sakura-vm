const receipts = new WeakSet<Function>();
/** Only host/domain adapters create a zero-argument receipt for an existing resource. */
export function cleanupReceipt<T extends () => unknown>(work: T): T { receipts.add(work); return work; }
export function isCleanupReceipt(value: unknown): value is () => unknown { return typeof value === 'function' && receipts.has(value); }
