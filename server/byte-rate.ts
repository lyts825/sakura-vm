/**
 * 模块职责：以流式节流限制传输速率，等待可取消且不需要将完整文件载入内存。
 * Module purpose: Throttles streaming transfers with cancellable waits, avoiding whole-file buffering and accumulated idle-time bursts.
 */
import { Transform } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

/** Shared budget across sequential file streams; idle time cannot accumulate a burst. */
export class ByteRate {
  private due = performance.now();
  /**
   * 入口 / Entry: ByteRate.constructor.
   * 功能：建立 ByteRate 的以流式节流限制传输速率上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ByteRate context for this module's responsibility: Throttles streaming transfers with cancellable waits, avoiding whole-file buffering and accumulated idle-time bursts. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: bytesPerSecond: default=0
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0`; 异常 / errors `new Error('传输速率无效')`.
   */
  constructor(private bytesPerSecond = 0) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) throw new Error('传输速率无效');
  }
  /**
   * 入口 / Entry: ByteRate.stream.
   * 功能：从当前输入或状态计算 `new Transform({ transform: (chunk: Buffer, _encoding, callback) => { if (signal.aborted) return callback(signal.reason); if (…`，供调用方后续验证或使用。
   * Purpose: Computes `new Transform({ transform: (chunk: Buffer, _encoding, callback) => { if (signal.aborted) return callback(signal.reason); if (…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: signal: AbortSignal
   * 输出 / Returns: `new Transform({ transform: (chunk: Buffer, _encoding, callback) => { if (signal.aborted) return callback(signal.reason); if (…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  stream(signal: AbortSignal) {
    return new Transform({
      /**
       * 入口 / Entry: ByteRate.stream.transform.
       * 功能：在以流式节流限制传输速率中，执行此领域的具体处理步骤并返回其结果；本入口产生 `callback(signal.reason)` / `callback(null, chunk)` 供上层消费（`ByteRate`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ByteRate`; this entry produces `callback(signal.reason)` / `callback(null, chunk)` for its caller. Module context: Throttles streaming transfers with cancellable waits, avoiding whole-file buffering and accumulated idle-time bursts.
       * 处理：通过 `callback`, `performance.now`, `delay().then`, `delay` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `callback`, `performance.now`, `delay().then`, `delay`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `signal.aborted`; `!this.bytesPerSecond`.
       * 输入 / Inputs: chunk: Buffer; _encoding; callback
       * 输出 / Returns: `callback(signal.reason)`; `callback(null, chunk)`.
       * 副作用 / Effects: 更新 / updates `this.due`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      transform: (chunk: Buffer, _encoding, callback) => {
        if (signal.aborted) return callback(signal.reason);
        if (!this.bytesPerSecond) return callback(null, chunk);
        const now = performance.now();
        this.due = Math.max(now, this.due) + (chunk.length / this.bytesPerSecond) * 1000;
        void delay(Math.max(1, this.due - now), undefined, { signal }).then(
          () => callback(null, chunk),
          (error: Error) => callback(error),
        );
      },
    });
  }
}
