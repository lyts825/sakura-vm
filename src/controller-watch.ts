/**
 * 模块职责（中文）：协调控制面事件 WebSocket、轮询与页面可见性，合并刷新并在凭证变化时重建连接。
 * Module responsibility (English): Managing event connections, visibility-driven polling and bounded reconnection.
 * 详细范围（中文）：公开入口包括 watchController；职责覆盖管理事件连接、可见性轮询与有界重连，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include watchController. The scope covers Managing event connections, visibility-driven polling and bounded reconnection. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { ControllerSession } from './controller-session';
import { resourceCache } from './resource-cache';
import type { SocketServerMessage } from '../shared/contracts/websocket-client.generated.ts';

// Resource hints remain a tolerated extension; current hosts publish change/data:null.
type CompatibleEventMessage = SocketServerMessage<'events'> | { data?: { resources?: unknown } };

type Options = {
  session: Pick<ControllerSession, 'authenticate'>;
  refresh: /** 中文：声明重新读取控制面快照的异步能力，观察器等待完成再安排下一轮兜底轮询。 | English: Declare asynchronous controller-snapshot refresh, awaited by the watcher before scheduling its next fallback poll. | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
  error: /** 中文：声明向所属界面交付错误文本的同步反馈回调。 | English: Declare synchronous error-text feedback to the owning surface. | 中文：输入：message：签名所示 string 业务值 | English: Inputs: message: the string domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (message: string) => void;
  settled: /** 中文：声明本轮刷新或建连已结束的同步通知，用于释放外层加载反馈。 | English: Declare synchronous pass-settled notification for releasing outer loading feedback after refresh/connection work. | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  socket: /** 中文：声明以当前凭证创建事件 WebSocket 的工厂，观察器负责登记事件与关闭。 | English: Declare a factory creating an event WebSocket with current credentials; the watcher owns handlers/closure. | 中文：输入：token：当前传输认证凭证 | English: Inputs: token: current transport credential | 中文：结果：WebSocket；调用者依赖此类型约定 | English: Result: WebSocket; callers depend on this type contract */ (token: string) => WebSocket;
};

/** Events are primary; a visible page reconciles every 30s (5s without events). */
/**
 * 中文：把事件推送、轮询、可见性和在线状态组合为可关闭的观察器；事件只使缓存失效并合并刷新，连接代次阻止迟到认证恢复已关闭连接。
 * English: Combine events, polling, visibility and online state into a closable watcher. Events invalidate caches and coalesce refreshes; connection generations prevent late authentication from restoring a closed connection.
 * 中文：输入：options：本次连接、传输或显示配置
 * English: Inputs: options: connection/transport/presentation configuration
 * 中文：结果：包含 reconnect、close 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing reconnect, close for caller state reads/operations
 */
