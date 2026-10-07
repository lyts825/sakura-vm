/**
 * 模块职责（中文）：捕获远程桌面画面并生成有时长/大小上限的浏览器录制结果，统一停止与资源释放。
 * Module responsibility (English): Capturing desktop frames with duration, size and encoder-finalization limits.
 * 详细范围（中文）：公开入口包括 RecordingProgress, RecordingResult, recordingLimits, DesktopRecorder；职责覆盖捕获桌面画面并限制录制时长、大小与编码器结束等待，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include RecordingProgress, RecordingResult, recordingLimits, DesktopRecorder. The scope covers Capturing desktop frames with duration, size and encoder-finalization limits. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type RecordingProgress = {
  status: 'recording' | 'paused' | 'stopping';
  milliseconds: number;
  bytes: number;
};
export type RecordingResult = {
  blob: Blob;
  milliseconds: number;
  width: number;
  height: number;
  reason: string;
};
type Capture = { stream: MediaStream; width: number; height: number; close: /** 中文：请求关闭当前界面，实际导航或卸载由父级决定；这是 Capture 的调用契约 | English: Request surface closure, leaving actual navigation/unmounting to the parent; this is the callable contract of Capture | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void };
type Recorder = Pick<
  MediaRecorder,
  'state' | 'mimeType' | 'start' | 'stop' | 'pause' | 'resume' | 'addEventListener' | 'removeEventListener'
>;
export const recordingLimits = { bytes: 128 * 1024 ** 2, milliseconds: 30 * 60 * 1000, fps: 15 };

/**
 * 中文：从桌面 canvas 创建最高 1920×1080、偶数尺寸的捕获画布，按帧率绘制并输出流；无可用画面或捕获能力抛错，close 停止所有轨道。
 * English: Create an even-sized capture canvas up to 1920 by 1080, draw at the configured frame rate and expose a stream. Reject unavailable frames/capture support; close stops all tracks.
 * 中文：输入：source：输入内容或捕获画面
 * English: Inputs: source: source content/captured frame
 * 中文：结果：包含 stream、width、height、close 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing stream, width, height, close for caller state reads/operations
 * 中文：拒绝原因：当前浏览器无法录制此桌面画面；无法创建录制画面。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 当前浏览器无法录制此桌面画面; 无法创建录制画面. These errors reach the direct caller or this function's catch handler
 */
function capture(source: HTMLCanvasElement): Capture {
  if (!source.width || !source.height || typeof source.captureStream !== 'function')
    throw new Error('当前浏览器无法录制此桌面画面');
  const scale = Math.min(1, 1920 / source.width, 1080 / source.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.floor((source.width * scale) / 2) * 2);
  canvas.height = Math.max(2, Math.floor((source.height * scale) / 2) * 2);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建录制画面');
  /**
   * 中文：清黑背景后按等比适配居中绘制桌面，尺寸暂时无效时跳过绘制，避免拉伸或无效坐标。
   * English: Clear to black then center/aspect-fit the desktop, skipping temporarily invalid dimensions to avoid distortion/invalid coordinates.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const draw = () => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const fit = Math.min(canvas.width / source.width, canvas.height / source.height);
    if (Number.isFinite(fit) && source.width && source.height)
      context.drawImage(
        source,
        (canvas.width - source.width * fit) / 2,
        (canvas.height - source.height * fit) / 2,
        source.width * fit,
        source.height * fit,
      );
  };
  draw();
  const stream = canvas.captureStream(recordingLimits.fps);
  const timer = setInterval(draw, 1000 / recordingLimits.fps);
  return {
    stream,
    width: canvas.width,
    height: canvas.height,
    /**
     * 中文：停止帧采样计时器及所有媒体轨道，并清空画布尺寸释放显存。
     * English: Stop frame-sampling timers/all media tracks and clear canvas dimensions to release graphics memory.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    close: () => {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      canvas.width = canvas.height = 0;
    },
  };
}
const browser = {
  capture,
  /**
   * 中文：选择浏览器支持的 WebM 编码器并固定视频码率，浏览器或编码器不支持时明确拒绝录制。
   * English: Choose a browser-supported WebM codec with a fixed video bitrate, explicitly rejecting missing recording/codec support.
   * 中文：输入：stream：编码器消费的媒体流
   * English: Inputs: stream: media stream consumed by the encoder
   * 中文：结果：Recorder，包含上述计算或传输完成值；抛错分支不提供成功结果
   * English: Result: Recorder carrying the described computation/transport result; throwing branches do not provide success
   * 中文：拒绝原因：当前浏览器不支持桌面录制；当前浏览器没有可用的 WebM 编码器。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 当前浏览器不支持桌面录制; 当前浏览器没有可用的 WebM 编码器. These errors reach the direct caller or this function's catch handler
   */
  recorder(stream: MediaStream): Recorder {
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持桌面录制');
    const mimeType = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) throw new Error('当前浏览器没有可用的 WebM 编码器');
    return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
  },
  /**
   * 中文：读取单调 performance 时钟计算录制时长，不受系统墙钟调整影响。
   * English: Read the monotonic performance clock for recording duration, unaffected by wall-clock adjustments.
   */
  now: () => performance.now(),
};

