import type RFB from '@novnc/novnc';
import { connectDesktop } from './desktop-connection';
import { assertClipboardTransfer, installClipboardProtection,
  subscribeClipboardProtection, writeProtectedClipboard } from './clipboard-protection';
import { currentClipboardRule, subscribeClipboardPolicies } from './clipboard-policy';

type Init = {
  type: 'sakura-single-app-init';
  nonce: string;
  vmId: string;
  session: { id: string; program: string; resolution: string;
    clipboard?: { copy: boolean; paste: boolean } };
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
document.getElementById('close')!.addEventListener('click', () => window.close());
toggleClipboard.addEventListener('click', () => {
  clipboard.hidden = !clipboard.hidden;
  toggleClipboard.setAttribute('aria-expanded', String(!clipboard.hidden));
});

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
      const context = { app: 'desktop' as const, vmId };
      const sessionClipboard = session.clipboard || { copy: true, paste: true };
      document.body.dataset.clipboardApp = 'desktop';
      document.body.dataset.clipboardVm = vmId;
      let client: RFB | null = null;
      let connection: ReturnType<typeof connectDesktop> | null = null;
      let connected = false;
      let sentClipboard = '';
      const refreshButtons = () => {
        const rule = currentClipboardRule(context);
        send.disabled = !connected || !rule.paste || !sessionClipboard.paste;
        copy.disabled = !incoming.value || !rule.copy || !sessionClipboard.copy;
      };
      const connect = () => {
        connection = connectDesktop(() => {
          const next = new RFB(screen, url);
          next.scaleViewport = true;
          next.resizeSession = false;
          next.background = '#201b24';
          client = next;
          next.addEventListener('clipboard', (event) => {
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
      send.addEventListener('click', () => {
        try {
          if (!client || !connected) throw new Error('应用窗口尚未连接');
          if (!sessionClipboard.paste) throw new Error('此应用会话已禁止粘贴');
          assertClipboardTransfer(context, 'paste', outgoing.value);
          client.clipboardPasteFrom(outgoing.value);
          sentClipboard = outgoing.value;
          clipboardError.textContent = '';
        } catch (cause) { clipboardError.textContent = (cause as Error).message; }
      });
      copy.addEventListener('click', () => {
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
      window.addEventListener('pagehide', () => {
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
