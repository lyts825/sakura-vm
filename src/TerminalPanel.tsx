/**
 * 模块职责（中文）：装配 xterm 终端、尺寸适配和 WebSocket 连接，处理输入、剪贴板与终端资源释放。
 * Module responsibility (English): Composing xterm, WebSocket transport, resize handling and input cleanup.
 * 详细范围（中文）：公开入口包括 TerminalPanel；职责覆盖装配 xterm、WebSocket、尺寸适配和输入清理，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TerminalPanel. The scope covers Composing xterm, WebSocket transport, resize handling and input cleanup. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Minus, Play, Plus, RefreshCw, TerminalSquare, Trash2, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VMView } from '../shared/contracts/vm.ts';
import { controllerSession } from './controller-session';
import { connectTerminal } from './terminal-connection';
import { socketPath } from '../shared/socket-client.ts';

/**
 * 中文：呈现装配 xterm、WebSocket、尺寸适配和输入清理中的 TerminalPanel 界面，组合 Minus、Plus、Trash2、RefreshCw、Unplug、TerminalSquare、Play，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the TerminalPanel surface for Composing xterm, WebSocket transport, resize handling and input cleanup and composing Minus, Plus, Trash2, RefreshCw, Unplug, TerminalSquare, Play. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vm,
  start,
  busy,
  session,
  projectId,
} 提供 vm（vm 状态）、start（start 状态）、busy（忙碌标记）、session（目标终端或桌面会话）、projectId（当前项目标识） 上下文字段
 * English: Inputs: {
  vm,
  start,
  busy,
  session,
  projectId,
} provides context fields vm (vm state), start (start state), busy (busy flag), session (target terminal/desktop session), projectId (current project identifier)
 */