export class DesktopRecorder {
  private capture: Capture;
  private recorder!: Recorder;
  private chunks: Blob[] = [];
  private bytes = 0;
  private elapsed = 0;
  private started = 0;
  private closed = false;
  private stopping = false;
  private paused = false;
  private reason = '已停止录制';
  private timer?: ReturnType<typeof setInterval>;
  private finishTimeout?: ReturnType<typeof setTimeout>;
  /**
   * 中文：创建捕获流与编码器并成对登记数据/结束/错误监听；周期检查时长限制，构造任一步失败释放已创建资源再抛错。
   * English: Create capture/encoder and pair data/stop/error listeners, periodically enforcing duration limits. On construction failure release already-created resources before rethrowing.
   * 中文：输入：source：输入内容或捕获画面；report：向调用者交付状态或进度的回调；complete：交付成功录制结果的回调；failed：交付录制失败原因的回调；platform：此处理器的调用值（缺省 browser）；limits：此处理器的调用值（缺省 recordingLimits）
   * English: Inputs: source: source content/captured frame; report: callback delivering status/progress to the caller; complete: callback delivering a successful recording result; failed: callback delivering recording failure reasons; platform: the invocation value for this handler (default browser); limits: the invocation value for this handler (default recordingLimits)
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  constructor(
    source: HTMLCanvasElement,
    private report: /** 中文：向界面交付进度、连接状态或校验反馈；这是 DesktopRecorder.constructor 的调用契约 | English: Deliver progress/connection/validation feedback to the surface; this is the callable contract of DesktopRecorder.constructor | 中文：输入：state：当前状态或草稿快照 | English: Inputs: state: current state/draft snapshot | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (state: RecordingProgress) => void,
    private complete: /** 中文：交付确认可用的录制结果，由调用者保存；这是 DesktopRecorder.constructor 的调用契约 | English: Deliver a confirmed usable recording result for caller persistence; this is the callable contract of DesktopRecorder.constructor | 中文：输入：result：签名所示 RecordingResult 业务值 | English: Inputs: result: the RecordingResult domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (result: RecordingResult) => void,
    private failed: /** 中文：交付失败原因，由调用者显示并保留可恢复状态；这是 DesktopRecorder.constructor 的调用契约 | English: Deliver failure reasons for caller display/recoverable state retention; this is the callable contract of DesktopRecorder.constructor | 中文：输入：message：签名所示 string 业务值 | English: Inputs: message: the string domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (message: string) => void,
    private platform = browser,
    private limits = recordingLimits,
  ) {
    this.capture = platform.capture(source);
    try {
      this.recorder = platform.recorder(this.capture.stream);
      this.recorder.addEventListener('dataavailable', this.data as EventListener);
      this.recorder.addEventListener('stop', this.finished);
      this.recorder.addEventListener('error', this.error);
      this.started = platform.now();
      this.recorder.start(1000);
      this.timer = setInterval(() => {
        if (this.duration() >= this.limits.milliseconds) this.stop('达到最长录制时间，已自动结束');
        else this.update();
      }, 500);
      this.update();
    } catch (error) {
      if (this.recorder) this.dispose();
      else this.capture.close();
      throw error;
    }
  }
  /**
   * 中文：累计已录时长与当前运行区间，暂停或停止阶段不继续计时，使用单调时钟避免负增量。
   * English: Combine accumulated time with the current active interval, excluding pause/stop periods and using a monotonic clock to avoid negative increments.
   */
  private duration() {
    return (
      this.elapsed + (!this.paused && !this.stopping ? Math.max(0, this.platform.now() - this.started) : 0)
    );
  }
  /**
   * 中文：仅在未释放时向观察者报告录制/暂停/结束中状态、累计时长和字节数。
   * English: Report recording/paused/stopping status, elapsed duration and bytes only while undisposed.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private update() {
    if (!this.closed)
      this.report({
        status: this.stopping ? 'stopping' : this.recorder.state === 'paused' ? 'paused' : 'recording',
        milliseconds: this.duration(),
        bytes: this.bytes,
      });
  }
  /**
   * 中文：忽略空或已关闭分片，超过总量上限直接失败；临近容量限制先结束录制，为编码器尾部数据留余量。
   * English: Ignore empty/disposed chunks and fail if the total limit would be exceeded; stop near the limit to reserve room for final encoder data.
   * 中文：输入：event：触发本处理器的事件及其数据
   * English: Inputs: event: triggering event and its data
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private data = (event: BlobEvent) => {
    if (this.closed || !event.data.size) return;
    if (this.bytes + event.data.size > this.limits.bytes) {
      this.error();
      return;
    }
    this.chunks.push(event.data);
    this.bytes += event.data.size;
    // Reserve space for the final encoder flush. Huge delayed chunks fail visibly.
    if (this.bytes >= this.limits.bytes - Math.min(8 * 1024 ** 2, this.limits.bytes / 8))
      this.stop('达到录制容量限制，已自动结束');
    this.update();
  };
  /**
   * 中文：幂等释放全部录制资源并报告未保存失败，不把已有部分分片当作成功录制。
   * English: Idempotently release recording resources and report an unsaved failure rather than treating partial chunks as a successful recording.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private error = () => {
    if (this.closed) return;
    this.dispose();
    this.failed('录制失败或浏览器返回了过大的分片；此次录制未保存。请缩短录制时间后重试。');
  };
  /**
   * 中文：将接收分片合成 Blob 及尺寸/时长结果，再释放资源；无视频数据反馈失败，有数据才调用 complete。
   * English: Assemble received chunks into a Blob with dimensions/duration, then release resources. Report failure for empty video and call complete only with data.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  private finished = () => {
    if (this.closed) return;
    if (!this.stopping) this.elapsed = this.duration();
    const result = {
      blob: new Blob(this.chunks, { type: this.recorder.mimeType || 'video/webm' }),
      milliseconds: this.elapsed,
      width: this.capture.width,
      height: this.capture.height,
      reason: this.reason,
    };
    this.dispose();
    if (!result.blob.size) this.failed('未收到视频数据，请在桌面连接后重新录制');
    else this.complete(result);
  };
  /**
   * 中文：仅在正在录制时累计当前时长并暂停编码器；异常转统一失败释放路径。
   * English: Accumulate active time/pause the encoder only while recording; route exceptions through shared failure/disposal handling.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  pause() {
    if (this.closed || this.stopping || this.recorder.state !== 'recording') return;
    this.elapsed = this.duration();
    this.paused = true;
    try {
      this.recorder.pause();
      this.update();
    } catch {
      this.error();
    }
  }
  /**
   * 中文：仅在暂停状态重设单调起点并恢复编码器，停止中或已关闭状态不复活录制。
   * English: Reset the monotonic start/resume only from paused state, never reviving a stopping/disposed recording.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  resume() {
    if (this.closed || this.stopping || this.recorder.state !== 'paused') return;
    this.started = this.platform.now();
    this.paused = false;
    try {
      this.recorder.resume();
      this.update();
    } catch {
      this.error();
    }
  }
  /**
   * 中文：冻结已录制时长并进入 stopping，等待编码器最后分片和 stop 事件；设置 10 秒结束上限，异常或超时走失败清理，而非保存不完整视频。
   * English: Freeze recorded duration and enter stopping while waiting for the encoder's final chunk and stop event. Bound finalization to ten seconds; errors/timeouts trigger failure cleanup instead of saving incomplete video.
   * 中文：输入：reason：结束或拒绝操作的可显示原因（缺省 '已停止录制'）
   * English: Inputs: reason: displayable operation-end/refusal reason (default '已停止录制')
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  stop(reason = '已停止录制') {
    if (this.closed || this.stopping) return;
    this.elapsed = this.duration();
    this.stopping = true;
    this.reason = reason;
    clearInterval(this.timer);
    // 停止后等待编码器的最后分片和 stop 事件；超时作为失败处理，不能把缺少尾部的数据声明为完整录制。
    this.finishTimeout = setTimeout(() => this.error(), 10000);
    this.update();
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        this.error();
      }
    } else this.finished();
  }
  /**
   * 中文：幂等关闭采样与结束等待计时器，移除编码器监听后尝试停止，关闭捕获流并丢弃分片；顺序避免 stop 回调再次保存。
   * English: Idempotently clear sampling/finalization timers, detach encoder listeners before stopping, close capture and drop chunks; this order prevents stop callbacks from saving again.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.finishTimeout);
    this.recorder.removeEventListener('dataavailable', this.data as EventListener);
    this.recorder.removeEventListener('stop', this.finished);
    this.recorder.removeEventListener('error', this.error);
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        /* Release tracks even after encoder failure. */
      }
    }
    this.capture.close();
    this.chunks = [];
    this.bytes = 0;
  }
}
