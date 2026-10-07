/**
 * 模块职责（中文）：创建并连接单应用弹窗，校验来源/nonce 握手后传递会话初始化信息。
 * Module responsibility (English): Creating popups and handing over initialization credentials after an exact handshake.
 * 详细范围（中文）：公开入口包括 createSingleAppPopup, connectSingleAppPopup；职责覆盖创建弹窗并在精确握手完成后交付初始化凭证，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include createSingleAppPopup, connectSingleAppPopup. The scope covers Creating popups and handing over initialization credentials after an exact handshake. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
type Session = { id: string; program: string; resolution: string;
  password: string; clipboard?: { copy: boolean; paste: boolean } };

type PopupReady = { type: 'sakura-single-app-ready'; nonce: string };

/**
 * 中文：在用户动作调用栈内同步打开预备弹窗，阻止时明确报错；先显示启动反馈，异步创建会话后再握手。
 * English: Synchronously open a preparation popup inside the user-action stack, explicitly reporting blocking; show startup feedback before asynchronous session creation/handshake.
 * 中文：拒绝原因：浏览器阻止了应用窗口，请允许 Sakura 打开弹出窗口。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 浏览器阻止了应用窗口，请允许 Sakura 打开弹出窗口. These errors reach the direct caller or this function's catch handler
 */
export function createSingleAppPopup() {
  const popup = window.open('', '_blank', 'popup,width=1060,height=840');
  if (!popup) throw new Error('浏览器阻止了应用窗口，请允许 Sakura 打开弹出窗口');
  popup.document.title = '正在启动 Linux 应用…';
  popup.document.body.textContent = '正在准备应用窗口…';
  return popup;
}

/**
 * 中文：为弹窗生成 nonce 并在精确窗口/同源握手后交付会话凭证；15 秒超时和导航错误均移除监听，握手成功再聚焦。
 * English: Generate a popup nonce and deliver credentials only after exact-window/same-origin handshake. Remove listeners on fifteen-second timeout/navigation failure and focus only after success.
 * 中文：输入：popup：本次单应用启动创建的弹窗；vmId：当前实例标识；session：目标终端或桌面会话；token：当前传输认证凭证
 * English: Inputs: popup: popup created for this single-application launch; vmId: current VM identifier; session: target terminal/desktop session; token: current transport credential
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 * 中文：拒绝原因：应用窗口已关闭。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 应用窗口已关闭. These errors reach the direct caller or this function's catch handler
 */
export async function connectSingleAppPopup(popup: Window, vmId: string,
  session: Session, token: string) {
  if (popup.closed) throw new Error('应用窗口已关闭');
  const nonce = crypto.randomUUID();
  await new Promise<void>(/** 中文：在创建弹窗并在精确握手完成后交付初始化凭证流程中timeout 状态，登记浏览器或资源事件监听，拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Creating popups and handing over initialization credentials after an exact handshake, timeout state, register browser/resource event listeners, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：resolve：此处理器的调用值；reject：此处理器的调用值 | English: Inputs: resolve: the invocation value for this handler; reject: the invocation value for this handler | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (resolve, reject) => {
    /**
     * 中文：清除本次握手计时器及 message 监听，所有成功/失败出口共用。
     * English: Clear this handshake's timer/message listener through the shared success/failure cleanup.
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    // 源窗口、同源地址和随机 nonce 必须全部匹配后才交付凭证，避免其他窗口伪造就绪握手。
    /**
     * 中文：核对来源窗口、origin、消息类型与 nonce 全部匹配才发送凭证；已关闭弹窗拒绝，其他消息忽略。
     * English: Send credentials only after window/origin/type/nonce all match; reject a closed popup and ignore other messages.
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     */
    const receive = (event: MessageEvent<PopupReady>) => {
      if (event.source !== popup || event.origin !== location.origin ||
          event.data?.type !== 'sakura-single-app-ready' || event.data.nonce !== nonce) return;
      cleanup();
      if (popup.closed) return reject(new Error('应用窗口已关闭'));
      popup.postMessage({ type: 'sakura-single-app-init', nonce, vmId, session, token },
        location.origin);
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('应用窗口页面未能加载'));
    }, 15000);
    window.addEventListener('message', receive);
    try {
      popup.location.replace(`${location.origin}/single-app.html?nonce=${encodeURIComponent(nonce)}`);
    } catch (cause) {
      cleanup();
      reject(cause);
    }
  });
  popup.focus();
}
