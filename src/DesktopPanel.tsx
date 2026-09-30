import type RFB from '@novnc/novnc';
import {
  CircleCheck,
  Clipboard,
  Copy,
  Download,
  HardDrive,
  Keyboard,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Monitor,
  MousePointer2,
  Palette,
  PanelTop,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  WandSparkles,
  Wifi,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { JobView } from '../server/jobs';
import type { DesktopPreferences, DesktopView, VMView } from '../server/model';
import { connectDesktop } from './desktop-connection';
import {
  desktopPreferenceDefaults,
  editDesktopPreferences,
  loadDesktopPreferences,
  receiveDesktopPreferences,
  saveDesktopPreferences,
} from './desktop-preferences';
import './desktop.css';
import { Feedback, JobLog, useAction, useRemote, type Request } from './feature-shared';
import { ResponseOrder } from './request-order';
import {
  assertClipboardTransfer,
  clipboardProtectionEnabled,
  subscribeClipboardProtection,
  writeProtectedClipboard,
} from './clipboard-protection';
import { getClipboardPolicies, subscribeClipboardPolicies } from './clipboard-policy';
import { effectiveClipboardRule } from '../shared/clipboard-policy';
import { DesktopRecording } from './DesktopRecording';
import { mayLeaveEditor } from './file-editor-state';
import { SingleAppWindowsPanel } from './SingleAppWindowsPanel';
import { X11ClipboardSettings } from './X11ClipboardSettings';

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
  const connectionRef = useRef<ReturnType<typeof connectDesktop> | null>(null);
  const guestAvailable = useRef(true);
  const [showClipboard, setShowClipboard] = useState(false);
  const [showRecording, setShowRecording] = useState(false);
  const [showApps, setShowApps] = useState(false);
  const [showX11Clipboard, setShowX11Clipboard] = useState(false);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [preferenceState, setPreferenceState] = useState(() =>
    loadDesktopPreferences(vm.id, () => localStorage),
  );
  const preferences = preferenceState.preferences;
  const [outgoing, setOutgoing] = useState('');
  const [incoming, setIncoming] = useState('');
  const sentClipboard = useRef('');
  const clipboardAction = useAction();
  const clipboardPolicies = useSyncExternalStore(subscribeClipboardPolicies, getClipboardPolicies);
  const detectSensitive = useSyncExternalStore(subscribeClipboardProtection, clipboardProtectionEnabled);
  const clipboardContext = { app: 'desktop' as const, vmId: vm.id };
  const clipboardRule = effectiveClipboardRule(clipboardPolicies.policies, clipboardContext);
  const [clipboardError, setClipboardError] = useState('');
  useEffect(() => {
    try {
      assertClipboardTransfer(clipboardContext, 'copy', incoming);
    } catch {
      setIncoming('');
    }
    try {
      assertClipboardTransfer(clipboardContext, 'paste', outgoing);
    } catch {
      setOutgoing('');
    }
    if (sentClipboard.current) {
      try {
        assertClipboardTransfer(clipboardContext, 'paste', sentClipboard.current);
      } catch {
        // noVNC may answer delayed extended-clipboard requests from its cache.
        // Reconnect to release that cache without changing the guest clipboard.
        sentClipboard.current = '';
        setAttempt((value) => value + 1);
      }
    }
  }, [clipboardPolicies, detectSensitive, vm.id]);
  const ime = useRemote<JobView>(request, `/vms/${vm.id}/ime`, vm.status === 'running', 2500);
  const screen = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const installLog = useRef<HTMLPreElement>(null);
  const followLog = useRef(true);
  const running = vm.status === 'running';
  const ready = running && desktop?.status === 'ready' && !desktop.bindingMismatch;
  const lowMemory = vm.memoryMiB < 1024;
  const installing = desktop?.status === 'installing' || desktop?.status === 'starting';
  const desktopState = !running
    ? 'stopped'
    : installing || !desktop
      ? 'preparing'
      : desktop.status === 'error' || desktop.bindingMismatch
        ? 'error'
        : desktop.status === 'stopped'
          ? 'paused'
          : ready
            ? connected
              ? 'connected'
              : 'connecting'
            : 'preparing';
  const desktopStateLabel = {
    stopped: '等待启动',
    preparing: installing ? '正在准备' : '检查桌面状态',
    error: '需要处理',
    paused: '会话已停止',
    connected: '已连接',
    connecting: '正在连接',
  }[desktopState];

  useEffect(() => {
    setPreferenceState(loadDesktopPreferences(vm.id, () => localStorage));
    setShowCustomizer(false);
  }, [vm.id]);

  useEffect(() => {
    saveDesktopPreferences(vm.id, preferenceState, () => localStorage);
  }, [vm.id, preferenceState]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => {
    statusOrder.current.invalidate();
    setSubmitting(false);
    if (!running) {
      guestAvailable.current = false;
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
          guestAvailable.current = view.status === 'ready' && !view.bindingMismatch;
          connectionRef.current?.setAvailable(guestAvailable.current);
          setDesktop(view);
          setPreferenceState((current) => receiveDesktopPreferences(current, view));
          setStatusError('');
        }
        if (view.status === 'ready') interval = 10000;
      } catch (e) {
        if (alive && statusOrder.current.accept(version)) {
          guestAvailable.current = false;
          connectionRef.current?.setAvailable(false);
          setStatusError((e as Error).message);
        }
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
  }, [vm.id, vm.startedAt, running, request, attempt]);

  useEffect(() => {
    if (installLog.current && followLog.current)
      installLog.current.scrollTop = installLog.current.scrollHeight;
  }, [desktop?.log]);

  useEffect(() => {
    setConnected(false);
    if (!ready || !screen.current) return;
    let alive = true;
    let controller: ReturnType<typeof connectDesktop> | undefined;
    setError('');
    setConnection('正在连接桌面…');
    // Load the graphics client only when the desktop is used.
    void import('@novnc/novnc')
      .then(({ default: RFBClient }) => {
        if (!alive || !screen.current) return;
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const target = screen.current;
        controller = connectDesktop(
          () => {
            const client = new RFBClient(
              target,
              `${scheme}//${location.host}/ws/${vm.id}/desktop?token=${encodeURIComponent(token)}` +
                (desktop?.projectId ? `&project=${encodeURIComponent(desktop.projectId)}` : ''),
            );
            client.scaleViewport = true;
            client.resizeSession = desktop?.preferences?.monitorLayout !== 'dual-horizontal' &&
              desktop?.preferences?.monitorLayout !== 'dual-vertical';
            client.background = '#201b24';
            clientRef.current = client;
            client.addEventListener('clipboard', (event) => {
              if (alive && clientRef.current === client) {
                const text = (event as CustomEvent<{ text: string }>).detail.text;
                try {
                  assertClipboardTransfer({ app: 'desktop', vmId: vm.id }, 'copy', text);
                  setIncoming(text);
                  setClipboardError('');
                } catch (error) {
                  setIncoming('');
                  setClipboardError((error as Error).message);
                }
              }
            });
            return client;
          },
          (state) => {
            if (!alive) return;
            if (!state.connected) clientRef.current = null;
            setConnected(state.connected);
            setConnection(state.message);
            setError(state.error || '');
          },
          guestAvailable.current,
        );
        connectionRef.current = controller;
      })
      .catch((e: Error) => {
        if (alive) setError(`桌面客户端加载失败：${e.message}`);
      });
    return () => {
      alive = false;
      controller?.dispose();
      connectionRef.current = null;
      clientRef.current = null;
      sentClipboard.current = '';
    };
  }, [vm.id, vm.startedAt, ready, token, attempt, desktop?.preferences?.monitorLayout, desktop?.projectId]);

  const enable = useCallback(
    async (action: 'install' | 'start' | 'configure' | 'stop') => {
      if (!running || enabling.current) return;
      const abort = new AbortController();
      enabling.current = abort;
      statusOrder.current.invalidate();
      const version = statusOrder.current.start();
      setSubmitting(true);
      setError('');
      try {
        const result = await request<DesktopView>(
          `/vms/${vm.id}/desktop`,
          'POST',
          action === 'stop' ? { action } : { action, preferences },
          abort.signal,
        );
        const view = action === 'stop' ? await request<DesktopView>(
          `/vms/${vm.id}/desktop`, 'GET', undefined, abort.signal) : result;
        if (enabling.current === abort && statusOrder.current.accept(version)) {
          guestAvailable.current = view.status === 'ready' && !view.bindingMismatch;
          connectionRef.current?.setAvailable(guestAvailable.current);
          setDesktop(view);
          if (action === 'configure') setShowCustomizer(false);
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
    [preferences, request, vm.id, running],
  );

  const updatePreferences = (patch: Partial<DesktopPreferences>) => {
    setPreferenceState((current) => editDesktopPreferences(current, patch));
  };
  const applyPreferences = () => {
    if (desktop?.status === 'ready' || desktop?.status === 'stopped') {
      void enable('configure');
    } else {
      setShowCustomizer(false);
    }
  };
  const resetPreferences = () => updatePreferences({ ...desktopPreferenceDefaults });

  return (
    <div className="desktop-panel" ref={frame} data-clipboard-app="desktop" data-clipboard-vm={vm.id}>
      <div className="desktop-toolbar">
        <div className="desktop-toolbar-title">
          <span className={`desktop-state-dot ${desktopState}`} aria-hidden="true" />
          <Monitor size={17} />
          <div className="desktop-title-copy">
            <b>KDE Plasma 桌面</b>
            <span>{desktopStateLabel}</span>
          </div>
          <span className="desktop-preview-label">KDE Plasma · 可自定义</span>
        </div>
        {(ready || running) && (
          <div className="desktop-toolbar-actions">
            {desktop && ['ready', 'starting', 'installing'].includes(desktop.status) && (
              <button className="secondary compact" disabled={submitting}
                title="停止 KDE 会话及其程序；请先保存桌面中的工作"
                onClick={() => void enable('stop')}>
                <Square size={14} /> 停止桌面
              </button>
            )}
            {running && <button
              className={`secondary compact ${showApps ? 'is-active' : ''}`}
              aria-expanded={showApps}
              onClick={() => setShowApps((value) => !value)}
            >
              单应用窗口
            </button>}
            {running && <button className={`secondary compact ${showX11Clipboard ? 'is-active' : ''}`}
              aria-expanded={showX11Clipboard} onClick={() => setShowX11Clipboard(value => !value)}>
              原生应用剪贴板
            </button>}
            <button
              className="secondary compact"
              aria-expanded={showRecording}
              onClick={async () => {
                if (showRecording && !(await mayLeaveEditor())) return;
                setShowRecording((value) => !value);
              }}
            >
              录制与回放
            </button>
            <button
              className={`secondary compact ${showCustomizer ? 'is-active' : ''}`}
              aria-expanded={showCustomizer}
              title="自定义 KDE Plasma 桌面"
              onClick={() => setShowCustomizer((value) => !value)}
            >
              <SlidersHorizontal size={14} />
              外观与布局
            </button>
            {ready && (
              <>
                <button
                  className="secondary compact"
                  aria-expanded={showClipboard}
                  title="打开 Windows 与 Linux 的文本剪贴板"
                  onClick={() => setShowClipboard((v) => !v)}
                >
                  <Clipboard size={14} />
                  剪贴板
                </button>
                <button
                  className="secondary compact"
                  disabled={clipboardAction.busy || ime.data?.status === 'running'}
                  title="安装中文输入法，安装期间会重启图形桌面"
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
                <button
                  className="secondary compact"
                  title="重新建立桌面连接"
                  disabled={submitting}
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  <RefreshCw size={14} />
                  重新连接
                </button>
                <button
                  className="secondary compact"
                  title={fullscreen ? '退出全屏' : '让桌面占满当前窗口'}
                  onClick={() => {
                    void (
                      document.fullscreenElement
                        ? document.exitFullscreen()
                        : frame.current?.requestFullscreen()
                    )?.catch(() => setError('当前浏览器无法进入全屏，请使用发行版的专注模式'));
                  }}
                >
                  {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  {fullscreen ? '退出全屏' : '全屏'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {(error || statusError) && (
        <div className="machine-error" role="alert">
          {error || statusError}
        </div>
      )}
      {showRecording && <DesktopRecording vm={vm} connected={connected} screen={screen} />}
      {showApps && running &&
        <SingleAppWindowsPanel vm={vm} token={token} request={request} />}
      {showX11Clipboard && running && <X11ClipboardSettings vmId={vm.id} desktopReady={ready} request={request} />}
      {showCustomizer && (
        <section className="desktop-customizer" aria-label="KDE Plasma 桌面自定义">
          <div className="desktop-customizer-head">
            <div>
              <span className="desktop-customizer-kicker">
                <Palette size={13} /> KDE Plasma
              </span>
              <h3>把桌面调成你的工作台</h3>
              <p>偏好会写入实例磁盘，重启后仍然保留。应用外观会重启图形会话。</p>
            </div>
            <span className="desktop-customizer-status">
              <span className="desktop-state-dot connected" />
              {preferenceState.pending ? '有未应用的更改' : '配置已同步'}
            </span>
          </div>
          <div className="desktop-presets" role="list" aria-label="外观预设">
            {(
              [
                {
                  id: 'sakura',
                  name: '樱花晨光',
                  hint: '柔和浅色 · 专注',
                  patch: { theme: 'sakura', wallpaper: 'sakura', accent: '#c75b86' },
                },
                {
                  id: 'midnight',
                  name: '夜樱深色',
                  hint: '低亮度 · 长时间工作',
                  patch: { theme: 'midnight', wallpaper: 'midnight', accent: '#e6a6cb' },
                },
                {
                  id: 'paper',
                  name: '纸张留白',
                  hint: '清爽明亮 · 阅读',
                  patch: { theme: 'paper', wallpaper: 'paper', accent: '#6d7fb3' },
                },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                className={`desktop-preset ${preferences.theme === preset.id ? 'selected' : ''} preset-${preset.id}`}
                role="listitem"
                onClick={() => updatePreferences(preset.patch)}
              >
                <span className="desktop-preset-swatch" />
                <span>
                  <b>{preset.name}</b>
                  <small>{preset.hint}</small>
                </span>
              </button>
            ))}
          </div>
          <div className="desktop-customizer-grid">
            <label>
              <span>虚拟屏幕</span>
              <select
                value={preferences.resolution}
                onChange={(event) =>
                  updatePreferences({ resolution: event.target.value as DesktopPreferences['resolution'] })
                }
              >
                <option value="1280x800">1280 × 800 · 轻量</option>
                <option value="1440x900">1440 × 900 · 宽屏</option>
                <option value="1600x1000">1600 × 1000 · 细节</option>
                <option value="1920x1080">1920 × 1080 · 高清</option>
              </select>
            </label>
            <label>
              <span>逻辑屏幕布局</span>
              <select
                value={preferences.monitorLayout}
                onChange={(event) => updatePreferences({
                  monitorLayout: event.target.value as DesktopPreferences['monitorLayout'],
                })}
              >
                <option value="single">单屏</option>
                <option value="dual-horizontal">双屏 · 左右</option>
                <option value="dual-vertical">双屏 · 上下</option>
              </select>
              {preferences.monitorLayout !== 'single' &&
                <small>两个逻辑屏幕显示在同一桌面画布中；全屏可查看完整布局。</small>}
            </label>
            <label>
              <span>界面缩放</span>
              <select
                value={preferences.scale}
                onChange={(event) => updatePreferences({ scale: Number(event.target.value) })}
              >
                <option value={100}>100% · 紧凑</option>
                <option value={125}>125% · 舒适</option>
                <option value={150}>150% · 大字</option>
                <option value={175}>175% · 触控</option>
                <option value={200}>200% · 高可读</option>
              </select>
            </label>
            <label>
              <span>
                <PanelTop size={13} /> 面板位置
              </span>
              <select
                value={preferences.panel}
                onChange={(event) =>
                  updatePreferences({ panel: event.target.value as DesktopPreferences['panel'] })
                }
              >
                <option value="bottom">底部 · 经典</option>
                <option value="top">顶部 · 浏览器式</option>
                <option value="floating">悬浮 · 极简</option>
              </select>
            </label>
            <label>
              <span>壁纸氛围</span>
              <select
                value={preferences.wallpaper}
                onChange={(event) =>
                  updatePreferences({ wallpaper: event.target.value as DesktopPreferences['wallpaper'] })
                }
              >
                <option value="sakura">樱花枝影</option>
                <option value="midnight">月色夜幕</option>
                <option value="paper">暖白纸面</option>
                <option value="plain">纯色留白</option>
              </select>
            </label>
            <label className="desktop-color-field">
              <span>强调色</span>
              <span className="desktop-color-input">
                <input
                  type="color"
                  value={preferences.accent}
                  aria-label="KDE Plasma 强调色"
                  onChange={(event) => updatePreferences({ accent: event.target.value })}
                />
                <code>{preferences.accent.toUpperCase()}</code>
              </span>
            </label>
            <label className="desktop-check-field">
              <input
                type="checkbox"
                checked={preferences.autoHidePanel}
                onChange={(event) => updatePreferences({ autoHidePanel: event.target.checked })}
              />
              <span>面板自动隐藏</span>
            </label>
            <label className="desktop-check-field">
              <input
                type="checkbox"
                checked={preferences.animations}
                onChange={(event) => updatePreferences({ animations: event.target.checked })}
              />
              <span>保留窗口动画</span>
            </label>
          </div>
          <div className="desktop-customizer-foot">
            <span>
              <WandSparkles size={13} /> KDE 设置会在下次会话启动时完整加载
            </span>
            <div>
              <button className="text-button" onClick={resetPreferences} disabled={submitting}>
                <RotateCcw size={13} /> 恢复默认
              </button>
              <button
                className="primary compact"
                onClick={applyPreferences}
                disabled={submitting || installing}
              >
                {submitting ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
                {desktop?.status === 'ready' || desktop?.status === 'stopped'
                  ? '应用并重启桌面'
                  : '保存桌面偏好'}
              </button>
            </div>
          </div>
        </section>
      )}
      <Feedback error={clipboardAction.error || clipboardError} message={clipboardAction.message} />
      {showClipboard && ready && (
        <div className="desktop-clipboard" aria-label="桌面剪贴板桥接">
          <div className="desktop-clipboard-head">
            <div>
              <strong>
                <Clipboard size={15} />
                剪贴板桥接
              </strong>
              <span>在 Windows 与 Linux 之间传递纯文本</span>
            </div>
            <span className={`desktop-clipboard-state ${connected ? 'connected' : ''}`}>
              <span className="tiny-dot" />
              {connected ? '桌面已连接' : '等待桌面连接'}
            </span>
          </div>
          <div className="desktop-clipboard-grid">
            <label className="desktop-clipboard-field">
              <span>
                <b>发送到 Linux</b>
                <small>{outgoing.length} 字符</small>
              </span>
              <textarea
                aria-label="发送到 Linux 的文本"
                disabled={!clipboardRule.paste}
                placeholder="粘贴要发送到 Linux 的文本"
                value={outgoing}
                onChange={(e) => setOutgoing(e.target.value)}
              />
            </label>
            <div className="desktop-clipboard-actions">
              <button
                className="secondary compact"
                disabled={!connected || !clipboardRule.paste}
                onClick={() =>
                  void clipboardAction.run(async () => {
                    if (!clientRef.current) throw new Error('桌面连接尚未就绪');
                    assertClipboardTransfer(clipboardContext, 'paste', outgoing);
                    clientRef.current.clipboardPasteFrom(outgoing);
                    sentClipboard.current = outgoing;
                  }, '文本已发送到 Linux')
                }
              >
                <Send size={14} />
                发送
              </button>
              <span aria-hidden="true">→</span>
            </div>
            <label className="desktop-clipboard-field">
              <span>
                <b>来自 Linux</b>
                <small>{incoming.length} 字符</small>
              </span>
              <textarea
                aria-label="Linux 剪贴板文本"
                placeholder="在 Linux 中复制后，文本会出现在这里"
                readOnly
                value={incoming}
              />
            </label>
            <button
              className="secondary compact desktop-clipboard-copy"
              disabled={!incoming || !clipboardRule.copy}
              onClick={() =>
                void clipboardAction.run(
                  () => writeProtectedClipboard(incoming, clipboardContext),
                  '已复制到 Windows 剪贴板',
                )
              }
            >
              <Copy size={14} />
              复制到 Windows
            </button>
          </div>
          <p className="desktop-clipboard-note">
            <Wifi size={13} /> 文本只在当前本机桌面会话中传递，不会上传到网络。
          </p>
        </div>
      )}
      {ime.data && (
        <details className="desktop-ime-log">
          <summary>
            <Keyboard size={14} />
            中文输入安装 · Ctrl+Space 切换
          </summary>
          <JobLog job={ime.data} />
        </details>
      )}
      {ready ? (
        <>
          <div className="desktop-screen-shell">
            <div className="desktop-screen" ref={screen} aria-label="Linux 图形桌面" />
            <div className="desktop-screen-badge" aria-live="polite">
              <span className={`desktop-state-dot ${desktopState}`} />
              {connected ? '已连接' : connection}
            </div>
          </div>
          <div className="desktop-footer" role="status">
            <span className={connected ? 'desktop-connected' : ''}>
              <span className="desktop-footer-dot" />
              {connection}
            </span>
            <span>
              <MousePointer2 size={13} /> 点击画面操作 · 自动适应窗口
            </span>
          </div>
        </>
      ) : (
        <div className={`desktop-welcome ${installing ? 'is-installing' : ''}`}>
          <div className="desktop-welcome-art" aria-hidden="true">
            <span />
            <div className="desktop-welcome-icon">
              {installing || (running && !desktop) ? (
                <LoaderCircle size={30} className="spin" />
              ) : desktopState === 'error' ? (
                <Monitor size={30} />
              ) : (
                <Sparkles size={30} />
              )}
            </div>
            <span />
          </div>
          <span className={`desktop-eyebrow ${desktopState}`}>
            <span className={`desktop-state-dot ${desktopState}`} />
            {desktopStateLabel}
          </span>
          <div className="desktop-welcome-copy">
            <h3>
              {!running
                ? '启动 Linux，进入图形桌面'
                : desktop?.bindingMismatch
                  ? '桌面正在另一个项目中运行'
                  : installing
                    ? '正在准备 KDE Plasma 桌面'
                  : desktop?.status === 'stopped'
                    ? '桌面会话已停止'
                    : desktop?.status === 'error'
                      ? '桌面准备未完成'
                      : '给 Linux 添一个桌面'}
            </h3>
            <p>
              {desktop?.bindingMismatch
                ? '请先保存旧会话中的工作并停止桌面，再为当前项目启动。桌面及其程序会使用当前项目的网络设置。'
                : 'KDE Plasma 桌面包含 Dolphin 文件管理器和 Konsole 图形终端。首次安装需要联网，之后按保存的项目绑定恢复；文件保存在实例磁盘中。'}
            </p>
          </div>
          <div className="desktop-spec-grid">
            <div>
              <HardDrive size={16} />
              <span>
                <b>独立桌面用户</b>
                <small>/home/sakura-desktop</small>
              </span>
            </div>
            <div>
              <Monitor size={16} />
              <span>
                <b>KDE Plasma</b>
                <small>Dolphin · Konsole · KWin</small>
              </span>
            </div>
            <div>
              <CircleCheck size={16} />
              <span>
                <b>数据保存在实例中</b>
                <small>随发行版磁盘持久化</small>
              </span>
            </div>
          </div>
          <p className="desktop-memory-note">至少 1 GiB 内存，建议 2 GiB。</p>
          {!running ? (
            <button className="primary" onClick={start} disabled={busy || vm.poweredOn}>
              <Play size={15} />
              {vm.poweredOn ? '等待系统就绪…' : '启动发行版'}
            </button>
          ) : desktop?.bindingMismatch ? (
            <button className="primary" disabled={submitting} onClick={() => void enable('stop')}>
              {submitting ? <LoaderCircle className="spin" size={15} /> : <Square size={15} />}
              停止已运行的桌面
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
