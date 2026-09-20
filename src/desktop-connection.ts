type ClientEvent = 'connect' | 'disconnect' | 'credentialsrequired' | 'securityfailure';
type DesktopClient = {
  addEventListener: (event: ClientEvent, listener: () => void) => void;
  removeEventListener: (event: ClientEvent, listener: () => void) => void;
  disconnect: () => void;
};
type ConnectionState = { connected: boolean; message: string; error?: string };

// Own one RFB client at a time. A short outage should recover without losing the
// guest session, while repeated failures must stop instead of hammering sshd.
export function connectDesktop(create: () => DesktopClient, report: (state: ConnectionState) => void) {
  let stopped = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;

  const reconnect = () => {
    if (stopped) return;
    if (failures === 5) {
      report({ connected: false, message: '自动重连未成功，可点击「重新连接」重试' });
      return;
    }
    const wait = Math.min(1000 * 2 ** failures++, 15000);
    report({ connected: false, message: `连接已断开，${wait / 1000} 秒后自动重连（${failures}/5）` });
    retry = setTimeout(open, wait);
  };

  function open() {
    if (stopped) return;
    report({ connected: false, message: '正在连接桌面…' });
    let client: DesktopClient;
    try {
      client = create();
    } catch (error) {
      report({ connected: false, message: '桌面连接失败', error: (error as Error).message });
      return;
    }
    let ended = false;
    let stable: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      cleanup();
      client.disconnect();
      reconnect();
    }, 30000);
    const cleanup = () => {
      ended = true;
      clearTimeout(timeout);
      clearTimeout(stable);
      for (const [event, listener] of listeners) client.removeEventListener(event, listener);
      release = undefined;
    };
    const denied = () => {
      if (stopped || ended) return;
      cleanup();
      client.disconnect();
      report({
        connected: false,
        message: '桌面认证失败',
        error: '桌面认证配置已改变，请检查客户机的 sakura-desktop 服务',
      });
    };
    const listeners: [ClientEvent, () => void][] = [
      [
        'connect',
        () => {
          if (stopped || ended) return;
          clearTimeout(timeout);
          report({ connected: true, message: '桌面已连接' });
          // Brief connect/disconnect loops still consume the retry budget.
          stable = setTimeout(() => {
            failures = 0;
          }, 30000);
        },
      ],
      [
        'disconnect',
        () => {
          if (stopped || ended) return;
          cleanup();
          reconnect();
        },
      ],
      ['credentialsrequired', denied],
      ['securityfailure', denied],
    ];
    for (const [event, listener] of listeners) client.addEventListener(event, listener);
    release = () => {
      cleanup();
      client.disconnect();
    };
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    release?.();
  };
}
