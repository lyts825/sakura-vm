/**
 * 模块职责：回归验证模块，围绕 `desktop-recorder` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Regression verification for `desktop-recorder`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: desktop recorder excludes pauses, retains the final encoder chunk and releases capture resources once; desktop recorder enforces elapsed and byte limits and fails visibly on oversized delayed chunks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopRecorder, type RecordingResult, type RecordingProgress } from '../src/desktop-recorder.ts';

class Encoder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'video/webm';
  stops = 0;
  final = 'final';
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  start() {
    this.state = 'recording';
  }
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  pause() {
    this.state = 'paused';
  }
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  resume() {
    this.state = 'recording';
  }
  /**
   * 中文功能：生成或核对本组验证所需的摘要与身份材料。
   * English: Generate or verify digest and identity material required by this suite.
   * 输入 / Inputs: text: string。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 协作入口 / Collaborators: `this.dispatchEvent`, `Object.assign`.
   */
  chunk(text: string) {
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([text]) }));
  }
  /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 状态影响 / State effects: `this.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   * 协作入口 / Collaborators: `this.chunk`, `this.dispatchEvent`.
   */
  stop() {
    this.stops++;
    this.state = 'inactive';
    this.chunk(this.final);
    this.dispatchEvent(new Event('stop'));
  }
}
/**
 * 中文功能：装配本组用例的受控依赖和可观察状态，返回用例需要的操作入口。
 * English: Assemble controlled dependencies and observable state for this suite, returning the operations used by its cases.
 * 输入 / Inputs: t: any; limits = { bytes: 1024, milliseconds: 60000, fps: 15 }。
 * 结果：返回受控对象，公开字段包括 `recorder, encoder, progress, results, errors, advance, closed`；各分支以实际返回对象为准。
 * Result: Return a controlled object exposing fields such as `recorder, encoder, progress, results, errors, advance, closed`; the actual branch determines its shape.
 * 协作入口 / Collaborators: `t.after`.
 */
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
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`({ stream: {} as MediaStream, width: 640, height: 360, close: () => { closed++; …`）。
       * Result: Return the branch-computed value (`({ stream: {} as MediaStream, width: 640, height: 360, close: () => { closed++; …`).
       */
      capture: () => ({
        stream: {} as MediaStream,
        width: 640,
        height: 360,
        /**
         * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
         * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
         * 输入 / Inputs: 无 / none。
         * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
         * Result: No explicit result value; callers observe completion, state changes or an exception.
         */
        close: () => {
          closed++;
        },
      }),
      /**
       * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
       * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`encoder as any`）。
       * Result: Return the branch-computed value (`encoder as any`).
       */
      recorder: () => encoder as any,
      /**
       * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
       * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
       * 输入 / Inputs: 无 / none。
       * 结果：返回分支计算值（`now`）。
       * Result: Return the branch-computed value (`now`).
       */
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
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: value: number。
     * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
     * Result: No explicit result value; callers observe completion, state changes or an exception.
     * 状态影响 / State effects: `now`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
     */
    advance: (value: number) => {
      now += value;
    },
    /**
     * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
     * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`closed`）。
     * Result: Return the branch-computed value (`closed`).
     */
    closed: () => closed,
  };
}
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: desktop recorder excludes pauses, retains the final encoder chunk and releases capture resources once
 * 协作入口 / Collaborators: `fixture`, `f.advance`, `f.encoder.chunk`, `f.recorder.pause`.
 * 检查边界 / Checked boundaries: `assert.equal(f.progress.at(-1)?.status, 'paused')`; `assert.equal(f.results[0].milliseconds, 3000)`.
 */
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
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: desktop recorder enforces elapsed and byte limits and fails visibly on oversized delayed chunks
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `fixture`, `timed.advance`, `t.mock.timers.tick`.
 * 检查边界 / Checked boundaries: `assert.match(timed.results[0].reason, /最长录制时间/)`; `assert.equal(sized.results[0].blob.size, 95)`.
 */
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
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: disposing an unfinished recording discards all data and encoder failure cannot publish a partial result
 * 协作入口 / Collaborators: `fixture`, `disposed.encoder.chunk`, `disposed.recorder.dispose`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(disposed.results.length, 0)`; `assert.equal(disposed.errors.length, 0)`.
 */
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
/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: 无 / none。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a missing encoder cleans up capture without retaining tracks
 * 协作入口 / Collaborators: `assert.throws`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.throws( () => new DesktopRecorder( {} as HTMLCanvasElement, () => {}, () => {}, () => {}, { capture: () => ({ stream: {} as…`; `assert.equal(closed, 1)`.
 */
test('a missing encoder cleans up capture without retaining tracks', () => {
  let closed = 0;
  assert.throws(
    /**
     * 中文功能：提供本组用例使用的执行、请求或启动入口，按受控状态生成结果、事件或失败。
     * English: Provide the execution, request or launch entry used by this suite, producing results, events or failures from controlled state.
     * 输入 / Inputs: 无 / none。
     * 结果：返回分支计算值（`new DesktopRecorder( {} as HTMLCanvasElement, () => {}, () => {}, () => {}, { ca…`）。
     * Result: Return the branch-computed value (`new DesktopRecorder( {} as HTMLCanvasElement, () => {}, () => {}, () => {}, { ca…`).
     * 验证场景 / Scenario: a missing encoder cleans up capture without retaining tracks
     */
    () =>
      new DesktopRecorder(
        {} as HTMLCanvasElement,
        () => {},
        () => {},
        () => {},
        {
          /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：返回分支计算值（`({ stream: {} as MediaStream, width: 640, height: 360, close: () => { closed++; …`）。
           * Result: Return the branch-computed value (`({ stream: {} as MediaStream, width: 640, height: 360, close: () => { closed++; …`).
           * 验证场景 / Scenario: a missing encoder cleans up capture without retaining tracks
           */
          capture: () => ({
            stream: {} as MediaStream,
            width: 640,
            height: 360,
            /**
             * 中文功能：执行夹具或受控资源的关闭、释放或收尾步骤，供清理断言及退出路径复用。
             * English: Close, release or finalize fixture-controlled resources for cleanup assertions and exit paths.
             * 输入 / Inputs: 无 / none。
             * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
             * Result: No explicit result value; callers observe completion, state changes or an exception.
             * 验证场景 / Scenario: a missing encoder cleans up capture without retaining tracks
             */
            close: () => {
              closed++;
            },
          }),
          /**
           * 中文功能：构造测试所需的数据、身份、协议帧或适配器，保持生成结果可被本组断言观察。
           * English: Construct test data, identity, protocol frames or adapters with results observable by this suite.
           * 输入 / Inputs: 无 / none。
           * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
           * Result: No explicit result value; callers observe completion, state changes or an exception.
           * 验证场景 / Scenario: a missing encoder cleans up capture without retaining tracks
           * 失败 / Failure: `new Error('encoder missing')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
           */
          recorder: () => {
            throw new Error('encoder missing');
          },
          /**
           * 中文功能：完成本组用例中的受控步骤；效果通过调用记录、状态或断言观察。
           * English: Perform a controlled step in this suite; its effects are observed through call records, state or assertions.
           * 输入 / Inputs: 无 / none。
           * 结果：返回分支计算值（`0`）。
           * Result: Return the branch-computed value (`0`).
           * 验证场景 / Scenario: a missing encoder cleans up capture without retaining tracks
           */
          now: () => 0,
        },
      ),
    /encoder missing/,
  );
  assert.equal(closed, 1);
});

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: t。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: a recorder that never finishes flushing times out and releases its capture
 * 状态影响 / State effects: `f.encoder.stop`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `t.mock.timers.enable`, `fixture`, `f.recorder.stop`, `assert.equal`.
 * 检查边界 / Checked boundaries: `assert.equal(f.progress.at(-1)?.status, 'stopping')`; `assert.equal(f.results.length, 0)`.
 */
test('a recorder that never finishes flushing times out and releases its capture', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  f.encoder.stop = /**
   * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
   * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
   * 输入 / Inputs: 无 / none。
   * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
   * Result: No explicit result value; callers observe completion, state changes or an exception.
   * 验证场景 / Scenario: a recorder that never finishes flushing times out and releases its capture
   * 状态影响 / State effects: `f.encoder.state`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
   */
  () => {
    f.encoder.state = 'inactive';
  };
  f.recorder.stop();
  assert.equal(f.progress.at(-1)?.status, 'stopping');
  t.mock.timers.tick(10000);
  assert.equal(f.results.length, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.closed(), 1);
});
