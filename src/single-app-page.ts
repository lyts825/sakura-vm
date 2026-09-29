import { connectDesktop } from './desktop-connection';

type Init = {
  type: 'sakura-single-app-init';
  nonce: string;
  vmId: string;
  session: { id: string; program: string; resolution: string };
  token: string;
};

const status = document.getElementById('status')!;
const screen = document.getElementById('screen')!;
const nonce = new URLSearchParams(location.search).get('nonce');
const parent = window.opener;
document.getElementById('close')!.addEventListener('click', () => window.close());

if (!nonce || !/^[a-f0-9-]{36}$/.test(nonce) || !parent) {
  status.textContent = '请从 Sakura 桌面页重新打开应用窗口';
} else {
  const timeout = setTimeout(() => {
    window.removeEventListener('message', receive);
    status.textContent = '应用连接超时，请从 Sakura 桌面页重新打开';
  }, 15000);
  async function receive(event: MessageEvent<Init>) {
    if (event.source !== parent || event.origin !== location.origin ||
        event.data?.type !== 'sakura-single-app-init' || event.data.nonce !== nonce) return;
    clearTimeout(timeout);
    window.removeEventListener('message', receive);
    window.opener = null;
    const { vmId, session, token } = event.data;
    if (!/^[a-f0-9-]{36}$/.test(vmId) || !/^[a-f0-9-]{36}$/.test(session?.id) ||
        !/^[A-Za-z][A-Za-z0-9+._-]{0,63}$/.test(session?.program || '') || !token) {
      status.textContent = '应用会话无效，请从 Sakura 桌面页重新打开';
      return;
    }
    document.title = `${session.program} · Sakura`;
    try {
      const { default: RFB } = await import('@novnc/novnc');
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${scheme}//${location.host}/ws/${vmId}/desktop?token=${encodeURIComponent(token)}&app=${encodeURIComponent(session.id)}`;
      const connection = connectDesktop(() => {
        const client = new RFB(screen, url);
        client.scaleViewport = true;
        client.resizeSession = false;
        client.background = '#201b24';
        return client;
      }, ({ connected, message, error }) => {
        status.textContent = `${session.program} · ${error || message ||
          (connected ? '已连接' : '连接中')}`;
      });
      window.addEventListener('pagehide', () => connection.dispose(), { once: true });
    } catch (cause) {
      status.textContent = `桌面客户端加载失败：${(cause as Error).message}`;
    }
  }
  window.addEventListener('message', receive);
  parent.postMessage({ type: 'sakura-single-app-ready', nonce }, location.origin);
}
