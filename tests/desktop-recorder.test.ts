import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopRecorder, type RecordingResult, type RecordingProgress } from '../src/desktop-recorder.ts';

class Encoder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'video/webm';
  stops = 0;
  final = 'final';
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  chunk(text: string) {
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([text]) }));
  }
  stop() {
    this.stops++;
    this.state = 'inactive';
    this.chunk(this.final);
    this.dispatchEvent(new Event('stop'));
  }
}
function fixture(t: any, limits = { bytes: 1024, milliseconds: 60000, fps: 15 }) {
  let now = 0,
    closed = 0;
  const encoder = new Encoder(),
    progress: RecordingProgress[] = [],
    results: RecordingResult[] = [],
    errors: string[] = [];
  const recorder = new DesktopRecorder(
    {} as HTMLCanvasElement,
    (value) => progress.push(value),
    (value) => results.push(value),
    (message) => errors.push(message),
    {
      capture: () => ({
        stream: {} as MediaStream,
        width: 640,
        height: 360,
        close: () => {
          closed++;
        },
      }),
      recorder: () => encoder as any,
      now: () => now,
    },
    limits,
  );
  t.after(() => recorder.dispose());
  return {
    recorder,
    encoder,
    progress,
    results,
    errors,
    advance: (value: number) => {
      now += value;
    },
    closed: () => closed,
  };
}
test('desktop recorder excludes pauses, retains the final encoder chunk and releases capture resources once', async (t) => {
  const f = fixture(t);
  f.advance(1000);
  f.encoder.chunk('first');
  f.recorder.pause();
  assert.equal(f.progress.at(-1)?.status, 'paused');
  f.advance(3000);
  f.recorder.resume();
  f.advance(2000);
  f.recorder.stop();
  assert.equal(f.results[0].milliseconds, 3000);
  assert.equal(await f.results[0].blob.text(), 'firstfinal');
  assert.equal(f.results[0].width, 640);
  assert.equal(f.closed(), 1);
  f.recorder.dispose();
  f.recorder.stop();
  f.encoder.chunk('late');
  assert.equal(f.encoder.stops, 1);
  assert.equal(f.results.length, 1);
  assert.equal(f.closed(), 1);
});
test('desktop recorder enforces elapsed and byte limits and fails visibly on oversized delayed chunks', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const timed = fixture(t, { bytes: 1024, milliseconds: 1000, fps: 15 });
  timed.advance(1000);
  t.mock.timers.tick(500);
  assert.match(timed.results[0].reason, /最长录制时间/);
  const sized = fixture(t, { bytes: 100, milliseconds: 1000, fps: 15 });
  sized.encoder.chunk('a'.repeat(90));
  assert.equal(sized.results[0].blob.size, 95);
  assert.match(sized.results[0].reason, /容量限制/);
  const oversized = fixture(t, { bytes: 100, milliseconds: 1000, fps: 15 });
  oversized.encoder.chunk('a'.repeat(101));
  assert.equal(oversized.results.length, 0);
  assert.match(oversized.errors[0], /未保存/);
  assert.equal(oversized.closed(), 1);
});
test('disposing an unfinished recording discards all data and encoder failure cannot publish a partial result', (t) => {
  const disposed = fixture(t);
  disposed.encoder.chunk('private');
  disposed.recorder.dispose();
  assert.equal(disposed.results.length, 0);
  assert.equal(disposed.errors.length, 0);
  assert.equal(disposed.closed(), 1);
  const failed = fixture(t);
  failed.encoder.dispatchEvent(new Event('error'));
  assert.equal(failed.results.length, 0);
  assert.equal(failed.errors.length, 1);
  assert.equal(failed.closed(), 1);
});
test('a missing encoder cleans up capture without retaining tracks', () => {
  let closed = 0;
  assert.throws(
    () =>
      new DesktopRecorder(
        {} as HTMLCanvasElement,
        () => {},
        () => {},
        () => {},
        {
          capture: () => ({
            stream: {} as MediaStream,
            width: 640,
            height: 360,
            close: () => {
              closed++;
            },
          }),
          recorder: () => {
            throw new Error('encoder missing');
          },
          now: () => 0,
        },
      ),
    /encoder missing/,
  );
  assert.equal(closed, 1);
});

test('a recorder that never finishes flushing times out and releases its capture', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  f.encoder.stop = () => {
    f.encoder.state = 'inactive';
  };
  f.recorder.stop();
  assert.equal(f.progress.at(-1)?.status, 'stopping');
  t.mock.timers.tick(10000);
  assert.equal(f.results.length, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.closed(), 1);
});
