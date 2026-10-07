/**
 * 模块职责（中文）：连接终端 WebSocket，处理认证、输入输出、重连与连接关闭后的清理。
 * Module responsibility (English): Connecting terminals and handling exit and reconnection without replaying input.
 * 详细范围（中文）：公开入口包括 connectTerminal；职责覆盖连接终端并处理不重放输入的重连与退出，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include connectTerminal. The scope covers Connecting terminals and handling exit and reconnection without replaying input. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { SocketClientMessage, SocketServerMessage } from '../shared/contracts/websocket-client.generated.ts';

type Options = {
  authenticate: /** 中文：声明取得控制面凭证的异步能力，拒绝时连接管理器按预算重试。 | English: Declare asynchronous controller-credential acquisition whose rejection invokes the manager's bounded retry. | 中文：结果：Promise<string>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<string>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<string>;
  socket: /** 中文：声明以当前凭证创建终端或日志 socket 的工厂，管理器拥有后续消息和释放。 | English: Declare a factory creating terminal/log sockets with current credentials; the manager owns subsequent messages/disposal. | 中文：输入：token：当前传输认证凭证 | English: Inputs: token: current transport credential | 中文：结果：WebSocket；调用者依赖此类型约定 | English: Result: WebSocket; callers depend on this type contract */ (token: string) => WebSocket;
  data: /** 中文：声明接收终端输出文本的同步回调，由界面交给 xterm 显示。 | English: Declare a synchronous terminal-text callback whose surface forwards output to xterm. | 中文：输入：text：待处理的文本内容 | English: Inputs: text: text content to process | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (text: string) => void;
  report: /** 中文：向界面交付进度、连接状态或校验反馈；这是 Options 的调用契约 | English: Deliver progress/connection/validation feedback to the surface; this is the callable contract of Options | 中文：输入：message：签名所示 string 业务值 | English: Inputs: message: the string domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (message: string) => void;
  ready: /** 中文：声明接收服务端已就绪的项目与网络隔离上下文，用于反馈实际连接目标。 | English: Declare receipt of ready project/network-isolation context for reporting the actual connected target. | 中文：输入：context：当前调用所属的应用或工作区上下文 | English: Inputs: context: application/workspace context for the call | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (context: Extract<SocketServerMessage<'terminal'>, { type: 'ready' }>['data']) => void;
  logs: boolean;
};

/** Reattach without recreating xterm or replaying keystrokes. */
/**
 * 中文：认证后管理一个终端 WebSocket；断开进行有界重连，输出和状态通过回调交付，已发送输入不缓存重放，避免重复执行命令。
 * English: Manage one authenticated terminal WebSocket with bounded reconnection, delivering output/state through callbacks. Never queue/replay sent input, avoiding duplicate commands.
 * 中文：输入：options：本次连接、传输或显示配置
 * English: Inputs: options: connection/transport/presentation configuration
 * 中文：结果：包含 send、close 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing send, close for caller state reads/operations
 */
export function connectTerminal(options: Options) {
  let stopped = false,
    ready = false,
    exited = false,
    failures = 0;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /**
   * 中文：只在未关闭且重试预算未耗尽时安排指数退避连接，发布当前重试状态。
   * English: Schedule exponential-backoff connection only while open and within the retry budget, reporting its retry state.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
  /**
   * 中文：等待当前会话认证，完成后检查 stopped 再创建 socket；消息与关闭回调核对 socket 身份，认证失败走有界重试，不重放键盘输入。
   * English: Await current-session authentication and check stopped before socket creation. Message/close callbacks verify socket identity; authentication failure uses bounded retry without replaying keystrokes.
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const connect = async () => {
    try {
      const token = await options.authenticate();
      if (stopped) return;
      const current = options.socket(token);
      socket = current;
      options.report(options.logs ? '启动日志' : '正在连接');
      /**
       * 中文：核对当前 socket 后解析 data/ready/error/exit；ready 重置重试，明确 exit 停止重连，损坏消息以策略错误关闭，兼容旧主机的宽松类型读取。
       * English: Verify the current socket then parse data/ready/error/exit. Ready resets retries, explicit exit stops reconnection and malformed messages close with a policy error, retaining tolerant reads from older hosts.
       * 中文：输入：event：触发本处理器的事件及其数据
       * English: Inputs: event: triggering event and its data
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      current.onmessage = (event) => {
        if (stopped || socket !== current) return;
        try {
          // Preserve tolerant reads from older hosts; these types describe current published frames.
          const message = JSON.parse(event.data) as SocketServerMessage<'terminal' | 'logs'>;
          if (message.type === 'data' && typeof message.data === 'string') options.data(message.data);
          if (message.type === 'ready') {
            ready = true;
            failures = 0;
            options.report('SSH 已连接');
            options.ready(message.data);
          }
          if (message.type === 'error') {
            options.data(`\r\n连接失败：${String(message.data)}\r\n`);
            options.report('连接失败');
          }
          // 明确的会话退出与网络断线不同：退出后停止自动重连，避免重建用户已经结束的 shell。
          if (message.type === 'exit') {
            exited = true;
            ready = false;
            options.report('会话已结束');
          }
        } catch {
          current.close(1008, 'invalid message');
        }
      };
      /**
       * 中文：仅未关闭且仍为当前 socket 时调用 schedule；该入口检查 exited，正常 shell 退出不会被误当网络断线重建。
       * English: Schedule only while undisposed and still the current socket; schedule checks exited so normal shell termination is not recreated as a network disconnect.
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      current.onclose = () => {
        if (!stopped && socket === current) schedule();
      };
      /**
       * 中文：让错误连接关闭并由关闭处理承担重试，保持单一路径管理连接结束。
       * English: Close the failed socket and let close handling own retry, keeping one path responsible for connection termination.
       */
      current.onerror = () => current.close();
    } catch {
      schedule();
    }
  };
  void connect();
  return {
    /**
     * 中文：仅管理器未关闭、服务端 ready 且 socket 打开时编码发送消息；其他情况忽略，不缓存重放输入。
     * English: Encode/send only while undisposed, server-ready and socket-open; ignore other states without queuing input for replay.
     * 中文：输入：message：签名所示 SocketClientMessage<'terminal'> 业务值
     * English: Inputs: message: the SocketClientMessage<'terminal'> domain value in the signature
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    send(message: SocketClientMessage<'terminal'>) {
      if (!stopped && ready && socket?.readyState === 1) socket.send(JSON.stringify(message));
    },
    /**
     * 中文：标记停止，清除重连计时器并解除消息/关闭/错误回调后断开 socket；晚到认证通过 stopped 停止建连。
     * English: Mark stopped, clear retry timers and detach message/close/error callbacks before socket closure; stopped prevents late authentication from opening a connection.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
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
