import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type RFB from '@novnc/novnc';
import type { PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { AccessPrincipal } from '../shared/access-control';
import type { SessionLockView } from '../shared/session-lock';
import { api, controllerSession } from './controller-session';

type AccountStatus = { enabled: boolean; session: SessionLockView };
type SharedVm = { id: string; name: string; status: string; distro?: string;
  cpus: number; memoryMiB: number; diskGiB: number };
type UserView = { id: string; username: string; role: 'owner' | 'viewer';
  vmIds: string[]; expiresAt: number | null; createdAt: string };
type PasskeyView = { id: string; name: string; createdAt: string; lastUsedAt?: string };
type Ceremony<T> = { ceremonyId: string; options: T };

async function publicPasskeyRequest<T>(path: string, input: unknown) {
  const response = await fetch('/api/access/passkeys/' + path, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '通行密钥请求失败');
  return result as T;
}

const localhostUrl = () => `http://localhost:${location.port || '80'}/`;

const useToken = () => useSyncExternalStore(controllerSession.subscribe, controllerSession.getToken);
const usePrincipal = () => useSyncExternalStore(controllerSession.subscribe, controllerSession.getPrincipal);
const useAccountMode = () => useSyncExternalStore(controllerSession.subscribe, controllerSession.getAccountMode);

export function AccessBoundary({ children }: { children: ReactNode }) {
  const token = useToken();
  const principal = usePrincipal();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [statusError, setStatusError] = useState('');
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [handoffCode, setHandoffCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch('/api/access/status', { cache: 'no-store', signal: abort.signal });
        // Older mock servers and pre-account versions retain the legacy bootstrap.
        if (response.status === 404) {
          controllerSession.setAccountMode(false);
          setEnabled(false);
          return;
        }
        if (!response.ok) throw new Error('无法读取账户模式');
        const status = await response.json() as AccountStatus;
        if (abort.signal.aborted) return;
        controllerSession.updateSession(status.session);
        controllerSession.setAccountMode(status.enabled);
        setEnabled(status.enabled);
        setStatusError('');
        if (status.enabled && principal && principal.expiresAt <= Date.now())
          controllerSession.clearCredential();
      } catch (reason) {
        if (!abort.signal.aborted)
          setStatusError(reason instanceof Error ? reason.message : '无法连接 Sakura 服务');
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal]);

  if (enabled === null) return <main className="session-lock-screen"><p role="status">
    {statusError || '正在读取账户状态…'}</p></main>;
  if (!enabled) return children;
  if (token && principal?.role === 'owner') return children;
  if (token && principal?.role === 'viewer') return <SharedInventory principal={principal} />;
  return <main className="session-lock-screen">
    <section className="session-lock-panel" aria-labelledby="account-login-title">
      <h1 id="account-login-title">登录 Sakura</h1>
      <p>账户模式已启用。登录后按账户权限访问本机实例。</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const response = await fetch('/api/access/login', {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            signal: AbortSignal.timeout(15_000),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '登录失败');
          controllerSession.adoptAccount(result.token, result.principal);
          setPassword('');
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : '登录失败');
        } finally { setBusy(false); }
      }}>
        <label>账户名<input autoComplete="username" required maxLength={32} value={username}
          onChange={(event) => setUsername(event.target.value)} disabled={busy} /></label>
        <label>密码<input type="password" autoComplete="current-password" required maxLength={256}
          value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
        <button className="primary" disabled={busy || !username || !password}>
          {busy ? '正在登录…' : '登录'}</button>
      </form>
      <form onSubmit={async (event) => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          const response = await fetch('/api/access/handoff/redeem', {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: handoffCode.trim() }),
            signal: AbortSignal.timeout(15_000),
          });
          const login = await response.json();
          if (!response.ok) throw new Error(login.error || '会话交接失败');
          controllerSession.adoptAccount(login.token, login.principal);
          setHandoffCode('');
        } catch (reason) { setError(reason instanceof Error ? reason.message : '会话交接失败'); }
        finally { setBusy(false); }
      }}>
        <label>会话交接码<input autoComplete="off" maxLength={24} value={handoffCode}
          onChange={(event) => setHandoffCode(event.target.value)} disabled={busy} /></label>
        <button className="secondary" disabled={busy || !handoffCode.trim()}>接收会话</button>
      </form>
      {location.hostname === 'localhost' ? <button className="secondary" disabled={busy}
        onClick={async () => {
          setBusy(true); setError('');
          try {
            const begin = await publicPasskeyRequest<Ceremony<PublicKeyCredentialRequestOptionsJSON>>(
              'login/options', {});
            const { startAuthentication } = await import('@simplewebauthn/browser');
            const response = await startAuthentication({ optionsJSON: begin.options });
            const login = await publicPasskeyRequest<{ token: string; principal: AccessPrincipal }>(
              'login/verify', { ceremonyId: begin.ceremonyId, response });
            controllerSession.adoptAccount(login.token, login.principal);
          } catch (reason) { setError(reason instanceof Error ? reason.message : '通行密钥登录失败'); }
          finally { setBusy(false); }
        }}>使用通行密钥登录</button>
        : <p><a href={localhostUrl()}>在 localhost 打开通行密钥登录</a></p>}
      {error && <p role="alert" className="inline-error">{error}</p>}
      {statusError && <p role="status" className="inline-error">{statusError}</p>}
    </section>
  </main>;
}

