/**
 * 模块职责（中文）：管理浏览器远程桌面连接的认证、状态通知和取消，隔离已经关闭的客户端事件。
 * Module responsibility (English): Managing RFB desktop reconnection, authentication failure and listener disposal.
 * 详细范围（中文）：公开入口包括 connectDesktop；职责覆盖管理 RFB 桌面重连、认证失败与监听器释放，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include connectDesktop. The scope covers Managing RFB desktop reconnection, authentication failure and listener disposal. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
type ClientEvent = 'connect' | 'disconnect' | 'credentialsrequired' | 'securityfailure';
type DesktopClient = {
  addEventListener: /** 中文：声明登记桌面连接、断开或认证事件监听的客户端能力，连接管理器随后按同一事件/函数配对移除。 | English: Declare registration of desktop connect/disconnect/authentication listeners, subsequently removed by the manager using the same event/function pair. | 中文：输入：event：触发本处理器的事件及其数据；listener：本订阅的变化观察者 | English: Inputs: event: triggering event and its data; listener: change observer for this subscription | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (event: ClientEvent, listener: /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 DesktopClient.addEventListener 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of DesktopClient.addEventListener | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) => void;
  removeEventListener: /** 中文：声明移除对应事件与函数的桌面客户端监听，供连接寿命结束时清理。 | English: Declare removal of desktop listeners by matching event/function for connection-lifetime cleanup. | 中文：输入：event：触发本处理器的事件及其数据；listener：本订阅的变化观察者 | English: Inputs: event: triggering event and its data; listener: change observer for this subscription | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (event: ClientEvent, listener: /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 DesktopClient.removeEventListener 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of DesktopClient.removeEventListener | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) => void;
  disconnect: /** 中文：声明主动断开桌面客户端，由管理器先解除监听以防止清理触发重连。 | English: Declare deliberate client disconnection, preceded by manager listener removal so cleanup cannot trigger reconnection. | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
};
type ConnectionState = { connected: boolean; message: string; error?: string };

// SSH status polling gates retries independently of the last desktop status:
// an outage can end with another `ready` response after the retry budget ran out.
/**
 * 中文：管理一个桌面客户端的创建、握手超时和至多五次退避重连；客户机不可用时等待，认证拒绝后停止自动尝试，返回可用性更新和释放入口。
 * English: Own desktop-client creation, handshake timeout and up to five backoff retries. Wait while the guest is unavailable and stop automatic attempts after authentication denial; return availability/disposal controls.
 * 中文：输入：create：构造当前客户端的能力；report：向调用者交付状态或进度的回调；available：此处理器的调用值（缺省 true）
 * English: Inputs: create: capability constructing the current client; report: callback delivering status/progress to the caller; available: the invocation value for this handler (default true)
 * 中文：结果：包含 setAvailable、dispose 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing setAvailable, dispose for caller state reads/operations
 */
export function connectDesktop(
  create: /** 中文：创建本次连接客户端，由连接管理器拥有释放寿命；这是 connectDesktop 的调用契约 | English: Create this connection client whose disposal lifetime is owned by the connection manager; this is the callable contract of connectDesktop | 中文：结果：DesktopClient；调用者依赖此类型约定 | English: Result: DesktopClient; callers depend on this type contract */ () => DesktopClient,
  report: /** 中文：向界面交付进度、连接状态或校验反馈；这是 connectDesktop 的调用契约 | English: Deliver progress/connection/validation feedback to the surface; this is the callable contract of connectDesktop | 中文：输入：state：当前状态或草稿快照 | English: Inputs: state: current state/draft snapshot | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (state: ConnectionState) => void,
  available = true,
) {
  let stopped = false;
  let denied = false;
  let waiting = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let release: (/** 中文：保留当前客户端的释放回调，关闭或替换时清理该连接的监听、计时器和客户端。 | English: Retain the current client's release callback for cleaning that connection's listeners/timers/client on closure/replacement. | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) | undefined;

  /**
   * 中文：标记正在等待客户机并发布断开提示，保留恢复可用后自动建连的意图。
   * English: Mark guest waiting and publish a disconnected message while retaining the intention to reconnect after availability returns.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const waitForGuest = () => {
    waiting = true;
    report({ connected: false, message: '等待客户机连接恢复，恢复后将自动重连…' });
  };

  /**
   * 中文：在未关闭、未认证拒绝且客户机可用时安排退避重试，延迟最高 15 秒，五次失败后由用户显式重新连接。
   * English: Schedule backoff only while open, authorized and guest-available, capped at fifteen seconds; after five failures require explicit user reconnection.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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

  /**
   * 中文：创建客户端并为单次连接绑定 30 秒握手限时和配对监听；连接稳定 30 秒才重置失败次数，认证错误走永久拒绝，普通断开走重连。
   * English: Create a client with a thirty-second handshake timeout and paired listeners. Reset failures only after thirty seconds of stable connection; authentication errors deny further attempts, ordinary disconnects retry.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
    /**
     * 中文：结束本次连接寿命，移除握手/稳定计时器与全部监听，再清空外部 release 引用；不自行判定是否重连。
     * English: End this connection lifetime, remove handshake/stability timers and all listeners, and clear its external release reference; retry decisions remain with the caller.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const cleanup = () => {
      ended = true;
      clearTimeout(timeout);
      clearTimeout(stable);
      for (const [event, listener] of listeners) client.removeEventListener(event, listener);
      release = undefined;
    };
    // 认证失败结束此连接寿命；后续客户机就绪探测不能自动绕过认证失败，需要用户重新连接。
    /**
     * 中文：只对存活连接处理认证拒绝，释放后断开客户端并显示认证变更错误；设置 denied 防止错误凭据被自动反复提交。
     * English: Handle authentication refusal only for a live connection, release/disconnect the client and report changed credentials; set denied to prevent repeated automatic submission.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
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
    const listeners: [ClientEvent, /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 connectDesktop.open 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of connectDesktop.open | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void][] = [
      [
        'connect',
        /**
         * 中文：在管理 RFB 桌面重连、认证失败与监听器释放流程中timeout 状态，取消延迟计时任务；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
         * English: In Managing RFB desktop reconnection, authentication failure and listener disposal, timeout state, cancel delayed timers. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
         * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
         * English: Result: deliver through the described state/resource effects without returning business data
         */
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
    /**
     * 中文：先解除当前客户端的监听与计时器再断开，主动释放不会触发旧监听的重连分支。
     * English: Detach client listeners/timers before disconnecting, preventing deliberate release from invoking old reconnection handlers.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    release = () => {
      cleanup();
      client.disconnect();
    };
  }

  open();
  return {
    /**
     * 中文：仅处理客户机可用性变化；停机时撤销待重试，恢复且正在等待时重新建连，认证拒绝仍由显式操作解除。
     * English: Handle guest-availability changes only: cancel pending retries on unavailability and reconnect on recovery while waiting; authentication denial still requires explicit recovery.
     * 中文：输入：value：待校验、转换或保存的输入值
     * English: Inputs: value: input value to validate/transform/save
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
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
    /**
     * 中文：终止管理器并清除重试，释放当前客户端；后续事件与定时回调通过 stopped 检查停止。
     * English: Stop the manager, clear retries and release the current client; stopped checks suppress later events/timer callbacks.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    dispose() {
      stopped = true;
      clearTimeout(retry);
      release?.();
    },
  };
}
