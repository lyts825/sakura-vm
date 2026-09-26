import { Transform } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

/** Shared budget across sequential file streams; idle time cannot accumulate a burst. */
export class ByteRate {
  private due = performance.now();
  constructor(private bytesPerSecond = 0) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) throw new Error('传输速率无效');
  }
  stream(signal: AbortSignal) {
    return new Transform({
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
