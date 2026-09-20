import { AppError } from './model.ts';

export type JobView = {
  status: 'running' | 'done' | 'error';
  log: string;
  error?: string;
  startedAt: string;
};
export class Jobs {
  private closed = false;
  private items = new Map<string, { view: JobView; abort: AbortController; done: Promise<void> }>();
  view(key: string) {
    return this.items.get(key)?.view || null;
  }
  start(key: string, work: (log: (text: string) => void, signal: AbortSignal) => Promise<void>) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const previous = this.items.get(key);
    if (previous?.view.status === 'running') throw new AppError('另一项操作仍在进行', 409);
    const view: JobView = { status: 'running', log: '', startedAt: new Date().toISOString() };
    const abort = new AbortController();
    const done = Promise.resolve()
      .then(() =>
        work((text) => {
          view.log = (view.log + text).slice(-32768);
        }, abort.signal),
      )
      .then(() => {
        view.status = 'done';
      })
      .catch((error: Error) => {
        view.status = 'error';
        view.error = error.message;
      });
    this.items.set(key, { view, abort, done });
    return view;
  }
  cancel(key: string) {
    this.items.get(key)?.abort.abort();
  }
  async close() {
    this.closed = true;
    for (const item of this.items.values()) item.abort.abort();
    await Promise.all([...this.items.values()].map((v) => v.done));
  }
}
