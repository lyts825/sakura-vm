import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, Maximize2, Minimize2, Monitor, Play, RefreshCw } from 'lucide-react';
import type { DesktopView, VMView } from '../server/model';
import { connectDesktop } from './desktop-connection';
import { ResponseOrder } from './request-order';
import './desktop.css';
import type RFB from '@novnc/novnc';
import { Feedback, JobLog, useAction, useRemote, type Request } from './FeaturePanels';
import type { JobView } from '../server/jobs';

type Props = {
  vm: VMView;
  token: string;
  start: () => unknown;
  busy: boolean;
  configure: () => void;
  request: Request;
};

export function DesktopPanel({ vm, token, start, busy, configure, request }: Props) {
  const [desktop, setDesktop] = useState<DesktopView | null>(null);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const enabling = useRef<AbortController | null>(null);
  const statusOrder = useRef(new ResponseOrder());
  const [connection, setConnection] = useState('正在连接桌面…');
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const clientRef = useRef<RFB | null>(null);
  const [showClipboard, setShowClipboard] = useState(false);
  const [outgoing, setOutgoing] = useState('');
  const [incoming, setIncoming] = useState('');
  const clipboardAction = useAction();
  const ime = useRemote<JobView>(request, `/vms/${vm.id}/ime`, vm.status === 'running', 2500);
  const screen = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const installLog = useRef<HTMLPreElement>(null);
  const followLog = useRef(true);
  const running = vm.status === 'running';
  const ready = running && desktop?.status === 'ready';
  const lowMemory = vm.memoryMiB < 1024;

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    statusOrder.current.invalidate();
    setSubmitting(false);
    if (!running) {
      setDesktop(null);
      setError('');
      setStatusError('');
      return;
    }
    let alive = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (enabling.current) {
        timer = setTimeout(poll, 2500);
        return;
      }
      const version = statusOrder.current.start();
      let interval = 2500;
      try {
        const view = await request<DesktopView>(`/vms/${vm.id}/desktop`, 'GET', undefined, abort.signal);
        if (alive && statusOrder.current.accept(version)) {
          setDesktop(view);
          setStatusError('');
        }
        if (view.status === 'ready') interval = 10000;
      } catch (e) {
        if (alive && statusOrder.current.accept(version)) setStatusError((e as Error).message);
      } finally {
        if (alive) timer = setTimeout(poll, interval);
      }
    };
    void poll();
    return () => {
      alive = false;
      abort.abort();
      enabling.current?.abort();
      enabling.current = null;
      statusOrder.current.invalidate();
      clearTimeout(timer);
    };
  }, [vm.id, running, request]);

  useEffect(() => {
    if (installLog.current && followLog.current)
      installLog.current.scrollTop = installLog.current.scrollHeight;
  }, [desktop?.log]);

  useEffect(() => {
    if (!ready || !screen.current) return;
    let alive = true;
    let disconnect: (() => void) | undefined;
    setConnected(false);
    setError('');
    setConnection('正在连接桌面…');
    // Load the graphics client only when the desktop is used.
    void import('@novnc/novnc')
      .then(({ default: RFBClient }) => {
        if (!alive || !screen.current) return;
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const target = screen.current;
        disconnect = connectDesktop(
          () => {
            const client = new RFBClient(
              target,
              `${scheme}//${location.host}/ws/${vm.id}/desktop?token=${encodeURIComponent(token)}`,
            );
            client.scaleViewport = true;
            client.resizeSession = true;
            client.background = '#201b24';
            clientRef.current = client;
            client.addEventListener('clipboard', (event) => {
              if (alive) setIncoming((event as CustomEvent<{ text: string }>).detail.text);
            });
            return client;
          },
          (state) => {
            if (!alive) return;
            setConnected(state.connected);
            setConnection(state.message);
            setError(state.error || '');
          },
        );
      })
      .catch((e: Error) => {
        if (alive) setError(`桌面客户端加载失败：${e.message}`);
      });
    return () => {
      alive = false;
      disconnect?.();
      clientRef.current = null;
    };
  }, [vm.id, ready, token, attempt]);

  const enable = useCallback(
    async (action: 'install' | 'start') => {
      if (!running || enabling.current) return;
      const abort = new AbortController();
      enabling.current = abort;
      statusOrder.current.invalidate();
      const version = statusOrder.current.start();
      setSubmitting(true);
      setError('');
      try {
        const view = await request<DesktopView>(`/vms/${vm.id}/desktop`, 'POST', { action }, abort.signal);
        if (enabling.current === abort && statusOrder.current.accept(version)) {
          setDesktop(view);
          setStatusError('');
        }
      } catch (e) {
        if (enabling.current === abort && statusOrder.current.accept(version)) setError((e as Error).message);
      } finally {
        if (enabling.current === abort) {
          enabling.current = null;
          setSubmitting(false);
        }
      }
    },
    [request, vm.id, running],
  );

  const installing = desktop?.status === 'installing' || desktop?.status === 'starting';
  return (
    <div className="desktop-panel" ref={frame}>
      <div className="desktop-toolbar">
        <div>
          <Monitor size={16} />
          <b>Xfce 桌面</b>
          <span className="desktop-preview-label">实验性</span>
        </div>
        {ready && (
          <div>
            <button
              className="secondary compact"
              aria-expanded={showClipboard}
              onClick={() => setShowClipboard((v) => !v)}
            >
              剪贴板
            </button>
            <button
              className="secondary compact"
              disabled={clipboardAction.busy || ime.data?.status === 'running'}
              onClick={() => {
                if (confirm('安装中文输入法会重启图形桌面，请先保存桌面中的工作。继续？'))
                  void clipboardAction.run(async () => {
                    await request(`/vms/${vm.id}/ime`, 'POST');
                    ime.reload();
                  });
              }}
            >
              中文输入法
            </button>
            <button className="secondary compact" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw size={14} />
              重新连接
            </button>
            <button
              className="secondary compact"
              onClick={() => {
                void (
                  document.fullscreenElement ? document.exitFullscreen() : frame.current?.requestFullscreen()
                )?.catch(() => setError('当前浏览器无法进入全屏，请使用发行版的专注模式'));
              }}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              {fullscreen ? '退出全屏' : '全屏'}
            </button>
          </div>
        )}
      </div>
      {(error || statusError) && (
        <div className="machine-error" role="alert">
          {error || statusError}
        </div>
      )}
      <Feedback error={clipboardAction.error} message={clipboardAction.message} />
      {showClipboard && ready && (
        <div className="desktop-clipboard">
          <textarea
            aria-label="发送到 Linux 的文本"
            placeholder="粘贴要发送到 Linux 的文本"
            value={outgoing}
            onChange={(e) => setOutgoing(e.target.value)}
          />
          <button
            className="secondary compact"
            disabled={!connected}
            onClick={() => {
              clientRef.current?.clipboardPasteFrom(outgoing);
            }}
          >
            发送到 Linux
          </button>
          <textarea
            aria-label="Linux 剪贴板文本"
            placeholder="在 Linux 中复制后，文本会出现在这里"
            readOnly
            value={incoming}
          />
          <button
            className="secondary compact"
            disabled={!incoming}
            onClick={() =>
              void clipboardAction.run(
                () => navigator.clipboard.writeText(incoming),
                '已复制到 Windows 剪贴板',
              )
            }
          >
            复制到 Windows
          </button>
        </div>
      )}
      {ime.data && (
        <details className="desktop-ime-log">
          <summary>中文输入安装 · Ctrl+Space 切换</summary>
          <JobLog job={ime.data} />
        </details>
      )}
      {ready ? (
        <>
          <div className="desktop-screen" ref={screen} aria-label="Linux 图形桌面" />
          <div className="desktop-footer" role="status">
            <span className={connected ? 'desktop-connected' : ''}>{connection}</span>
            <span>点击画面操作 · 自动适应窗口</span>
          </div>
        </>
      ) : (
        <div className="desktop-welcome">
          {installing || (running && !desktop) ? (
            <LoaderCircle size={34} className="spin" />
          ) : (
            <Monitor size={34} />
          )}
          <h3>
            {!running
              ? '启动 Linux，进入图形桌面'
              : installing
                ? '正在准备 Xfce 桌面'
                : desktop?.status === 'stopped'
                  ? '桌面会话已停止'
                  : desktop?.status === 'error'
                    ? '桌面准备未完成'
                    : '给 Linux 添一个桌面'}
          </h3>
          <p>
            轻量 Xfce
            桌面，包含文件管理器和图形终端。首次安装需要联网，之后随发行版启动，文件保存在实例磁盘中。
          </p>
          <p>至少 1 GiB 内存，建议 2 GiB。桌面使用独立用户，主目录为 /home/sakura-desktop。</p>
          {!running ? (
            <button className="primary" onClick={start} disabled={busy || vm.poweredOn}>
              <Play size={15} />
              {vm.poweredOn ? '等待系统就绪…' : '启动发行版'}
            </button>
          ) : lowMemory ? (
            <button className="secondary" onClick={configure}>
              内存不足，前往配置
            </button>
          ) : (
            desktop &&
            !installing && (
              <button
                className="primary"
                disabled={submitting}
                onClick={() => void enable(desktop.status === 'stopped' ? 'start' : 'install')}
              >
                {submitting ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
                {desktop.status === 'stopped'
                  ? '启动桌面'
                  : desktop.status === 'error'
                    ? '重试安装与启动'
                    : '安装并启用桌面'}
              </button>
            )
          )}
          {desktop?.error && (
            <p className="desktop-error" role="alert">
              {desktop.error}
            </p>
          )}
          {desktop?.log && (
            <pre
              className="desktop-log"
              aria-label="桌面安装日志"
              ref={installLog}
              onScroll={(event) => {
                const element = event.currentTarget;
                followLog.current = element.scrollHeight - element.clientHeight - element.scrollTop < 40;
              }}
            >
              {desktop.log}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
