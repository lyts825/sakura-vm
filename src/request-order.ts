// Polling must make progress even when a request takes longer than its interval.
// A response is stale only after a newer response has been applied or its owner
// has invalidated the requests (for example, when leaving a VM).
export class ResponseOrder {
  private issued = 0;
  private applied = 0;

  start() {
    return ++this.issued;
  }

  accept(version: number) {
    if (version < this.applied) return false;
    this.applied = version;
    return true;
  }

  invalidate() {
    this.applied = ++this.issued;
  }
}