export function watchController(options: Options) {
  let stopped = false,
    connecting = false,
    generation = 0,
    failures = 0;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let changed: ReturnType<typeof setTimeout> | undefined;
  /**
   * 中文：仅在观察器未关闭且文档可见时允许建立连接或刷新，后台窗口暂停此观察器的工作。
   * English: Permit connections or refreshes only while the watcher is open and the document visible, pausing its work in background windows.
   */
  const visible = () => !stopped && options.document.visibilityState !== 'hidden';
  /**
   * 中文：可见时执行快照刷新；未关闭时反馈错误和 settled，关闭后迟到的完成通知不再触及界面。
   * English: Refresh the snapshot while visible. Report errors/settlement only while open so late completion cannot update a disposed surface.
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
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
  /**
   * 中文：替换旧轮询计时器；事件连接正常时每 30 秒核对，否则每 5 秒兜底，等待本轮刷新结束再排下一轮避免重叠。
   * English: Replace the polling timer; reconcile every thirty seconds with a healthy event socket or every five seconds otherwise, scheduling the next pass after completion to avoid overlap.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const schedulePoll = () => {
    clearTimeout(poll);
    if (visible())
      poll = setTimeout(
        /**
         * 中文：等本次 sync 完成后再排下一轮轮询，确保刷新耗时不会造成计时器并发堆积。
         * English: Await this sync before scheduling the next poll, preventing slow refreshes from accumulating concurrent timers.
         * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
         * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
         */
        async () => {
          await sync();
          schedulePoll();
        },
        socket?.readyState === 1 ? 30000 : 5000,
      );
  };
  // 断开提高连接代次；此前尚未返回的认证不能在页面隐藏或重连后创建过期 WebSocket。
  /**
   * 中文：推进连接代次，清除重试、轮询和事件合并计时器，再解除 socket 回调并关闭连接；取消回调可避免主动关闭触发自动重连。
   * English: Advance the connection generation, clear retry/poll/event-coalescing timers, detach socket callbacks and close it; detachment prevents deliberate shutdown from triggering reconnection.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
  /**
   * 中文：仅在可见时安排指数退避重连，上限 30 秒，替换旧重试计时器以免并行创建连接。
   * English: Schedule visible-only exponential-backoff reconnection capped at thirty seconds, replacing the prior retry timer to avoid parallel connections.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const scheduleRetry = () => {
    clearTimeout(retry);
    if (visible()) retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** failures++, 30000));
  };
  /**
   * 中文：合并建连请求，等待认证后再次检查可见性和代次；登记事件连接并刷新快照，失败仅由仍有效的代次反馈和重试，finally 恢复轮询。
   * English: Coalesce connection attempts and recheck visibility/generation after authentication. Register the event socket and refresh the snapshot; only the current generation reports/retries failures, with polling restored in finally.
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
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
      /**
       * 中文：连接成功清零退避次数，使缓存失效并改用低频兜底轮询，推动连接断档后的状态核对。
       * English: Reset backoff after connection success, invalidate caches and switch to low-frequency fallback polling to reconcile any connection gap.
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      events.onopen = () => {
        failures = 0;
        resourceCache.invalidate();
        schedulePoll();
      };
      /**
       * 中文：解析事件中的资源字符串列表，损坏或旧格式事件退回全量失效；以 75 ms 计时器合并快照刷新，隐藏窗口不刷新。
       * English: Parse the event's resource-string list, falling back to full invalidation for malformed/legacy messages. Coalesce snapshot refreshes over seventy-five milliseconds and skip hidden-window refreshes.
       * 中文：输入：event：触发本处理器的事件及其数据
       * English: Inputs: event: triggering event and its data
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      events.onmessage = (event) => {
        let resources = ['*'];
        try {
          const message = JSON.parse(String(event?.data)) as CompatibleEventMessage;
          if (Array.isArray(message.data?.resources) && message.data.resources.every((item: unknown) => typeof item === 'string'))
            resources = message.data.resources;
        } catch { /* Old hosts only signal that state changed. Reconcile all active resources. */ }
        resourceCache.invalidateResources(resources);
        if (!visible() || changed) return;
        changed = setTimeout(() => {
          changed = undefined;
          void sync();
        }, 75);
      };
      /**
       * 中文：只处理当前 socket 的关闭，释放引用后安排退避重连和快速轮询；旧连接关闭不能覆盖新连接。
       * English: Handle closure only for the current socket, release its reference and schedule backoff plus fast polling; stale socket closure cannot overwrite a newer connection.
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      events.onclose = () => {
        if (socket !== events) return;
        socket = undefined;
        scheduleRetry();
        schedulePoll();
      };
      /**
       * 中文：关闭出错 socket，让统一 onclose 路径承担释放和重连，避免错误和关闭各安排一次重试。
       * English: Close the failed socket so the single onclose path owns release/reconnection, avoiding duplicate retries from error and close events.
       */
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
  /**
   * 中文：撤销当前连接寿命并清零退避，然后尝试新连接；在线恢复和可见性恢复共用此入口。
   * English: Revoke the current connection lifetime, reset backoff and attempt a new connection; online/visibility recovery share this entry point.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const reconnect = () => {
    disconnect();
    failures = 0;
    void connect();
  };
  /**
   * 中文：显示时重新核对连接与状态，隐藏时停止连接及计时器，避免后台轮询与迟到认证。
   * English: Reconcile connection/state when shown and stop sockets/timers when hidden, preventing background polling and late authentication.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const visibility = () => {
    if (visible()) reconnect();
    else disconnect();
  };
  options.document.addEventListener('visibilitychange', visibility);
  options.window.addEventListener('online', reconnect);
  void connect();
  return {
    reconnect,
    /**
     * 中文：不可逆地标记观察器关闭，撤销所有连接工作并移除 visibilitychange/online 监听。
     * English: Permanently mark the watcher closed, revoke connection work and remove visibilitychange/online listeners.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    close() {
      stopped = true;
      disconnect();
      options.document.removeEventListener('visibilitychange', visibility);
      options.window.removeEventListener('online', reconnect);
    },
  };
}
