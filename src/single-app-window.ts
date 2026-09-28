import { connectDesktop } from './desktop-connection';

type Session = { id: string; program: string; resolution: string };

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
  const { default: RFB } = await import('@novnc/novnc');
  const doc = popup.document;
  doc.title = `${session.program} · Sakura`;
  doc.body.replaceChildren();
  doc.body.style.margin = '0';
  doc.body.style.background = '#201b24';
  const style = doc.createElement('style');
  style.textContent = `html,body{height:100%;overflow:hidden} .app-toolbar{height:42px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#26212c;color:#eee6ef;font:13px system-ui,sans-serif} .app-screen{height:calc(100vh - 42px);width:100%;overflow:hidden} .app-close{background:#655168;color:white;border:0;border-radius:6px;padding:5px 10px;cursor:pointer}`;
  const toolbar = doc.createElement('div');
  toolbar.className = 'app-toolbar';
  const status = doc.createElement('span');
  status.textContent = `${session.program} · 正在连接…`;
  const close = doc.createElement('button');
  close.className = 'app-close';
  close.textContent = '关闭窗口';
  close.onclick = () => popup.close();
  toolbar.append(status, close);
  const screen = doc.createElement('div');
  screen.className = 'app-screen';
  screen.setAttribute('aria-label', `${session.program} Linux 应用窗口`);
  doc.head.append(style);
  doc.body.append(toolbar, screen);
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${scheme}//${location.host}/ws/${vmId}/desktop?token=${encodeURIComponent(token)}&app=${encodeURIComponent(session.id)}`;
  const connection = connectDesktop(() => {
    const client = new RFB(screen, url);
    client.scaleViewport = true;
    client.resizeSession = false;
    client.background = '#201b24';
    return client;
  }, ({ connected, message, error }) => {
    if (!popup.closed) status.textContent = `${session.program} · ${error || message || (connected ? '已连接' : '连接中')}`;
  });
  popup.addEventListener('pagehide', () => connection.dispose(), { once: true });
  popup.focus();
}
