/**
 * 模块职责：创建并连接单应用弹窗，校验来源/nonce 握手后传递会话初始化信息。
 */
type Session = { id: string; program: string; resolution: string;
  password: string; clipboard?: { copy: boolean; paste: boolean } };

type PopupReady = { type: 'sakura-single-app-ready'; nonce: string };

export function createSingleAppPopup() {
  const popup = window.open('', '_blank', 'popup,width=1060,height=840');
  if (!popup) throw new Error('浏览器阻止了应用窗口，请允许 Sakura 打开弹出窗口');
  popup.document.title = '正在启动 Linux 应用…';
  popup.document.body.textContent = '正在准备应用窗口…';
  return popup;
}

export async function connectSingleAppPopup(popup: Window, vmId: string,
  session: Session, token: string) {
  if (popup.closed) throw new Error('应用窗口已关闭');
  const nonce = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
    // 源窗口、同源地址和随机 nonce 必须全部匹配后才交付凭证，避免其他窗口伪造就绪握手。
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
