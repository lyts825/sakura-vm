type Options = {
  authenticate: () => Promise<string>;
  socket: (token: string) => WebSocket;
  data: (text: string) => void;
  report: (message: string) => void;
  ready: () => void;
  logs: boolean;
};

/** Reattach without recreating xterm or replaying keystrokes. */
export function connectTerminal(options: Options) {
  let stopped = false,
    ready = false,
    exited = false,
    failures = 0;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    ready = false;
    if (stopped || exited) return;
    if (failures >= 5) {
      options.report('自动重连未成功，请点击重新连接');
      return;
    }
    const delay = Math.min(1000 * 2 ** failures++, 15000);
    options.report(`连接中断，${delay / 1000} 秒后重连（${failures}/5）`);
    retry = setTimeout(() => void connect(), delay);
  };
  const connect = async () => {
    try {
      const token = await options.authenticate();
      if (stopped) return;
      const current = options.socket(token);
      socket = current;
      options.report(options.logs ? '启动日志' : '正在连接');
      current.onmessage = (event) => {
        if (stopped || socket !== current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'data' && typeof message.data === 'string') options.data(message.data);
          if (message.type === 'ready') {
            ready = true;
            failures = 0;
            options.report('SSH 已连接');
            options.ready();
          }
          if (message.type === 'error') {
            options.data(`\r\n连接失败：${String(message.data)}\r\n`);
            options.report('连接失败');
          }
          if (message.type === 'exit') {
            exited = true;
            ready = false;
            options.report('会话已结束');
          }
        } catch {
          current.close(1008, 'invalid message');
        }
      };
      current.onclose = () => {
        if (!stopped && socket === current) schedule();
      };
      current.onerror = () => current.close();
    } catch {
      schedule();
    }
  };
  void connect();
  return {
    send(message: { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }) {
      if (!stopped && ready && socket?.readyState === 1) socket.send(JSON.stringify(message));
    },
    close() {
      stopped = true;
      clearTimeout(retry);
      if (socket) {
        socket.onmessage = socket.onclose = socket.onerror = null;
        socket.close();
      }
    },
  };
}