export function TerminalPanel({
  vm,
  start,
  busy,
  session,
  projectId,
}: {
  vm: VMView;
  start: /** 中文：请求启动客户机，兑现后由外层更新状态；这是 TerminalPanel 的调用契约 | English: Request guest startup, allowing the owner to update state after fulfillment; this is the callable contract of TerminalPanel | 中文：结果：unknown；调用者依赖此类型约定 | English: Result: unknown; callers depend on this type contract */ () => unknown;
  busy: boolean;
  session?: string;
  projectId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null);
  const fitTerminal = useRef<(/** 中文：请求 xterm 重新测量可用尺寸并发送对应终端大小；这是 TerminalPanel 的调用契约 | English: Request xterm to remeasure available size and send the terminal dimensions; this is the callable contract of TerminalPanel | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) | null>(null);
  const [fontSize, setFontSize] = useState(/** 中文：在装配 xterm、WebSocket、尺寸适配和输入清理流程中读取浏览器缓存值；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Composing xterm, WebSocket transport, resize handling and input cleanup, read a browser-cache value. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => {
    try {
      const saved = Number(localStorage.getItem('sakura-terminal-font-size'));
      return Number.isInteger(saved) && saved >= 11 && saved <= 18 ? saved : 13;
    } catch {
      return 13;
    }
  });
  const [retry, setRetry] = useState(0),
    [connection, setConnection] = useState('连接中');
  const [disconnected, setDisconnected] = useState(false);
  const [networkMode, setNetworkMode] = useState<'host' | 'private' | null>(null);
  const mode = vm.status === 'running' ? 'terminal' : 'logs';
  // 终端实例与监听器由此 effect 成对创建/释放；实例、会话或项目切换会结束原连接并建立新的作用域。
  useEffect(/** 中文：当依赖 [vm.id, vm.status, mode, retry, session, projectId, disconnected] 变化时networkMode 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vm.id, vm.status, mode, retry, session, projectId, disconnected] change, networkMode state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    setNetworkMode(null);
    if (!ref.current || vm.status === 'stopped' || disconnected) return;
    const monoFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
    let disposed = false;
    const term = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontWeight: 400,
      fontWeightBold: 600,
      lineHeight: 1.5,
      scrollback: 4000,
      theme: {
        background: '#26212c',
        foreground: '#eee6ef',
        cursor: '#f1b1cb',
        selectionBackground: '#655168',
        black: '#26212c',
        brightBlack: '#aa97b0',
        green: '#b0d5bb',
        brightGreen: '#c2e6ca',
        red: '#ed9ca8',
        brightRed: '#ffb7c4',
        yellow: '#e9d1a6',
        brightYellow: '#f4e0b9',
        blue: '#adc4ea',
        brightBlue: '#c3d7f5',
        magenta: '#d2acdf',
        brightMagenta: '#e6c2ef',
        cyan: '#a2d4d5',
        brightCyan: '#bce6e6',
        white: '#eee6ef',
        brightWhite: '#fff5fa',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    terminal.current = term;
    const connection = connectTerminal({
      /**
       * 中文：向当前控制面会话申请或复用凭证，供终端连接管理器建连。
       * English: Request/reuse credentials from the current controller session for the terminal connection manager.
       */
      authenticate: () => controllerSession.authenticate(),
      /**
       * 中文：按页面协议和 terminal/logs 模式构建通道，终端附项目作用域而日志仅附实例会话；凭证通过通道查询编码。
       * English: Construct a channel from page protocol/terminal-logs mode, attaching project scope to terminals and only VM session to logs, encoding credentials in channel query fields.
       * 中文：输入：token：当前传输认证凭证
       * English: Inputs: token: current transport credential
       */
      socket: (token) =>
        new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}` +
            (mode === 'terminal' ? socketPath('terminal', { vmId: vm.id },
              { token, session: session || undefined, project: projectId || undefined }) :
              socketPath('logs', { vmId: vm.id }, { token, session: session || undefined })),
        ),
      /**
       * 中文：在装配 xterm、WebSocket、尺寸适配和输入清理流程中把数据写入当前输出；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Composing xterm, WebSocket transport, resize handling and input cleanup, write data into the current output. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：输入：text：待处理的文本内容
       * English: Inputs: text: text content to process
       */
      data: (text) => term.write(text),
      report: setConnection,
      /**
       * 中文：在装配 xterm、WebSocket、尺寸适配和输入清理流程中networkMode 状态，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Composing xterm, WebSocket transport, resize handling and input cleanup, networkMode state, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：输入：context：当前调用所属的应用或工作区上下文
       * English: Inputs: context: application/workspace context for the call
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      ready: (context) => {
        if (context && typeof context === 'object' && 'networkIsolation' in context &&
            (context.networkIsolation === 'host' || context.networkIsolation === 'private'))
          setNetworkMode(context.networkIsolation);
        resize();
        if (
          ref.current?.clientWidth &&
          !document.querySelector('dialog[open]') &&
          (document.activeElement === document.body || ref.current?.contains(document.activeElement))
        )
          term.focus();
      },
      logs: mode === 'logs',
    });
    /**
     * 中文：在装配 xterm、WebSocket、尺寸适配和输入清理流程中向活动传输交付数据；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Composing xterm, WebSocket transport, resize handling and input cleanup, deliver data to an active transport. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const resize = () => {
      if (disposed || !ref.current?.clientWidth) return;
      fit.fit();
      if (mode === 'terminal') connection.send({ type: 'resize', cols: term.cols, rows: term.rows });
    };
    const observer = new ResizeObserver(resize);
    fitTerminal.current = resize;
    observer.observe(ref.current);
    const frame = requestAnimationFrame(resize);
    // Canvas needs fresh character metrics after the local web font finishes loading.
    void document.fonts
      .load(`${fontSize}px "Sakura Mono"`)
      .then((faces) => {
        if (disposed || !faces.length || !monoFamily) return;
        term.options.fontFamily = monoFamily;
        resize();
        term.refresh(0, term.rows - 1);
      })
      .catch(() => {
        // Keep the system monospace fallback if a font cannot be loaded.
      });
    const data = term.onData((data) => connection.send({ type: 'input', data }));
    /**
     * 中文：在装配 xterm、WebSocket、尺寸适配和输入清理流程中关闭所属连接或存储对象，释放所属连接或界面寿命，断开当前客户端；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Composing xterm, WebSocket transport, resize handling and input cleanup, close the owned connection/storage object, dispose owned connection/UI lifetimes, disconnect the current client. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      connection.close();
      data.dispose();
      observer.disconnect();
      term.dispose();
      terminal.current = null;
      fitTerminal.current = null;
    };
  }, [vm.id, vm.status, mode, retry, session, projectId, disconnected]);
  // Resize the existing terminal without replacing its SSH connection or scrollback.
  useEffect(/** 中文：当依赖 [fontSize] 变化时持久化浏览器缓存值；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [fontSize] change, persist a browser-cache value. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize;
      fitTerminal.current?.();
    }
    try {
      localStorage.setItem('sakura-terminal-font-size', String(fontSize));
    } catch {
      // The controls also work when browser storage is unavailable.
    }
  }, [fontSize]);
  const connectionTone =
    vm.status === 'stopped' || disconnected
      ? 'stopped'
      : connection === 'SSH 已连接'
        ? 'running'
        : connection === '连接失败'
          ? 'error'
          : connection === '连接已关闭'
            ? 'stopped'
            : 'starting';
  return (
    <div className="terminal-wrap" data-clipboard-app="terminal" data-clipboard-vm={vm.id}>
      <div className="terminal-toolbar">
        <div>
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>{vm.status === 'running' ? `root@${vm.name}: ${networkMode === 'private' ? '私有项目网络' : networkMode === 'host' ? '共享网络' : '项目终端'}` : 'Linux 启动控制台'}</span>
        </div>
        <div>
          <div className="terminal-font-controls" role="group" aria-label="终端字号">
            <button
              aria-label="缩小终端字号"
              title="缩小字号"
              disabled={fontSize <= 11}
              onClick={() => setFontSize((size) => Math.max(11, size - 1))}
            >
              <Minus size={12} />
            </button>
            <button
              className="terminal-font-reset"
              aria-label={`重置终端字号，当前 ${fontSize} 像素`}
              title="恢复默认 13px"
              onClick={() => setFontSize(13)}
            >
              {fontSize}
              <small>px</small>
            </button>
            <button
              aria-label="放大终端字号"
              title="放大字号"
              disabled={fontSize >= 18}
              onClick={() => setFontSize((size) => Math.min(18, size + 1))}
            >
              <Plus size={12} />
            </button>
          </div>
          <span className="terminal-tool-divider" aria-hidden="true" />
          <button
            aria-label="清空终端"
            title="清空终端"
            disabled={vm.status === 'stopped'}
            onClick={() => terminal.current?.clear()}
          >
            <Trash2 size={14} />
          </button>
          <button
            aria-label="重新连接终端"
            title="重新连接"
            disabled={vm.status === 'stopped'}
            onClick={() => { setDisconnected(false); setRetry((v) => v + 1); }}
          >
            <RefreshCw size={14} />
          </button>
          {!session && vm.status === 'running' && <button aria-label="断开项目终端" title="断开项目终端"
            disabled={disconnected} onClick={() => setDisconnected(true)}><Unplug size={14} /></button>}
        </div>
      </div>
      {vm.status === 'stopped' ? (
        <div className="terminal-offline">
          <TerminalSquare size={38} />
          <h3>终端正在等你。</h3>
          <p>启动 {vm.name}，继续上次的工作。</p>
          <button className="terminal-start" onClick={start} disabled={busy}>
            <Play size={14} />
            启动并连接
          </button>
        </div>
      ) : disconnected ? <div className="terminal-offline"><p>项目终端已断开，点击重新连接继续。</p></div> : (
        <div ref={ref} className="xterm-container" />
      )}
      <div className="terminal-bottom">
        <span className={`terminal-session ${connectionTone}`} role="status">
          <span className={`tiny-dot ${connectionTone}`} />
          {vm.status === 'stopped' ? '发行版已停止' : disconnected ? '连接已关闭' : connection}
        </span>
        <span>
          UTF-8<span className="terminal-separator">/</span>xterm-256color
        </span>
      </div>
    </div>
  );
}
