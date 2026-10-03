import type { IncomingMessage, ServerResponse } from 'node:http';

/** Shared admission accounting for requests and background work. */
export class OperationTracker {
  active = 0;
  change(delta: number) {
    this.active += delta;
  }
  enter() {
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
  async run<T>(work: () => T | Promise<T>): Promise<T> {
    const release = this.enter();
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export function requestScope(req: IncomingMessage, res: ServerResponse) {
  const controller = new AbortController();
  const disconnected = () => {
    if (!res.writableFinished) controller.abort();
  };
  req.once('aborted', disconnected);
  res.once('close', disconnected);
  if (req.aborted || res.destroyed) controller.abort();
  return {
    controller,
    signal: controller.signal,
    dispose() {
      req.off('aborted', disconnected);
      res.off('close', disconnected);
    },
  };
}
