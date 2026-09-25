import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { Minus, Play, Plus, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VMView } from '../server/model';
import { controllerSession } from './controller-session';
import { connectTerminal } from './terminal-connection';

export function TerminalPanel({
  vm,
  start,
  busy,
  session,
}: {
  vm: VMView;
  start: () => unknown;
  busy: boolean;
  session?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null);
  const fitTerminal = useRef<(() => void) | null>(null);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('sakura-terminal-font-size'));
      return Number.isInteger(saved) && saved >= 11 && saved <= 18 ? saved : 13;
    } catch {
      return 13;
    }
  });
  const [retry, setRetry] = useState(0),
    [connection, setConnection] = useState('连接中');
  const mode = vm.status === 'running' ? 'terminal' : 'logs';
  useEffect(() => {
    if (!ref.current || vm.status === 'stopped') return;
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
      authenticate: () => controllerSession.authenticate(),
      socket: (token) =>
        new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${vm.id}/${mode}?token=${encodeURIComponent(token)}${session ? `&session=${encodeURIComponent(session)}` : ''}`,
        ),
      data: (text) => term.write(text),
      report: setConnection,
      ready: () => {
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
  }, [vm.id, vm.status, mode, retry, session]);
  // Resize the existing terminal without replacing its SSH connection or scrollback.
  useEffect(() => {
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
    vm.status === 'stopped'
      ? 'stopped'
      : connection === 'SSH 已连接'
        ? 'running'
        : connection === '连接失败'
          ? 'error'
          : connection === '连接已关闭'
            ? 'stopped'
            : 'starting';
  return (
    <div className="terminal-wrap">
      <div className="terminal-toolbar">
        <div>
          <span className="terminal-dots">
            <i />
            <i />
            <i />
          </span>
          <span>{vm.status === 'running' ? `root@${vm.name}: ~` : 'Linux 启动控制台'}</span>
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
            onClick={() => setRetry((v) => v + 1)}
          >
            <RefreshCw size={14} />
          </button>
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
      ) : (
        <div ref={ref} className="xterm-container" />
      )}
      <div className="terminal-bottom">
        <span className={`terminal-session ${connectionTone}`} role="status">
          <span className={`tiny-dot ${connectionTone}`} />
          {vm.status === 'stopped' ? '发行版已停止' : connection}
        </span>
        <span>
          UTF-8<span className="terminal-separator">/</span>xterm-256color
        </span>
      </div>
    </div>
  );
}
