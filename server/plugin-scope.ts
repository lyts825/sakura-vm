export class PluginScope {
  private controller = new AbortController();
  private disposers: Array<() => void | Promise<void>> = [];
  get signal() {
    return this.controller.signal;
  }
  add(disposer: () => void | Promise<void>) {
    this.signal.throwIfAborted();
    this.disposers.push(disposer);
  }
  abort() {
    this.controller.abort();
  }
  async dispose(run: (dispose: () => void | Promise<void>) => Promise<void>) {
    const errors: unknown[] = [];
    for (const disposer of this.disposers.reverse()) {
      try {
        await run(disposer);
      } catch (error) {
        errors.push(error);
      }
    }
    this.disposers = [];
    if (errors.length) throw new AggregateError(errors, '插件资源清理失败');
  }
}

export async function withinDeadline<T>(
  operation: Promise<T> | T,
  milliseconds: number,
  label: string,
  onTimeout: () => void = () => {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(`${label}超过 ${milliseconds} 毫秒`));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
