import { AsyncLocalStorage } from 'node:async_hooks';

type OperationCheck = () => Promise<void>;
const checks = new AsyncLocalStorage<OperationCheck>();
const auditObservers = new AsyncLocalStorage<() => void>();

/** Observe audit failures for this invocation even if the business throws a primitive. */
export function withAuditFailureObserver<T>(observer: () => void, work: () => T): T {
  return auditObservers.run(observer, work);
}
export function reportAuditFailure() {
  auditObservers.getStore()?.();
}

/** Capture at admission, before a queue or a different owner's callback can change context. */
export function captureOperationCheck(): OperationCheck {
  const check = checks.getStore();
  return check ? () => checks.exit(check) : async () => {};
}

export function withOperationCheck<T>(check: OperationCheck, work: () => T): T {
  const parent = checks.getStore();
  return checks.run(parent ? async () => { await parent(); await check(); } : check, work);
}

/** Independently owned schedulers and recovery domains establish their own authority. */
export function withoutOperationContext<T>(work: () => T): T {
  return checks.exit(work);
}
