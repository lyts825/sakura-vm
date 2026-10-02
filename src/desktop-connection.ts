type ClientEvent = 'connect' | 'disconnect' | 'credentialsrequired' | 'securityfailure';
type DesktopClient = {
  addEventListener: (event: ClientEvent, listener: () => void) => void;
  removeEventListener: (event: ClientEvent, listener: () => void) => void;
  disconnect: () => void;
};
type ConnectionState = { connected: boolean; message: string; error?: string };

// SSH status polling gates retries independently of the last desktop status:
// an outage can end with another `ready` response after the retry budget ran out.
export function connectDesktop(
  create: () => DesktopClient,
  report: (state: ConnectionState) => void,
  available = true,
) {
  let stopped = false;
  let denied = false;
  let waiting = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let release: (() => void) | undefined;

  const waitForGuest = () => {
    waiting = true;
    report({ connected: false, message: '等待客户机连接恢复，恢复后将自动重连…' });
  };

  const reconnect = () => {
    if (stopped || denied) return;
    if (!available) {
      waitForGuest();
      return;
    }
    if (failures === 5) {
      report({ connected: false, message: '自动重连未成功，可点击「重新连接」重试' });
      return;
    }
    const wait = Math.min(1000 * 2 ** failures++, 15000);
    report({ connected: false, message: `连接已断开，${wait / 1000} 秒后自动重连（${failures}/5）` });
    retry = setTimeout(() => {
      retry = undefined;
      open();
    }, wait);
  };

  function open() {
    if (stopped || denied) return;
    if (!available) {
      waitForGuest();
      return;
    }
    waiting = false;
    report({ connected: false, message: '正在连接桌面…' });
    let client: DesktopClient;
    try {
      client = create();
    } catch (error) {
      report({ connected: false, message: '桌面连接失败', error: (error as Error).message });
      reconnect();
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
    const deny = () => {
      if (stopped || ended) return;
      denied = true;
      cleanup();
      client.disconnect();
      report({
        connected: false,
        message: '桌面认证失败',
        error: '桌面认证配置已改变，请检查原桌面会话并重新连接',
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
      ['credentialsrequired', deny],
      ['securityfailure', deny],
    ];
    for (const [event, listener] of listeners) client.addEventListener(event, listener);
    release = () => {
      cleanup();
      client.disconnect();
    };
  }

  open();
  return {
    setAvailable(value: boolean) {
      if (stopped || available === value) return;
      available = value;
      // A healthy SSH probe cannot fix an RFB authentication failure.
      if (denied) return;
      if (!available) {
        clearTimeout(retry);
        retry = undefined;
        // A failed status request must not interrupt a working RFB connection.
        if (!release) waitForGuest();
      } else if (waiting) {
        failures = 0;
        open();
      }
    },
    dispose() {
      stopped = true;
      clearTimeout(retry);
      release?.();
    },
  };
}
