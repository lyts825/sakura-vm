/**
 * 模块职责（中文）：提供桌面录制控制、本地录制库、回放与导出，展示录制配额和失败反馈。
 * Module responsibility (English): Managing desktop recording, the recording library, playback and export.
 * 详细范围（中文）：公开入口包括 RecordingLibrary, DesktopRecording；职责覆盖管理桌面录制、录制库、回放和导出，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include RecordingLibrary, DesktopRecording. The scope covers Managing desktop recording, the recording library, playback and export. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from './localization';
import { formatDateTime } from './localization';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { DesktopRecorder, type RecordingProgress } from './desktop-recorder';
import {
  clearRecordings,
  deleteRecording,
  listRecordings,
  recordingBlob,
  saveRecording,
  type RecordingEntry,
} from './recording-library';
import { Feedback, useAction } from './feature-shared';
import { registerEditorGuard } from './file-editor-state';
import './desktop-recording.css';

/**
 * 中文：把毫秒显示成分钟和两位秒数，供录制进度与库列表共用。
 * English: Display milliseconds as minutes and two-digit seconds for recording progress/library lists.
 * 中文：输入：ms：签名所示 number 业务值
 * English: Inputs: ms: the number domain value in the signature
 */
const duration = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
/**
 * 中文：把录制字节显示成保留一位区域小数的 MiB。
 * English: Display recording bytes as MiB with one locale-formatted fractional digit.
 * 中文：输入：bytes：签名所示 number 业务值
 * English: Inputs: bytes: the number domain value in the signature
 */
const size = (bytes: number) => `${formatDecimal((bytes / 1024 ** 2), 1)} MiB`;
/**
 * 中文：在管理桌面录制、录制库、回放和导出流程中timeout 状态，创建二进制内容临时 URL；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In Managing desktop recording, the recording library, playback and export, timeout state, create temporary binary-content URLs. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：blob：签名所示 Blob 业务值；name：目标名称或文件名
 * English: Inputs: blob: the Blob domain value in the signature; name: target name/filename
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
function exportRecording(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = `sakura-${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100)}.webm`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
/**
 * 中文：呈现管理桌面录制、录制库、回放和导出中的 Player 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the Player surface for Managing desktop recording, the recording library, playback and export. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ blob, milliseconds } 提供 blob（blob 状态）、milliseconds（milliseconds 状态） 上下文字段
 * English: Inputs: { blob, milliseconds } provides context fields blob (blob state), milliseconds (milliseconds state)
 */