function SharedInventory({ principal }: { principal: AccessPrincipal }) {
  const [vms, setVms] = useState<SharedVm[]>([]);
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [desktopId, setDesktopId] = useState('');
  const [error, setError] = useState('');
  const token = useToken();
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => void api<{ vms: SharedVm[]; desktopAvailable: boolean }>(
      '/access/view', 'GET', undefined, abort.signal)
      .then((result) => { setVms(result.vms); setDesktopAvailable(result.desktopAvailable); setError(''); })
      .catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal.id]);
  return <main className="app-shell">
    <header className="app-header"><h1>Sakura · 只读分享</h1>
      <span>{principal.username}</span>
      <button className="secondary compact" onClick={() => void api('/access/logout', 'POST', {})
        .finally(() => controllerSession.clearCredential())}>退出登录</button>
    </header>
    <section className="system-card"><h2>已授权实例</h2>
      <p>只能查看所选实例的状态、资源摘要和可用的只读桌面。操作、日志、终端和下载不可访问。</p>
      {error && <p role="alert" className="inline-error">{error}</p>}
      {vms.length ? <ul>{vms.map((vm) => <li key={vm.id}>
        <strong>{vm.name}</strong> · {vm.status} · {vm.distro || 'Alpine'} ·
        {' '}{vm.cpus} CPU / {vm.memoryMiB} MiB / {vm.diskGiB} GiB
        {desktopAvailable && vm.status === 'running' && <button className="secondary compact"
          onClick={() => setDesktopId(vm.id === desktopId ? '' : vm.id)}>
          {vm.id === desktopId ? '关闭桌面视图' : '只读查看桌面'}</button>}
      </li>)}</ul> : <p>当前没有可查看的实例。</p>}
    </section>
    {desktopId && token && <SharedDesktop vmId={desktopId} token={token} />}
    <PasskeyManager />
    <SessionHandoffManager />
  </main>;
}

