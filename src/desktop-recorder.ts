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
type Capture = { stream: MediaStream; width: number; height: number; close: () => void };
type Recorder = Pick<
  MediaRecorder,
  'state' | 'mimeType' | 'start' | 'stop' | 'pause' | 'resume' | 'addEventListener' | 'removeEventListener'
>;
export const recordingLimits = { bytes: 128 * 1024 ** 2, milliseconds: 30 * 60 * 1000, fps: 15 };

function capture(source: HTMLCanvasElement): Capture {
  if (!source.width || !source.height || typeof source.captureStream !== 'function')
    throw new Error('当前浏览器无法录制此桌面画面');
  const scale = Math.min(1, 1920 / source.width, 1080 / source.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.floor((source.width * scale) / 2) * 2);
  canvas.height = Math.max(2, Math.floor((source.height * scale) / 2) * 2);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法创建录制画面');
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
    close: () => {
      clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      canvas.width = canvas.height = 0;
    },
  };
}
const browser = {
  capture,
  recorder(stream: MediaStream): Recorder {
    if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持桌面录制');
    const mimeType = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) throw new Error('当前浏览器没有可用的 WebM 编码器');
    return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
  },
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
  constructor(
    source: HTMLCanvasElement,
    private report: (state: RecordingProgress) => void,
    private complete: (result: RecordingResult) => void,
    private failed: (message: string) => void,
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
  private duration() {
    return (
      this.elapsed + (!this.paused && !this.stopping ? Math.max(0, this.platform.now() - this.started) : 0)
    );
  }
  private update() {
    if (!this.closed)
      this.report({
        status: this.stopping ? 'stopping' : this.recorder.state === 'paused' ? 'paused' : 'recording',
        milliseconds: this.duration(),
        bytes: this.bytes,
      });
  }
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
  private error = () => {
    if (this.closed) return;
    this.dispose();
    this.failed('录制失败或浏览器返回了过大的分片；此次录制未保存。请缩短录制时间后重试。');
  };
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
  stop(reason = '已停止录制') {
    if (this.closed || this.stopping) return;
    this.elapsed = this.duration();
    this.stopping = true;
    this.reason = reason;
    clearInterval(this.timer);
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
