import { useEffect, useRef, useState, type RefObject } from 'react';
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

const duration = (ms: number) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const size = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
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
function Player({ blob, milliseconds }: { blob: Blob; milliseconds: number }) {
  const [url, setUrl] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState(0),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
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
export function RecordingLibrary({
  revision = 0,
  onRemoved,
}: {
  revision?: number;
  onRemoved?: (id?: string) => void;
}) {
  const [entries, setEntries] = useState<RecordingEntry[]>([]),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<{ entry: RecordingEntry; blob: Blob }>();
  const action = useAction();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
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
          void action.run(async () => {
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
              <strong>{entry.name}</strong>
              <p>
                {entry.vmName} · {new Date(entry.createdAt).toLocaleString()} · {duration(entry.milliseconds)}{' '}
                · {size(entry.bytes)}
              </p>
            </div>
            <div className="feature-actions">
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const blob = await recordingBlob(entry);
                    if (alive.current) setSelected({ entry, blob });
                  })
                }
              >
                回放 {entry.name}
              </button>
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    const blob = await recordingBlob(entry);
                    if (alive.current) exportRecording(blob, entry.name);
                  })
                }
              >
                下载 {entry.name}
              </button>
              <button
                className="text-button danger-text"
                disabled={action.busy}
                onClick={() => {
                  if (!confirm(`删除录制“${entry.name}”？请先下载需要保留的文件。`)) return;
                  void action.run(async () => {
                    await deleteRecording(entry.id);
                    onRemoved?.(entry.id);
                    if (alive.current) {
                      if (selected?.entry.id === entry.id) setSelected(undefined);
                      setRefresh((n) => n + 1);
                    }
                  }, '录制已删除');
                }}
              >
                删除 {entry.name}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {selected && (
        <div>
          <h4>{selected.entry.name}</h4>
          <Player blob={selected.blob} milliseconds={selected.entry.milliseconds} />
          <button className="secondary compact" onClick={() => setSelected(undefined)}>
            关闭回放
          </button>
        </div>
      )}
    </section>
  );
}
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
    [name, setName] = useState(`${vm.name} ${new Date().toLocaleString()}`);
  const recorder = useRef<DesktopRecorder | undefined>(undefined);
  const dirty = useRef(false),
    alive = useRef(true);
  dirty.current = !!progress || (!!result && !result.saved);
  const action = useAction();
  useEffect(() => {
    alive.current = true;
    const remove = registerEditorGuard(
      async () =>
        !dirty.current || confirm('离开将停止录制并丢弃尚未保存到录制库的内容。已下载的文件不受影响。继续？'),
    );
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      alive.current = false;
      recorder.current?.dispose();
      recorder.current = undefined;
      window.removeEventListener('beforeunload', unload);
      remove();
    };
  }, []);
  useEffect(() => {
    if (!connected) recorder.current?.stop('桌面连接已断开，录制已自动结束');
  }, [connected]);
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
  return (
    <section className="desktop-recording" aria-label="桌面录制">
      <h3>桌面录制与回放</h3>
      <p>录制当前 Linux 桌面画面，无音频。最高 1080p、15 帧/秒；30 分钟或接近 128 MiB 时自动结束。</p>
      <Feedback error={error || action.error} message={action.message || message} />
      <label>
        录制名称
        <input
          value={name}
          maxLength={100}
          disabled={!!progress}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="feature-actions">
        <button
          className="primary compact"
          disabled={!connected || !!progress || action.busy}
          onClick={start}
        >
          开始录制
        </button>
        {progress && (
          <>
            <button
              className="secondary compact"
              disabled={progress.status === 'stopping'}
              onClick={() =>
                progress.status === 'paused' ? recorder.current?.resume() : recorder.current?.pause()
              }
            >
              {progress.status === 'paused' ? '继续录制' : '暂停录制'}
            </button>
            <button
              className="secondary compact"
              disabled={progress.status === 'stopping'}
              onClick={() => recorder.current?.stop()}
            >
              停止录制
            </button>
            <span role="status">
              {progress.status === 'paused'
                ? '已暂停'
                : progress.status === 'stopping'
                  ? '正在完成视频'
                  : '正在录制'}{' '}
              · {duration(progress.milliseconds)} · {size(progress.bytes)}
            </span>
          </>
        )}
      </div>
      {result && (
        <div className="recording-current">
          <h4>本次录制 · {result.entry.name}</h4>
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
                void action.run(async () => {
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