function SessionHandoffManager() {
  const [password, setPassword] = useState('');
  const [handoff, setHandoff] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!handoff) return;
    const timer = setTimeout(() => setHandoff(null), Math.max(1, handoff.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [handoff?.expiresAt]);
  return <section className="system-card" aria-label="会话交接">
    <h3>会话交接</h3>
    <p>使用当前密码生成两分钟有效的一次性交接码。在另一个本机浏览器会话接收后，当前会话立即失效。</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      try {
        const result = await api<{ code: string; expiresAt: number }>(
          '/access/handoff', 'POST', { password });
        setPassword(''); setHandoff(result);
      } catch (reason) { setError(reason instanceof Error ? reason.message : '无法生成交接码'); }
      finally { setBusy(false); }
    }}>
      <label>当前账户密码<input type="password" autoComplete="current-password" required
        value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
      <button className="secondary compact" disabled={busy}>生成交接码</button>
    </form>
    {handoff && <p role="status">交接码：<code>{handoff.code}</code>；
      到期 {new Date(handoff.expiresAt).toLocaleTimeString()}
      <button className="secondary compact" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await api('/access/handoff', 'DELETE'); setHandoff(null); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '无法取消交接码'); }
        finally { setBusy(false); }
      }}>取消交接码</button>
    </p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function PasskeyManager() {
  const principal = usePrincipal();
  const [keys, setKeys] = useState<PasskeyView[]>([]);
  const [name, setName] = useState('此设备');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async () => setKeys((await api<{ passkeys: PasskeyView[] }>(
    '/access/passkeys')).passkeys);
  useEffect(() => { void refresh().catch((reason) => setError(String(reason.message || reason))); },
    [principal?.id]);
  return <section className="system-card" aria-label="通行密钥管理">
    <h3>通行密钥</h3>
    <p>每个账户最多登记 10 把通行密钥。登记和撤销需要当前账户密码。</p>
    {location.hostname === 'localhost' ? <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(''); setMessage('');
      try {
        const begin = await api<Ceremony<PublicKeyCredentialCreationOptionsJSON>>(
          '/access/passkeys/register/options', 'POST', { name, password });
        const { startRegistration } = await import('@simplewebauthn/browser');
        const response = await startRegistration({ optionsJSON: begin.options });
        await api('/access/passkeys/register/verify', 'POST',
          { ceremonyId: begin.ceremonyId, response });
        setPassword(''); setMessage('通行密钥已登记'); await refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : '登记失败'); }
      finally { setBusy(false); }
    }}>
      <label>通行密钥名称<input value={name} maxLength={64} required disabled={busy}
        onChange={(event) => setName(event.target.value)} /></label>
      <label>当前账户密码<input type="password" autoComplete="current-password" required
        value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="secondary compact" disabled={busy || keys.length >= 10}>登记通行密钥</button>
    </form> : <p><a href={localhostUrl()}>在 localhost 打开以登记通行密钥</a></p>}
    <ul>{keys.map((key) => <li key={key.id}>
      {key.name} · 登记于 {new Date(key.createdAt).toLocaleString()}
      {key.lastUsedAt && ` · 最近使用 ${new Date(key.lastUsedAt).toLocaleString()}`}
      <button className="secondary compact" disabled={busy || !password} onClick={async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/access/passkeys/' + key.id, 'DELETE', { password });
          setPassword(''); setMessage('通行密钥已撤销'); await refresh();
        } catch (reason) { setError(reason instanceof Error ? reason.message : '撤销失败'); }
        finally { setBusy(false); }
      }}>撤销</button>
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function SharedDesktop({ vmId, token }: { vmId: string; token: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState('正在连接桌面…');
  useEffect(() => {
    let alive = true;
    let client: RFB | undefined;
    void import('@novnc/novnc').then(({ default: RFBClient }) => {
      if (!alive || !screen.current) return;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      client = new RFBClient(screen.current,
        `${scheme}//${location.host}/ws/${vmId}/desktop-view?token=${encodeURIComponent(token)}`);
      client.viewOnly = true;
      client.scaleViewport = true;
      client.resizeSession = false;
      client.background = '#201b24';
      client.addEventListener('connect', () => { if (alive) setConnection('只读桌面已连接'); });
      client.addEventListener('disconnect', () => { if (alive) setConnection('桌面连接已断开'); });
    }).catch(() => { if (alive) setConnection('无法加载桌面查看器'); });
    return () => { alive = false; client?.disconnect(); };
  }, [vmId, token]);
  return <section className="system-card" aria-label="只读桌面视图">
    <h2>只读桌面视图</h2>
    <p role="status">{connection}。键盘、鼠标和剪贴板输入在服务端被拒绝。</p>
    <div className="desktop-screen-shell"><div className="desktop-screen" ref={screen} /></div>
  </section>;
}

export function AccountLogoutButton() {
  const principal = usePrincipal();
  if (!principal) return null;
  return <button className="secondary compact" title="退出账户" onClick={() =>
    void api('/access/logout', 'POST', {}).finally(() => controllerSession.clearCredential())}>
    {principal.username} · 退出
  </button>;
}

export function AccessSettings() {
  const accountMode = useAccountMode();
  const principal = usePrincipal();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [username, setUsername] = useState('');
  const [viewerPassword, setViewerPassword] = useState('');
  const [days, setDays] = useState(7);
  const [vms, setVms] = useState<SharedVm[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [users, setUsers] = useState<UserView[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    if (!accountMode || principal?.role !== 'owner') return;
    const [accounts, machines] = await Promise.all([
      api<{ users: UserView[] }>('/access/users'), api<SharedVm[]>('/vms'),
    ]);
    setUsers(accounts.users);
    setVms(machines);
  };
  useEffect(() => { void refresh().catch((reason) => setError(String(reason.message || reason))); },
    [accountMode, principal?.id]);
  return <section className="system-card">
    <h3>账户与只读分享</h3>
    {!accountMode ? <>
      <p>启用后，原本机共享凭证立即失效；管理员以 owner 账户登录。只读账户仅能查看指定实例摘要。</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError(''); setMessage('');
        if (password !== confirm) { setError('两次密码不一致'); return; }
        setBusy(true);
        try {
          await api('/access/enable', 'POST', { password });
          setPassword(''); setConfirm('');
          controllerSession.setAccountMode(true);
        } catch (reason) { setError(reason instanceof Error ? reason.message : '启用失败'); }
        finally { setBusy(false); }
      }}>
        <label>管理员密码<input type="password" minLength={12} maxLength={256} required
          autoComplete="new-password" value={password} disabled={busy}
          onChange={(event) => setPassword(event.target.value)} /></label>
        <label>重复密码<input type="password" minLength={12} maxLength={256} required
          autoComplete="new-password" value={confirm} disabled={busy}
          onChange={(event) => setConfirm(event.target.value)} /></label>
        <button className="primary compact" disabled={busy}>启用账户模式</button>
      </form>
    </> : <>
      <p>当前已启用账户模式。只读账户有独立密码和有效期，访问范围限定为选定实例。</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError(''); setMessage(''); setBusy(true);
        try {
          await api('/access/users', 'POST', { username, password: viewerPassword,
            vmIds: selected, expiresAt: Date.now() + days * 86400_000 });
          setUsername(''); setViewerPassword(''); setSelected([]);
          setMessage('只读账户已创建'); await refresh();
        } catch (reason) { setError(reason instanceof Error ? reason.message : '创建失败'); }
        finally { setBusy(false); }
      }}>
        <label>账户名<input value={username} required pattern="[a-z][a-z0-9_-]{2,31}"
          onChange={(event) => setUsername(event.target.value)} disabled={busy} /></label>
        <label>独立密码<input type="password" minLength={12} maxLength={256} required
          autoComplete="new-password" value={viewerPassword}
          onChange={(event) => setViewerPassword(event.target.value)} disabled={busy} /></label>
        <label>有效天数<input type="number" min={1} max={30} value={days} disabled={busy}
          onChange={(event) => setDays(Number(event.target.value))} /></label>
        <fieldset><legend>可查看的实例</legend>
          {vms.map((vm) => <label key={vm.id}><input type="checkbox" checked={selected.includes(vm.id)}
            onChange={(event) => setSelected(event.target.checked
              ? [...selected, vm.id] : selected.filter((id) => id !== vm.id))} />{vm.name}</label>)}
        </fieldset>
        <button className="primary compact" disabled={busy || !selected.length}>创建只读账户</button>
      </form>
      <ul>{users.filter((item) => item.role === 'viewer').map((item) => <li key={item.id}>
        {item.username} · {item.vmIds.length} 台实例 · 到期 {new Date(item.expiresAt || 0).toLocaleString()}
        <button className="secondary compact" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await api('/access/users/' + item.id, 'DELETE'); await refresh(); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '撤销失败'); }
          finally { setBusy(false); }
        }}>撤销</button>
      </li>)}</ul>
      <h4>更换管理员密码</h4>
      <p>更换后所有账户会话立即失效，需要用新密码重新登录。</p>
      <form onSubmit={async (event) => {
        event.preventDefault(); setError(''); setMessage('');
        if (newPassword !== newPasswordConfirm) { setError('两次新密码不一致'); return; }
        setBusy(true);
        try {
          await api('/access/password', 'POST', { password: oldPassword, newPassword });
          setOldPassword(''); setNewPassword(''); setNewPasswordConfirm('');
          controllerSession.clearCredential();
        } catch (reason) { setError(reason instanceof Error ? reason.message : '更换密码失败'); }
        finally { setBusy(false); }
      }}>
        <label>当前密码<input type="password" autoComplete="current-password" required
          value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} disabled={busy} /></label>
        <label>新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={256}
          value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} /></label>
        <label>重复新密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={256}
          value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)}
          disabled={busy} /></label>
        <button className="secondary compact" disabled={busy}>更换密码</button>
      </form>
      <PasskeyManager />
      <SessionHandoffManager />
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}
