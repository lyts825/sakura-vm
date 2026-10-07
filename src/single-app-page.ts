/**
 * 模块职责（中文）：单应用弹窗入口：通过带 nonce 的消息完成父窗口握手，连接桌面并执行受控剪贴板传输。
 * Module responsibility (English): Connecting a single-application desktop and clipboard through source/nonce handshakes.
 * 详细范围（中文）：内部入口供相邻界面或契约模块使用；职责覆盖通过来源和 nonce 握手接入单应用桌面与剪贴板，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Internal entry points support adjacent UI/contract modules. The scope covers Connecting a single-application desktop and clipboard through source/nonce handshakes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type RFB from '@novnc/novnc';
import { socketPath } from '../shared/socket-client.ts';
import { connectDesktop } from './desktop-connection';
import { assertClipboardTransfer, installClipboardProtection,
  subscribeClipboardProtection, writeProtectedClipboard } from './clipboard-protection';
import { currentClipboardRule, subscribeClipboardPolicies } from './clipboard-policy';

type Init = {
  type: 'sakura-single-app-init';
  nonce: string;
  vmId: string;
  session: { id: string; program: string; resolution: string;
    password: string; clipboard?: { copy: boolean; paste: boolean } };
  token: string;
};

const status = document.getElementById('status')!;
const screen = document.getElementById('screen')!;
const clipboard = document.getElementById('clipboard')!;
const toggleClipboard = document.getElementById('toggle-clipboard') as HTMLButtonElement;
const outgoing = document.getElementById('outgoing') as HTMLTextAreaElement;
const incoming = document.getElementById('incoming') as HTMLTextAreaElement;
const send = document.getElementById('send') as HTMLButtonElement;
const copy = document.getElementById('copy') as HTMLButtonElement;
const clipboardError = document.getElementById('clipboard-error')!;
const nonce = new URLSearchParams(location.search).get('nonce');
const parent = window.opener;
document.getElementById('close')!.addEventListener('click', /** 中文：在通过来源和 nonce 握手接入单应用桌面与剪贴板流程中关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Connecting a single-application desktop and clipboard through source/nonce handshakes, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => window.close());
toggleClipboard.addEventListener('click', () => {
  clipboard.hidden = !clipboard.hidden;
  toggleClipboard.setAttribute('aria-expanded', String(!clipboard.hidden));
});

if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce) || !parent) {
  status.textContent = '请从 Sakura 桌面页重新打开应用窗口';
} else {
  const timeout = setTimeout(/** 中文：在通过来源和 nonce 握手接入单应用桌面与剪贴板流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Connecting a single-application desktop and clipboard through source/nonce handshakes, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    window.removeEventListener('message', receive);
    status.textContent = '应用连接超时，请从 Sakura 桌面页重新打开';
  }, 15000);
  /**
   * 中文：只接收父窗口同源且 nonce 匹配的初始化，验证实例/会话/程序和密码后解除 opener；懒加载 RFB、建立单应用连接并执行会话与应用剪贴板双重策略。
   * English: Accept initialization only from the same-origin parent with a matching nonce, validate VM/session/program/password and detach opener. Lazily load RFB, connect the single application and enforce both session/application clipboard policy.
   * 中文：输入：event：触发本处理器的事件及其数据
   * English: Inputs: event: triggering event and its data
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  async function receive(event: MessageEvent<Init>) {
    if (event.source !== parent || event.origin !== location.origin ||
        event.data?.type !== 'sakura-single-app-init' || event.data.nonce !== nonce) return;
    clearTimeout(timeout);
    window.removeEventListener('message', receive);
    window.opener = null;
    const { vmId, session, token } = event.data;
    if (!/^[a-f0-9-]{36}$/.test(vmId) || !/^[a-f0-9-]{36}$/.test(session?.id) ||
        !/^[A-Za-z][A-Za-z0-9+._-]{0,63}$/.test(session?.program || '') ||
        !/^[A-Za-z0-9+/]{8}$/.test(session?.password || '') || !token) {
      status.textContent = '应用会话无效，请从 Sakura 桌面页重新打开';
      return;
    }
    document.title = `${session.program} · Sakura`;
    try {
      const { default: RFB } = await import('@novnc/novnc');
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${scheme}//${location.host}` + socketPath('desktop', { vmId }, { token, app: session.id });
      const context = { app: 'desktop' as const, vmId };
      const sessionClipboard = session.clipboard || { copy: true, paste: true };
      document.body.dataset.clipboardApp = 'desktop';
      document.body.dataset.clipboardVm = vmId;
      let client: RFB | null = null;
      let connection: ReturnType<typeof connectDesktop> | null = null;
      let connected = false;
      let sentClipboard = '';
      /**
       * 中文：根据连接状态、现有剪贴板内容及应用/会话策略更新复制和发送按钮，未授权方向不能通过界面触发。
       * English: Update copy/send buttons from connection/content/application/session rules so disallowed directions cannot be triggered through the UI.
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      const refreshButtons = () => {
        const rule = currentClipboardRule(context);
        send.disabled = !connected || !rule.paste || !sessionClipboard.paste;
        copy.disabled = !incoming.value || !rule.copy || !sessionClipboard.copy;
      };
      /**
       * 中文：以本会话凭证创建 RFB 客户端，按当前客户端身份过滤剪贴板事件，交给连接管理器统一重连和错误反馈。
       * English: Create an RFB client with this session's credentials, filter clipboard events by current-client identity and use the connection manager for reconnection/error feedback.
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      const connect = () => {
        connection = connectDesktop(/** 中文：在通过来源和 nonce 握手接入单应用桌面与剪贴板流程中登记浏览器或资源事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Connecting a single-application desktop and clipboard through source/nonce handshakes, register browser/resource event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => {
          const next = new RFB(screen, url, {
            credentials: { password: session.password, username: '', target: '' },
          });
          next.scaleViewport = true;
          next.resizeSession = false;
          next.background = '#201b24';
          client = next;
          next.addEventListener('clipboard', /** 中文：更新 incoming.value、clipboardError.textContent 以维护通过来源和 nonce 握手接入单应用桌面与剪贴板当前状态；这些赋值属于此输入/事件的状态转换 | English: Update incoming.value, clipboardError.textContent to maintain current state for Connecting a single-application desktop and clipboard through source/nonce handshakes; these assignments belong to this input/event transition | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data | 中文：拒绝原因：此应用会话已禁止复制到宿主。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 此应用会话已禁止复制到宿主. These errors reach the direct caller or this function's catch handler */ (event) => {
            if (client !== next) return;
            const text = (event as CustomEvent<{ text: string }>).detail.text;
            try {
              if (!sessionClipboard.copy) throw new Error('此应用会话已禁止复制到宿主');
              assertClipboardTransfer(context, 'copy', text);
              incoming.value = text;
              clipboardError.textContent = '';
            } catch (cause) {
              incoming.value = '';
              clipboardError.textContent = (cause as Error).message;
            }
            refreshButtons();
          });
          return next;
        }, ({ connected: ready, message, error }) => {
          connected = ready;
          if (!ready) client = null;
          status.textContent = `${session.program} · ${error || message ||
            (ready ? '已连接' : '连接中')}`;
          refreshButtons();
        });
      };
      /**
       * 中文：规则变化时清空不再允许的输入/输出；已经发送的粘贴内容撤权后重新建立桌面连接，避免旧客户端继续保留禁止内容。
       * English: Clear newly disallowed input/output when rules change; if previously sent paste content loses authority, recreate the desktop connection so the old client cannot retain forbidden content.
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      const refreshPolicy = () => {
        if (!sessionClipboard.copy) incoming.value = '';
        if (!sessionClipboard.paste) outgoing.value = '';
        try { assertClipboardTransfer(context, 'copy', incoming.value); }
        catch { incoming.value = ''; }
        try { assertClipboardTransfer(context, 'paste', outgoing.value); }
        catch { outgoing.value = ''; }
        if (sentClipboard) {
          try { assertClipboardTransfer(context, 'paste', sentClipboard); }
          catch {
            sentClipboard = '';
            connection?.dispose();
            client = null;
            connected = false;
            connect();
          }
        }
        refreshButtons();
      };
      send.addEventListener('click', /** 中文：更新 sentClipboard、clipboardError.textContent 以维护通过来源和 nonce 握手接入单应用桌面与剪贴板当前状态；这些赋值属于此输入/事件的状态转换 | English: Update sentClipboard, clipboardError.textContent to maintain current state for Connecting a single-application desktop and clipboard through source/nonce handshakes; these assignments belong to this input/event transition | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data | 中文：拒绝原因：应用窗口尚未连接；此应用会话已禁止粘贴。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 应用窗口尚未连接; 此应用会话已禁止粘贴. These errors reach the direct caller or this function's catch handler */ () => {
        try {
          if (!client || !connected) throw new Error('应用窗口尚未连接');
          if (!sessionClipboard.paste) throw new Error('此应用会话已禁止粘贴');
          assertClipboardTransfer(context, 'paste', outgoing.value);
          client.clipboardPasteFrom(outgoing.value);
          sentClipboard = outgoing.value;
          clipboardError.textContent = '';
        } catch (cause) { clipboardError.textContent = (cause as Error).message; }
      });
      copy.addEventListener('click', /** 中文：更新 clipboardError.textContent 以维护通过来源和 nonce 握手接入单应用桌面与剪贴板当前状态；这些赋值属于此输入/事件的状态转换 | English: Update clipboardError.textContent to maintain current state for Connecting a single-application desktop and clipboard through source/nonce handshakes; these assignments belong to this input/event transition | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
        if (!sessionClipboard.copy) {
          clipboardError.textContent = '此应用会话已禁止复制到宿主';
          return;
        }
        void writeProtectedClipboard(incoming.value, context)
          .then(() => { clipboardError.textContent = ''; })
          .catch((cause: Error) => { clipboardError.textContent = cause.message; });
      });
      const unsubscribePolicies = subscribeClipboardPolicies(refreshPolicy);
      const unsubscribeProtection = subscribeClipboardProtection(refreshPolicy);
      const removeClipboardProtection = installClipboardProtection(document,
        (message) => { clipboardError.textContent = message; });
      refreshPolicy();
      connect();
      window.addEventListener('pagehide', /** 中文：在通过来源和 nonce 握手接入单应用桌面与剪贴板流程中释放所属连接或界面寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Connecting a single-application desktop and clipboard through source/nonce handshakes, dispose owned connection/UI lifetimes. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
        connection?.dispose();
        unsubscribePolicies();
        unsubscribeProtection();
        removeClipboardProtection();
      }, { once: true });
    } catch (cause) {
      status.textContent = `桌面客户端加载失败：${(cause as Error).message}`;
    }
  }
  window.addEventListener('message', receive);
  parent.postMessage({ type: 'sakura-single-app-ready', nonce }, location.origin);
}
