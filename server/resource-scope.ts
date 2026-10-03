type Resource = { name: string; order: number; sequence: number; dispose: () => unknown };

/** Own resources as soon as they exist, including before asynchronous init. */
export class ResourceScope {
  private resources: Resource[] = [];
  private sequence = 0;
  private closing?: Promise<void>;
  defer(name: string, dispose: () => unknown, order = 0) {
    if (this.closing) throw new Error('Resource scope is closing');
    const resource = { name, dispose, order, sequence: this.sequence++ };
    this.resources.push(resource);
    return () => {
      this.resources = this.resources.filter((item) => item !== resource);
    };
  }
  own<T extends { close(): unknown }>(name: string, value: T, order = 0): T {
    this.defer(name, () => value.close(), order);
    return value;
  }
  close(): Promise<void> {
    if (!this.closing) {
      const resources = this.resources.splice(0).sort((a, b) => a.order - b.order || b.sequence - a.sequence);
      // Assign the promise before disposal so concurrent close calls are idempotent.
      this.closing = Promise.resolve().then(async () => {
        const failures: Error[] = [];
        for (const resource of resources) {
          try {
            await resource.dispose();
          } catch (cause) {
            failures.push(new Error(`Resource cleanup failed: ${resource.name}`, { cause }));
          }
        }
        if (failures.length) throw new AggregateError(failures, 'Application cleanup failed');
      });
    }
    return this.closing;
  }
}
