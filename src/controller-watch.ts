import type { ControllerSession } from './controller-session';

type Options = {
  session: Pick<ControllerSession, 'authenticate'>;
  refresh: () => Promise<unknown>;
  error: (message: string) => void;
  settled: () => void;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  socket: (token: string) => WebSocket;
};

/** Events are primary; a visible page reconciles every 30s (5s without events). */
export function watchController(options: Options) {
  let stopped = false,
    connecting = false,
    generation = 0,
    failures = 0;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let changed: ReturnType<typeof setTimeout> | undefined;
  const visible = () => !stopped && options.document.visibilityState !== 'hidden';
  const sync = async () => {
    if (!visible()) return;
    try {
      await options.refresh();
    } catch (error) {
      if (!stopped) options.error((error as Error).message);
    } finally {
      if (!stopped) options.settled();
    }
  };
  const schedulePoll = () => {
    clearTimeout(poll);
    if (visible())
      poll = setTimeout(
        async () => {
          await sync();
          schedulePoll();
        },
        socket?.readyState === 1 ? 30000 : 5000,
      );
  };
  const disconnect = () => {
    generation++;
    connecting = false;
    clearTimeout(retry);
    clearTimeout(poll);
    clearTimeout(changed);
    changed = undefined;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
      socket = undefined;
    }
  };
  const scheduleRetry = () => {
    clearTimeout(retry);
    if (visible()) retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** failures++, 30000));
  };
  const connect = async () => {
    if (!visible() || socket) return;
    if (connecting) {
      scheduleRetry();
      return;
    }
    connecting = true;
    const current = ++generation;
    try {
      const token = await options.session.authenticate();
      if (!visible() || current !== generation) return;
      const events = options.socket(token);
      socket = events;
      events.onopen = () => {
        failures = 0;
        schedulePoll();
      };
      events.onmessage = () => {
        if (!visible() || changed) return;
        changed = setTimeout(() => {
          changed = undefined;
          void sync();
        }, 75);
      };
      events.onclose = () => {
        if (socket !== events) return;
        socket = undefined;
        scheduleRetry();
        schedulePoll();
      };
      events.onerror = () => events.close();
      await sync();
    } catch (error) {
      if (visible() && current === generation) {
        options.error((error as Error).message);
        scheduleRetry();
      }
    } finally {
      if (current === generation && !stopped) {
        connecting = false;
        options.settled();
        schedulePoll();
      }
    }
  };
  const reconnect = () => {
    disconnect();
    failures = 0;
    void connect();
  };
  const visibility = () => {
    if (visible()) reconnect();
    else disconnect();
  };
  options.document.addEventListener('visibilitychange', visibility);
  options.window.addEventListener('online', reconnect);
  void connect();
  return {
    reconnect,
    close() {
      stopped = true;
      disconnect();
      options.document.removeEventListener('visibilitychange', visibility);
      options.window.removeEventListener('online', reconnect);
    },
  };
}
