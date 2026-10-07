/**
 * 模块职责：统计请求及后台操作的活动数量，并在请求中断时发出作用域取消信号。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** 请求和后台工作共用的活动计数；退出闭包幂等，避免重复释放把计数减为负数。 */
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

/** 响应正常写完不触发取消；调用方结束时必须 dispose，移除当前请求的断开监听。 */
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