function Player({ blob, milliseconds }: { blob: Blob; milliseconds: number }) {
  const [url, setUrl] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState(0),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(/** 中文：当依赖 [blob] 变化时创建二进制内容临时 URL，position 状态，ready 状态，错误反馈，url 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [blob] change, create temporary binary-content URLs, position state, ready state, error feedback, url state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const value = URL.createObjectURL(blob);
    setPosition(0);
    setReady(false);
    setError('');
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  const maximum = Math.max(0.1, milliseconds / 1000);
  return (
    <div>
      <video
        ref={video}
        src={url || undefined}
        controls
        playsInline
        preload="metadata"
        aria-label="录制回放"
        onLoadedMetadata={() => setReady(true)}
        onTimeUpdate={() => setPosition(video.current?.currentTime || 0)}
        onError={() => setError('浏览器无法解码此视频，可下载后使用支持 WebM 的播放器打开。')}
      />
      <label>
        回放位置 · {duration(position * 1000)} / {duration(milliseconds)}
        <input
          aria-label="回放位置"
          type="range"
          min={0}
          max={maximum}
          step={0.1}
          value={Math.min(maximum, position)}
          disabled={!ready}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (video.current) video.current.currentTime = value;
            setPosition(value);
          }}
        />
      </label>
      <Feedback error={error} />
    </div>
  );
}
/**
 * 中文：呈现管理桌面录制、录制库、回放和导出中的 RecordingLibrary 界面，组合 Player，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RecordingLibrary surface for Managing desktop recording, the recording library, playback and export and composing Player. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  revision = 0,
  onRemoved,
} 提供 revision（revision 状态）、onRemoved（onRemoved 状态） 上下文字段
 * English: Inputs: {
  revision = 0,
  onRemoved,
} provides context fields revision (revision state), onRemoved (onRemoved state)
 */
export function RecordingLibrary({
  revision = 0,
  onRemoved,
}: {
  revision?: number;
  onRemoved?: /** 中文：在录制条目确认移除后通知父级恢复选择或列表；这是 RecordingLibrary 的调用契约 | English: Notify the parent to restore selection/list after a recording entry is confirmed removed; this is the callable contract of RecordingLibrary | 中文：输入：id：目标资源标识 | English: Inputs: id: target resource identifier | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (id?: string) => void;
}) {
  const [entries, setEntries] = useState<RecordingEntry[]>([]),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<{ entry: RecordingEntry; blob: Blob }>();
  const action = useAction();
  const alive = useRef(true);
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(/** 中文：当依赖 [revision, refresh] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [revision, refresh] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    let current = true;
    void listRecordings()
      .then((entries) => {
        if (current) {
          setEntries(entries);
          setError('');
        }
      })
      .catch((error) => {
        if (current) setError((error as Error).message);
      });
    return () => {
      current = false;
    };
  }, [revision, refresh]);
  return (
    <section className="recording-library" aria-label="本浏览器录制库">
      <h4>本浏览器录制库</h4>
      <p>
        {entries.length} / 32 条 · {size(entries.reduce((sum, row) => sum + row.bytes, 0))} / 256 MiB ·
        包含所有实例的录制
      </p>
      <Feedback error={action.error || error} message={action.message} />
      <button className="secondary compact" disabled={action.busy} onClick={() => setRefresh((n) => n + 1)}>
        刷新录制库
      </button>
      <button
        className="text-button danger-text"
        disabled={action.busy}
        onClick={() => {
          if (!confirm('清空本浏览器的所有实例录制？此操作无法撤销，请先下载需要保留的文件。')) return;
          void action.run(/** 中文：在管理桌面录制、录制库、回放和导出流程中当前选择，refresh 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Managing desktop recording, the recording library, playback and export, current selection, refresh state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
            await clearRecordings();
            onRemoved?.();
            if (alive.current) {
              setSelected(undefined);
              setRefresh((n) => n + 1);
            }
          }, '录制库已清空');
        }}
      >
        清空录制库
      </button>
      {!entries.length && !error && <p>尚未保存录制。</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <div>
              <strong data-locale-ignore>{entry.name}</strong>
              <p>
                <span data-locale-ignore>{entry.vmName}</span> · {formatDateTime(new Date(entry.createdAt))} · {duration(entry.milliseconds)}{' '}
                · {size(entry.bytes)}
              </p>
            </div>
            <div className="feature-actions">
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(/** 中文：在管理桌面录制、录制库、回放和导出流程中当前选择；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Managing desktop recording, the recording library, playback and export, current selection. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                    const blob = await recordingBlob(entry);
                    if (alive.current) setSelected({ entry, blob });
                  })
                }
              >
                回放 <span data-locale-ignore>{entry.name}</span>
              </button>
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(/** 中文：读取所选录制 Blob 并导出下载，读取失败交给动作反馈，不把缺失内容当作空视频导出。 | English: Read the selected recording Blob and export it, routing read failure to action feedback instead of exporting missing content as empty video. | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                    const blob = await recordingBlob(entry);
                    if (alive.current) exportRecording(blob, entry.name);
                  })
                }
              >
                下载 <span data-locale-ignore>{entry.name}</span>
              </button>
              <button
                className="text-button danger-text"
                disabled={action.busy}
                onClick={() => {
                  if (!confirm(`删除录制“${entry.name}”？请先下载需要保留的文件。`)) return;
                  void action.run(/** 中文：在管理桌面录制、录制库、回放和导出流程中当前选择，refresh 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Managing desktop recording, the recording library, playback and export, current selection, refresh state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                    await deleteRecording(entry.id);
                    onRemoved?.(entry.id);
                    if (alive.current) {
                      if (selected?.entry.id === entry.id) setSelected(undefined);
                      setRefresh((n) => n + 1);
                    }
                  }, '录制已删除');
                }}
              >
                删除 <span data-locale-ignore>{entry.name}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {selected && (
        <div>
          <h4 data-locale-ignore>{selected.entry.name}</h4>
          <Player blob={selected.blob} milliseconds={selected.entry.milliseconds} />
          <button className="secondary compact" onClick={() => setSelected(undefined)}>
            关闭回放
          </button>
        </div>
      )}
    </section>
  );
}
/**
 * 中文：呈现管理桌面录制、录制库、回放和导出中的 DesktopRecording 界面，组合 Player、RecordingLibrary，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DesktopRecording surface for Managing desktop recording, the recording library, playback and export and composing Player, RecordingLibrary. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vm,
  connected,
  screen,
} 提供 vm（vm 状态）、connected（连接状态）、screen（screen 状态） 上下文字段
 * English: Inputs: {
  vm,
  connected,
  screen,
} provides context fields vm (vm state), connected (connection state), screen (screen state)
 */
export function DesktopRecording({
  vm,
  connected,
  screen,
}: {
  vm: { id: string; name: string };
  connected: boolean;
  screen: RefObject<HTMLDivElement | null>;
}) {
  const [progress, setProgress] = useState<RecordingProgress>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [result, setResult] = useState<{ entry: RecordingEntry; blob: Blob; saved: boolean }>();
  const [revision, setRevision] = useState(0),
    [name, setName] = useState(`${vm.name} ${formatDateTime(new Date())}`);
  const recorder = useRef<DesktopRecorder | undefined>(undefined);
  const dirty = useRef(false),
    alive = useRef(true);
  dirty.current = !!progress || (!!result && !result.saved);
  const action = useAction();
  const connectionHintId = useId();
  useEffect(/** 中文：当依赖 [] 变化时登记浏览器或资源事件监听；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, register browser/resource event listeners. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    alive.current = true;
    const remove = registerEditorGuard(
      async () =>
        !dirty.current || confirm('离开将停止录制并丢弃尚未保存到录制库的内容。已下载的文件不受影响。继续？'),
    );
    /**
     * 中文：在管理桌面录制、录制库、回放和导出流程中阻止浏览器默认行为；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Managing desktop recording, the recording library, playback and export, prevent browser default behavior. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    /**
     * 中文：在管理桌面录制、录制库、回放和导出流程中释放所属连接或界面寿命，移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Managing desktop recording, the recording library, playback and export, dispose owned connection/UI lifetimes, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive.current = false;
      recorder.current?.dispose();
      recorder.current = undefined;
      window.removeEventListener('beforeunload', unload);
      remove();
    };
  }, []);
  useEffect(/** 中文：当依赖 [connected] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [connected] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!connected) recorder.current?.stop('桌面连接已断开，录制已自动结束');
  }, [connected]);
  /**
   * 中文：在管理桌面录制、录制库、回放和导出流程中错误反馈，完成提示，操作结果，进度快照；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Managing desktop recording, the recording library, playback and export, error feedback, completion message, operation result, progress snapshot. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const start = () => {
    if (!connected || recorder.current) return;
    if (result && !result.saved && !confirm('丢弃当前未保存的录制并重新开始？')) return;
    const source = screen.current?.querySelector('canvas');
    if (!source) {
      setError('桌面画面尚未就绪');
      return;
    }
    setError('');
    setMessage('');
    setResult(undefined);
    const createdAt = new Date().toISOString(),
      title = name.trim() || vm.name;
    try {
      recorder.current = new DesktopRecorder(
        source,
        setProgress,
        /**
         * 中文功能：收到录制完成值后清除当前录制器；界面仍存活时保存 blob、时长、尺寸和名称为尚未保存的结果。
         * English: Clear the recorder on completion; while the view is alive, retain blob/duration/dimensions/name as an unsaved result.
         * 输入 / Inputs: value.
         * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
         * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
         * 设计思路：先解除 recorder 引用，再检查 alive，防止卸载后更新 React 状态，但仍确保完成的录制器不继续被认为在运行。
         * Design: Clear the recorder reference before checking alive to avoid state updates after unmount while ensuring a completed recorder is no longer considered running.
         */
        (value) => {
          recorder.current = undefined;
          if (!alive.current) return;
          setProgress(undefined);
          setMessage(value.reason);
          setResult({
            entry: {
              id: crypto.randomUUID(),
              vmId: vm.id,
              vmName: vm.name,
              name: title,
              createdAt,
              bytes: value.blob.size,
              milliseconds: value.milliseconds,
              width: value.width,
              height: value.height,
              mime: value.blob.type,
            },
            blob: value.blob,
            saved: false,
          });
        },
        (message) => {
          recorder.current = undefined;
          if (alive.current) {
            setProgress(undefined);
            setError(message);
          }
        },
      );
    } catch (error) {
      setProgress(undefined);
      setError((error as Error).message);
    }
  };
  const status = progress?.status === 'paused' ? '已暂停'
    : progress?.status === 'stopping' ? '正在完成视频'
      : progress ? '正在录制'
        : result ? (result.saved ? '已保存到录制库' : '录制已结束，尚未保存')
          : error ? '录制遇到问题' : connected ? '准备就绪' : '桌面未连接';
  return (
    <section className="desktop-recording" aria-label="桌面录制">
      <h3>桌面录制与回放</h3>
      <p>录制当前 Linux 桌面画面，无音频。最高 1080p、15 帧/秒；30 分钟或接近 128 MiB 时自动结束。</p>
      <Feedback error={error || action.error} message={action.message || message} />
      <div className={'recording-summary ' + (progress?.status || (result ? 'finished' : 'idle'))}>
        <span className="recording-status" role="status"><span aria-hidden="true" />{status}</span>
        <dl className="recording-metrics">
          <div><dt>已录时长</dt><dd>{duration(progress?.milliseconds ?? result?.entry.milliseconds ?? 0)}</dd></div>
          <div><dt>文件大小</dt><dd>{size(progress?.bytes ?? result?.entry.bytes ?? 0)}</dd></div>
        </dl>
        {progress?.status === 'paused' && <p>暂停期间不计入录制时长，继续后接着录制。</p>}
        {progress?.status === 'stopping' && <p>正在整理视频数据，完成后可下载或保存到录制库。</p>}
      </div>
      {!connected && <p id={connectionHintId} className="recording-connection-hint">连接 Linux 桌面后即可开始录制。</p>}
      <label>
        录制名称
        <input
          value={name}
          maxLength={100}
          disabled={!!progress}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="feature-actions recording-actions">
        <button
          className={(progress ? 'secondary' : 'primary') + ' compact'}
          disabled={!connected || !!progress || action.busy}
          aria-describedby={!connected ? connectionHintId : undefined}
          onClick={start}
        >
          开始录制
        </button>
        {progress && (
          <>
            <button
              className={(progress.status === 'paused' ? 'primary' : 'secondary') + ' compact'}
              disabled={progress.status === 'stopping'}
              onClick={() =>
                progress.status === 'paused' ? recorder.current?.resume() : recorder.current?.pause()
              }
            >
              {progress.status === 'paused' ? '继续录制' : '暂停录制'}
            </button>
            <button
              className="secondary compact recording-stop"
              disabled={progress.status === 'stopping'}
              onClick={() => recorder.current?.stop()}
            >
              停止录制
            </button>
          </>
        )}
      </div>
      {result && (
        <div className="recording-current">
          <h4>本次录制 · <span data-locale-ignore>{result.entry.name}</span></h4>
          <p>
            {duration(result.entry.milliseconds)} · {result.entry.width} × {result.entry.height} ·{' '}
            {size(result.entry.bytes)}
          </p>
          <Player blob={result.blob} milliseconds={result.entry.milliseconds} />
          <div className="feature-actions">
            <button
              className="primary compact"
              onClick={() => exportRecording(result.blob, result.entry.name)}
            >
              下载本次录制
            </button>
            <button
              className="secondary compact"
              disabled={result.saved || action.busy}
              onClick={() =>
                void action.run(/** 中文：在管理桌面录制、录制库、回放和导出流程中操作结果，revision 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Managing desktop recording, the recording library, playback and export, operation result, revision state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                  await saveRecording(result.entry, result.blob);
                  if (alive.current) {
                    setResult((current) =>
                      current?.entry.id === result.entry.id ? { ...current, saved: true } : current,
                    );
                    setRevision((n) => n + 1);
                  }
                }, '已保存到本浏览器录制库')
              }
            >
              {result.saved ? '已保存到录制库' : '保存到录制库'}
            </button>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={() => {
                if (result.saved || confirm('丢弃此次录制？请先下载或保存需要保留的内容。'))
                  setResult(undefined);
              }}
            >
              清除本次预览
            </button>
          </div>
        </div>
      )}
      <p className="subtle-note">
        录制仅在本浏览器处理。保存到录制库需主动点击；离开或锁定会停止并丢弃未保存内容。下载可独立保留 WebM
        文件。
      </p>
      <RecordingLibrary
        revision={revision}
        onRemoved={(id) =>
          setResult((current) =>
            current && (!id || current.entry.id === id) ? { ...current, saved: false } : current,
          )
        }
      />
    </section>
  );
}
