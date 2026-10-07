/**
 * 模块职责（中文）：装配 noVNC 远程桌面、连接设置、分辨率与剪贴板/录制控制。
 * Module responsibility (English): Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling.
 * 详细范围（中文）：公开入口包括 DesktopPanel；职责覆盖连接桌面、配置偏好与剪贴板并协调状态轮询，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include DesktopPanel. The scope covers Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type RFB from '@novnc/novnc';
import { socketPath } from '../shared/socket-client.ts';
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
import type { JobView } from '../shared/contracts/jobs.ts';
import type { DesktopPreferences } from '../shared/desktop-preferences.ts';
import type { DesktopView, VMView } from '../shared/contracts/vm.ts';
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
  start: /** 中文：请求启动客户机，兑现后由外层更新状态；这是 Props 的调用契约 | English: Request guest startup, allowing the owner to update state after fulfillment; this is the callable contract of Props | 中文：结果：unknown；调用者依赖此类型约定 | English: Result: unknown; callers depend on this type contract */ () => unknown;
  busy: boolean;
  configure: /** 中文：请求跳转到实例配置界面；这是 Props 的调用契约 | English: Request navigation to VM configuration; this is the callable contract of Props | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  request: Request;
};

/**
 * 中文：呈现连接桌面、配置偏好与剪贴板并协调状态轮询中的 DesktopPanel 界面，订阅 /vms/{vm.id}/ime，组合 Monitor、Square、SlidersHorizontal、Clipboard、RefreshCw、Minimize2、Maximize2、DesktopRecording，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DesktopPanel surface for Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, subscribing to /vms/{vm.id}/ime and composing Monitor, Square, SlidersHorizontal, Clipboard, RefreshCw, Minimize2, Maximize2, DesktopRecording. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, token, start, busy, configure, request } 提供 vm（vm 状态）、token（当前传输认证凭证）、start（start 状态）、busy（忙碌标记）、configure（configure 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, token, start, busy, configure, request } provides context fields vm (vm state), token (current transport credential), start (start state), busy (busy flag), configure (configure state), request (transport capability bound to identity/authority scope)
 */
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
  const [clipboardTransport, setClipboardTransport] = useState<'x11' | 'wayland'>('x11');
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
  useEffect(/** 中文：当依赖 [clipboardPolicies, detectSensitive, vm.id] 变化时incoming 状态，outgoing 状态，attempt 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [clipboardPolicies, detectSensitive, vm.id] change, incoming state, outgoing state, attempt state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
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

  useEffect(/** 中文：当依赖 [vm.id] 变化时preferenceState 状态，showCustomizer 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vm.id] change, preferenceState state, showCustomizer state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setPreferenceState(loadDesktopPreferences(vm.id, () => localStorage));
    setShowCustomizer(false);
  }, [vm.id]);

  useEffect(/** 中文：当依赖 [vm.id, preferenceState] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vm.id, preferenceState] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    saveDesktopPreferences(vm.id, preferenceState, () => localStorage);
  }, [vm.id, preferenceState]);

  useEffect(/** 中文：当依赖 [] 变化时登记浏览器或资源事件监听；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, register browser/resource event listeners. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    /**
     * 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中fullscreen 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, fullscreen state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    const changed = () => setFullscreen(document.fullscreenElement === frame.current);
    document.addEventListener('fullscreenchange', changed);
    /**
     * 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(/** 中文：读取 GET /vms/{vm.id}/desktop，完成连接桌面、配置偏好与剪贴板并协调状态轮询的数据交互并更新submitting 状态、desktop 状态、错误反馈、statusError 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{vm.id}/desktop for Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling and update submitting state, desktop state, error feedback, statusError state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    // 桌面绑定或实例运行代次变化时失效已有轮询；alive 和请求顺序共同阻止旧状态恢复新界面的连接。
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
    /**
     * 中文：读取 GET /vms/{vm.id}/desktop，完成连接桌面、配置偏好与剪贴板并协调状态轮询的数据交互并更新timeout 状态、desktop 状态、preferenceState 状态、statusError 状态；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform GET /vms/{vm.id}/desktop for Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling and update timeout state, desktop state, preferenceState state, statusError state. Propagate asynchronous failure to this catch path or the outer action feedback
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
     * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
     */
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
    /**
     * 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中取消捕获的异步寿命，使匹配资源缓存失效，取消延迟计时任务；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, abort the captured asynchronous lifetime, invalidate matching resource caches, cancel delayed timers. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive = false;
      abort.abort();
      enabling.current?.abort();
      enabling.current = null;
      statusOrder.current.invalidate();
      clearTimeout(timer);
    };
  }, [vm.id, vm.startedAt, running, request, attempt]);

  useEffect(/** 中文：当依赖 [desktop?.log] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [desktop?.log] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (installLog.current && followLog.current)
      installLog.current.scrollTop = installLog.current.scrollHeight;
  }, [desktop?.log]);

  useEffect(/** 中文：懒加载 @novnc/novnc 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load @novnc/novnc and adapt its selected export as the default React component, deferring this feature's UI code download | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    setConnected(false);
    if (!ready || !screen.current) return;
    let alive = true;
    let controller: ReturnType<typeof connectDesktop> | undefined;
    setError('');
    setConnection('正在连接桌面…');
    // Load the graphics client only when the desktop is used.
    void import('@novnc/novnc')
      .then(/** 中文：更新 controller、connectionRef.current 以维护连接桌面、配置偏好与剪贴板并协调状态轮询当前状态；这些赋值属于此输入/事件的状态转换 | English: Update controller, connectionRef.current to maintain current state for Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling; these assignments belong to this input/event transition | 中文：输入：{ default: RFBClient } 提供 default（default 状态） 上下文字段 | English: Inputs: { default: RFBClient } provides context fields default (default state) | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ ({ default: RFBClient }) => {
        if (!alive || !screen.current) return;
        const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const target = screen.current;
        controller = connectDesktop(
          /**
           * 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中登记浏览器或资源事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
           * English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, register browser/resource event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
           */
          () => {
            const client = new RFBClient(
              target,
              `${scheme}//${location.host}` + socketPath('desktop', { vmId: vm.id },
                { token, project: desktop?.projectId || undefined }),
            );
            client.scaleViewport = true;
            client.resizeSession = desktop?.preferences?.monitorLayout !== 'dual-horizontal' &&
              desktop?.preferences?.monitorLayout !== 'dual-vertical';
            client.background = '#201b24';
            clientRef.current = client;
            client.addEventListener('clipboard', /** 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中incoming 状态，clipboardError 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, incoming state, clipboardError state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (event) => {
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
    /**
     * 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中释放所属连接或界面寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, dispose owned connection/UI lifetimes. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive = false;
      controller?.dispose();
      connectionRef.current = null;
      clientRef.current = null;
      sentClipboard.current = '';
    };
  }, [vm.id, vm.startedAt, ready, token, attempt, desktop?.preferences?.monitorLayout, desktop?.projectId]);

  /**
   * 中文：提交 POST /vms/{vm.id}/desktop；GET /vms/{vm.id}/desktop，完成连接桌面、配置偏好与剪贴板并协调状态轮询的数据交互并更新submitting 状态、错误反馈、desktop 状态、showCustomizer 状态、statusError 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/desktop; GET /vms/{vm.id}/desktop for Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling and update submitting state, error feedback, desktop state, showCustomizer state, statusError state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：action：本次动作或状态机输入
   * English: Inputs: action: current action/state-machine input
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
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

  /**
   * 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中preferenceState 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, preferenceState state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：patch：只包含修改字段的增量
   * English: Inputs: patch: delta containing modified fields only
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const updatePreferences = (patch: Partial<DesktopPreferences>) => {
    setPreferenceState((current) => editDesktopPreferences(current, patch));
  };
  /**
   * 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中showCustomizer 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, showCustomizer state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const applyPreferences = () => {
    if (desktop?.status === 'ready' || desktop?.status === 'stopped') {
      void enable('configure');
    } else {
      setShowCustomizer(false);
    }
  };
  /**
   * 中文：把桌面偏好草稿改为完整默认值，使用同一编辑入口标记待应用；尚未向客户机写入。
   * English: Replace the desktop draft with complete defaults through the shared editing entry, marking pending application without yet writing to the guest.
   */
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
            {desktop && (desktop.cleanupPending || ['ready', 'starting', 'installing'].includes(desktop.status)) && (
              <button className="secondary compact" disabled={submitting}
                title="停止 KDE 会话及其程序；请先保存桌面中的工作"
                onClick={() => void enable('stop')}>
                <Square size={14} /> {desktop.cleanupPending ? '重试停止桌面' : '停止桌面'}
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
              onClick={/** 中文：在连接桌面、配置偏好与剪贴板并协调状态轮询流程中showRecording 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling, showRecording state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
                      void clipboardAction.run(/** 中文：提交 POST /vms/{vm.id}/ime，完成连接桌面、配置偏好与剪贴板并协调状态轮询的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/ime for Connecting the desktop, configuring preferences and clipboard behavior, and coordinating status polling. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
      {showX11Clipboard && running && <>
        <label className="system-card">
          剪贴板应用类型
          <select value={clipboardTransport} onChange={(event) => setClipboardTransport(event.target.value as 'x11' | 'wayland')}>
            <option value="x11">X11 应用</option>
            <option value="wayland">原生 Wayland 应用</option>
          </select>
        </label>
        <X11ClipboardSettings key={clipboardTransport} vmId={vm.id} desktopReady={ready} request={request} transport={clipboardTransport} />
      </>}
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
              <span>桌面会话类型</span>
              <select value={preferences.sessionType} onChange={(event) =>
                updatePreferences({ sessionType: event.target.value as DesktopPreferences['sessionType'] })}>
                <option value="auto">自动选择</option>
                <option value="x11">X11</option>
                <option value="wayland">原生 Wayland</option>
              </select>
              <small>切换类型会重启桌面，请先保存应用内容。</small>
            </label>
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
                <b>项目桌面账号</b>
                <small>独立主目录与项目权限</small>
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
                disabled={submitting || desktop.cleanupPending}
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
