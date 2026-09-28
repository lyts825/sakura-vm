import { formatDateTime } from './localization';
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
type UserView = { id: string; username: string; role: 'owner' | 'viewer' | 'member';
  vmIds: string[]; expiresAt: number | null; createdAt: string };
type PasskeyView = { id: string; name: string; createdAt: string; lastUsedAt?: string };
type TerminalGrantView = { id: string; vmId: string; session: string; expiresAt: number };
type BrowserExtensionView = { id: string; origin: string; createdAt: number;
  expiresAt: number; lastSeenAt?: number; connected: boolean; expired: boolean;
  permissions: string[] };
type MobileKind = 'cpu' | 'memory' | 'disk' | 'service' | 'backup' | 'task' | 'secret';
type MobilePolicy = { enabled: boolean; vmIds: string[]; kinds: MobileKind[] };
type MobileView = { listener: { enabled: boolean; active: boolean; host: string; port: number;
  error?: string }; fingerprint: string; devices: Array<{ id: string; name: string;
    policy: MobilePolicy; createdAt: number; expiresAt: number; lastSeenAt?: number;
    connected: boolean; expired: boolean }> };
const mobileKinds: Array<{ id: MobileKind; name: string }> = [
  { id: 'cpu', name: 'CPU' }, { id: 'memory', name: '内存' },
  { id: 'disk', name: '磁盘' }, { id: 'service', name: '服务' },
  { id: 'backup', name: '备份' }, { id: 'task', name: '任务' },
  { id: 'secret', name: '密钥轮换' },
];
type JitRequestView = { id: string; viewerId: string; vmId: string;
  operation: 'start' | 'stop'; reason: string;
  status: 'pending' | 'approved' | 'denied' | 'revoked' | 'expired' |
    'claimed' | 'completed' | 'failed'; createdAt: number; expiresAt?: number; error?: string };
type Ceremony<T> = { ceremonyId: string; options: T };
type ProjectGrantView = { vmId: string; vmName: string; projectId: string; projectName: string;
  roleId: string; permissions: Array<'read' | 'write' | 'execute' | 'approve'>;
  approvalRequired: boolean };
type ProjectRoleView = { id: string; name: string;
  permissions: Array<'read' | 'write' | 'execute' | 'approve'> };
type ProjectPolicyView = { vmId: string; projectId: string; roles: ProjectRoleView[];
  grants: Array<{ accountId: string; roleId: string }>; approvalRequired: boolean; version: string };
type PolicyDocument = Pick<ProjectPolicyView, 'roles' | 'grants' | 'approvalRequired'>;
type SignedPolicyBundle = { format: 'sakura-project-policy/v1';
  source: { vmId: string; projectId: string }; policy: PolicyDocument;
  signature: { algorithm: 'Ed25519'; publicKey: string; value: string } };
type PolicyKeys = { revision: number;
  localKey: { name: string; fingerprint: string; publicKey: string };
  trustedKeys: Array<{ name: string; fingerprint: string; publicKey: string }> };
type PolicyPreview = { source: { vmId: string; projectId: string };
  target: { vmId: string; projectId: string }; signer: string; trusted: boolean;
  expectedVersion: string; current: PolicyDocument; proposed: PolicyDocument };
type RemoteAuditStatus = { hostId: string; target: null | {
  endpoint?: string; bucket: string; region: string; prefix: string; retentionDays: number };
  last?: { key: string; versionId: string; sequence: number; hash: string;
    retainUntil: string };
  local: { valid: boolean; sequence?: number; hash?: string; error?: string };
  caughtUp: boolean; protected: boolean;
  lastAttemptAt?: string; lastVerifiedAt?: string; lastError?: string };
type ChangeView = { id: string; vmId: string; projectId: string; requesterId: string;
  summary: string; project: unknown; expectedVersion: string;
  status: 'pending' | 'approved' | 'denied' | 'claimed' | 'applied' | 'failed' | 'expired';
  approvedBy?: string; error?: string; createdAt: number };

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
  if (token && principal?.role === 'member') return <ProjectMemberPortal principal={principal} />;
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

function ProjectMemberPortal({ principal }: { principal: AccessPrincipal }) {
  const [projects, setProjects] = useState<ProjectGrantView[]>([]);
  const [selected, setSelected] = useState('');
  const [document, setDocument] = useState('');
  const [version, setVersion] = useState('');
  const [summary, setSummary] = useState('');
  const [changeRefresh, setChangeRefresh] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = projects.find((item) => `${item.vmId}:${item.projectId}` === selected);
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => void api<{ projects: ProjectGrantView[] }>(
      '/access/projects', 'GET', undefined, abort.signal).then((result) => {
        setProjects((current) => JSON.stringify(current) === JSON.stringify(result.projects)
          ? current : result.projects);
        setSelected((value) => result.projects.some((item) =>
          `${item.vmId}:${item.projectId}` === value) ? value :
          result.projects.length ? `${result.projects[0].vmId}:${result.projects[0].projectId}` : '');
      }).catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal.id]);
  useEffect(() => {
    if (!current) return;
    const abort = new AbortController();
    void api<{ project: unknown; version: string }>(`/vms/${current.vmId}/project?project=${current.projectId}`,
      'GET', undefined, abort.signal)
      .then((result) => { setDocument(JSON.stringify(result.project, null, 2));
        setVersion(result.version); setError(''); })
      .catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    return () => abort.abort();
  }, [selected, projects, changeRefresh]);
  return <main className="app-shell"><header className="app-header">
    <h1>Sakura · 项目成员</h1><span>{principal.username}</span>
    <button className="secondary compact" onClick={() => void api('/access/logout', 'POST', {})
      .finally(() => controllerSession.clearCredential())}>退出登录</button>
  </header><section className="system-card" aria-label="授权项目">
    <h2>授权项目</h2>
    {projects.length ? <><label>项目<select value={selected}
      onChange={(event) => { setSelected(event.target.value); setMessage(''); }}>
      {projects.map((item) => <option key={`${item.vmId}:${item.projectId}`}
        value={`${item.vmId}:${item.projectId}`}>{item.vmName} / {item.projectName}</option>)}
    </select></label>
    {current && <><p>角色：{current.roleId} · 权限：{current.permissions.join('、')}</p>
      <label>项目配置<textarea rows={18} spellCheck={false} value={document}
        readOnly={!current.permissions.includes('write')}
        onChange={(event) => setDocument(event.target.value)} /></label>
      {current.approvalRequired && <p>此项目的配置变更须经另一账户批准，再由申请人应用。</p>}
      {current.permissions.includes('write') && current.approvalRequired &&
        <label>变更摘要<input minLength={8} maxLength={500} value={summary}
          onChange={(event) => setSummary(event.target.value)} /></label>}
      {current.permissions.includes('write') && <button className="primary compact"
        disabled={busy || (current.approvalRequired && (summary.trim().length < 8 || !version))}
        onClick={async () => {
          setBusy(true); setError(''); setMessage('');
          try {
            const value = JSON.parse(document);
            if (current.approvalRequired) {
              await api('/access/changes', 'POST', { vmId: current.vmId,
                projectId: current.projectId, summary, project: value, expectedVersion: version });
              setSummary(''); setChangeRefresh((value) => value + 1);
              setMessage('变更已提交，等待第二位账户批准');
            } else {
              await api(`/vms/${current.vmId}/project?project=${current.projectId}`, 'PUT', value);
              setChangeRefresh((value) => value + 1);
              setMessage('项目配置已保存');
            }
          } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
          finally { setBusy(false); }
        }}>{current.approvalRequired ? '提交变更审批' : '保存项目配置'}</button>}
      {current.permissions.includes('execute') && <div>
        {(['setup', 'start', 'stop'] as const).map((action) => <button key={action}
          className="secondary compact" disabled={busy} onClick={async () => {
            setBusy(true); setError(''); setMessage('');
            try {
              await api(`/vms/${current.vmId}/project?project=${current.projectId}`, 'POST', { action });
              setMessage(`项目操作 ${action} 已提交`);
            } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
            finally { setBusy(false); }
          }}>{action}</button>)}
      </div>}</>}
    </> : <p>目前没有获授权的项目。</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section><ChangeApprovalPanel refreshKey={changeRefresh}
    onApplied={() => setChangeRefresh((value) => value + 1)} />
    <PasskeyManager /><SessionHandoffManager /></main>;
}

function SharedInventory({ principal }: { principal: AccessPrincipal }) {
  const [vms, setVms] = useState<SharedVm[]>([]);
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [desktopId, setDesktopId] = useState('');
  const [terminalGrants, setTerminalGrants] = useState<TerminalGrantView[]>([]);
  const [openTerminal, setOpenTerminal] = useState('');
  const [error, setError] = useState('');
  const token = useToken();
  useEffect(() => {
    const abort = new AbortController();
    const refresh = () => void Promise.all([
      api<{ vms: SharedVm[]; desktopAvailable: boolean }>(
        '/access/view', 'GET', undefined, abort.signal),
      api<{ grants: TerminalGrantView[] }>(
        '/access/terminal-shares', 'GET', undefined, abort.signal),
    ])
      .then(([result, shared]) => { setVms(result.vms); setDesktopAvailable(result.desktopAvailable);
        setTerminalGrants(shared.grants); setError(''); })
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
        {vm.status === 'running' && terminalGrants.filter((grant) => grant.vmId === vm.id)
          .map((grant) => <button key={grant.id} className="secondary compact"
            onClick={() => setOpenTerminal(openTerminal === grant.id ? '' : grant.id)}>
            {openTerminal === grant.id ? '关闭终端视图' : '只读查看终端'}
          </button>)}
      </li>)}</ul> : <p>当前没有可查看的实例。</p>}
    </section>
    {desktopId && token && <SharedDesktop vmId={desktopId} token={token} />}
    {terminalGrants.filter((grant) => grant.id === openTerminal).map((grant) =>
      <SharedTerminal key={grant.id} grant={grant} token={token} />)}
    <JitViewerPanel vms={vms} />
    <PasskeyManager />
    <SessionHandoffManager />
  </main>;
}

const jitStatus: Record<JitRequestView['status'], string> = {
  pending: '待审批', approved: '已批准', denied: '已拒绝', revoked: '已撤销',
  expired: '已过期', claimed: '执行中', completed: '已完成', failed: '执行失败',
};
const jitOperation = { start: '启动', stop: '正常停止' };
const visibleJitRequests = (requests: JitRequestView[]) => [
  ...requests.filter((item) => item.status === 'pending' || item.status === 'approved'),
  ...requests.filter((item) => item.status !== 'pending' && item.status !== 'approved').slice(-30),
].sort((a, b) => b.createdAt - a.createdAt);

function JitViewerPanel({ vms }: { vms: SharedVm[] }) {
  const [requests, setRequests] = useState<JitRequestView[]>([]);
  const [vmId, setVmId] = useState('');
  const [operation, setOperation] = useState<'start' | 'stop'>('start');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async () => setRequests((await api<{ requests: JitRequestView[] }>(
    '/access/jit')).requests);
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <section className="system-card" aria-label="临时操作授权">
    <h2>申请临时操作授权</h2>
    <p>对已分享实例申请一次启停操作。管理员批准后，请在有效期内手动执行。</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(''); setMessage('');
      try {
        await api('/access/jit', 'POST', { vmId, operation, reason });
        setReason(''); setMessage('申请已提交'); await refresh();
      } catch (cause) { setError(cause instanceof Error ? cause.message : '申请失败'); }
      finally { setBusy(false); }
    }}>
      <label>实例<select value={vmId} required disabled={busy}
        onChange={(event) => setVmId(event.target.value)}>
        <option value="">选择实例</option>
        {vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
      </select></label>
      <label>操作<select value={operation} disabled={busy}
        onChange={(event) => setOperation(event.target.value as 'start' | 'stop')}>
        <option value="start">启动</option><option value="stop">正常停止</option>
      </select></label>
      <label>原因<textarea value={reason} minLength={8} maxLength={300} required disabled={busy}
        onChange={(event) => setReason(event.target.value)} /></label>
      <button className="secondary compact" disabled={busy || !vmId}>提交申请</button>
    </form>
    <ul>{visibleJitRequests(requests).map((item) => <li key={item.id}>
      {vms.find((vm) => vm.id === item.vmId)?.name || '已移除实例'} ·
      {' '}{jitOperation[item.operation]} · {jitStatus[item.status]} · {item.reason}
      {item.expiresAt && ` · 有效至 ${formatDateTime(new Date(item.expiresAt))}`}
      {item.error && ` · ${item.error}`}
      {item.status === 'approved' && <button className="primary compact" disabled={busy}
        onClick={async () => {
          setBusy(true); setError(''); setMessage('');
          try {
            await api('/access/jit/' + item.id + '/execute', 'POST', {});
            setMessage('操作已执行');
          } catch (cause) { setError(cause instanceof Error ? cause.message : '执行失败'); }
          finally { await refresh().catch(() => {}); setBusy(false); }
        }}>执行一次</button>}
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function JitOwnerPanel({ users, vms }: { users: UserView[]; vms: SharedVm[] }) {
  const [requests, setRequests] = useState<JitRequestView[]>([]);
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async () => setRequests((await api<{ requests: JitRequestView[] }>(
    '/access/jit')).requests);
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }, []);
  const decide = async (id: string, decision: 'approve' | 'deny') => {
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/access/jit/' + id + '/decision', 'POST',
        decision === 'approve' ? { decision, minutes } : { decision });
      setMessage(decision === 'approve' ? '已批准临时操作' : '已拒绝或撤销临时操作');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '审批失败'); }
    finally { setBusy(false); }
  };
  return <section aria-label="临时授权审批">
    <h4>临时授权审批</h4>
    <p>审批只针对申请者、实例和一次指定操作；最多有效 60 分钟。可在执行前撤销。</p>
    <label>批准时长（分钟）<input type="number" min={1} max={60} value={minutes}
      disabled={busy} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
    <ul>{visibleJitRequests(requests).map((item) => <li key={item.id}>
      {users.find((user) => user.id === item.viewerId)?.username || '已移除账户'} ·
      {' '}{vms.find((vm) => vm.id === item.vmId)?.name || '已移除实例'} ·
      {' '}{jitOperation[item.operation]} · {jitStatus[item.status]} · {item.reason}
      {item.expiresAt && ` · 有效至 ${formatDateTime(new Date(item.expiresAt))}`}
      {item.status === 'pending' && <button className="primary compact" disabled={busy}
        onClick={() => void decide(item.id, 'approve')}>批准</button>}
      {(item.status === 'pending' || item.status === 'approved') &&
        <button className="secondary compact" disabled={busy}
          onClick={() => void decide(item.id, 'deny')}>
          {item.status === 'approved' ? '撤销' : '拒绝'}</button>}
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function BrowserExtensionManager() {
  const [connections, setConnections] = useState<BrowserExtensionView[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async () => setConnections((await api<{ connections: BrowserExtensionView[] }>(
    '/browser-extensions')).connections);
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(1, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing?.expiresAt]);
  return <section aria-label="浏览器扩展管理">
    <h4>浏览器扩展</h4>
    <p>在 Chromium 或 Chrome 的扩展程序页启用开发者模式，选择源码或发行包中的
      <code>browser-extension</code> 文件夹加载。扩展仅可读取本机实例摘要，不能操作实例。</p>
    <button className="secondary compact" disabled={busy} onClick={async () => {
      setBusy(true); setError(''); setMessage('');
      try {
        const result = await api<{ code: string; expiresAt: number }>(
          '/browser-extensions', 'POST', {});
        setPairing(result);
        setMessage('请在扩展弹窗输入配对码和当前 Sakura 端口');
      } catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成配对码'); }
      finally { setBusy(false); }
    }}>生成扩展配对码</button>
    {pairing && <p role="status">配对码：<code>{pairing.code}</code> ·
      有效至 {new Date(pairing.expiresAt).toLocaleTimeString()} ·
      端口 {location.port || '80'}</p>}
    <button className="secondary compact" disabled={busy} onClick={() => void refresh()
      .catch((cause) => setError(String(cause.message || cause)))}>刷新连接</button>
    <ul>{connections.map((item) => <li key={item.id}>
      <code>{item.origin}</code> · {item.expired ? '已过期' : item.connected ? '最近已连接' : '未连接'} ·
      权限：实例摘要（只读） · 到期 {formatDateTime(new Date(item.expiresAt))}
      <button className="secondary compact" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          await api('/browser-extensions/' + item.id, 'DELETE');
          setMessage('扩展连接已撤销'); await refresh();
        } catch (cause) { setError(cause instanceof Error ? cause.message : '撤销失败'); }
        finally { setBusy(false); }
      }}>撤销</button>
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function MobilePolicyFields({ policy, onChange, vms }: {
  policy: MobilePolicy; onChange: (value: MobilePolicy) => void; vms: SharedVm[];
}) {
  return <>
    <label><input type="checkbox" checked={policy.enabled}
      onChange={(event) => onChange({ ...policy, enabled: event.target.checked })} />
      允许只读查看</label>
    <fieldset><legend>可见实例</legend>{vms.map((vm) => <label key={vm.id}>
      <input type="checkbox" checked={policy.vmIds.includes(vm.id)}
        onChange={(event) => onChange({ ...policy, vmIds: event.target.checked
          ? [...policy.vmIds, vm.id] : policy.vmIds.filter((id) => id !== vm.id) })} />
      {vm.name}</label>)}</fieldset>
    <fieldset><legend>告警类型</legend>{mobileKinds.map((kind) => <label key={kind.id}>
      <input type="checkbox" checked={policy.kinds.includes(kind.id)}
        onChange={(event) => onChange({ ...policy, kinds: event.target.checked
          ? [...policy.kinds, kind.id] : policy.kinds.filter((id) => id !== kind.id) })} />
      {kind.name}</label>)}</fieldset>
  </>;
}

function MobileDevicePolicy({ device, vms, refresh }: {
  device: MobileView['devices'][number]; vms: SharedVm[]; refresh: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<MobilePolicy>(device.policy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const savedPolicy = JSON.stringify(device.policy);
  useEffect(() => setDraft(device.policy), [device.id, savedPolicy]);
  const change = async (operation: 'policy' | 'revoke') => {
    setBusy(true); setError(''); setMessage('');
    try {
      await api('/mobile-companion', 'POST', { operation, id: device.id,
        ...(operation === 'policy' ? { policy: draft } : {}) });
      await refresh(); setMessage(operation === 'policy' ? '设备策略已保存' : '设备已撤销');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '设备操作失败'); }
    finally { setBusy(false); }
  };
  return <li><strong>{device.name}</strong> · {device.expired ? '已过期' :
    device.connected ? '最近已连接' : '未连接'} · 到期 {formatDateTime(new Date(device.expiresAt))}
    <details><summary>修改只读范围</summary>
      <MobilePolicyFields policy={draft} onChange={setDraft} vms={vms} />
      <button className="secondary compact" disabled={busy || !draft.vmIds.length ||
        !draft.kinds.length} onClick={() => void change('policy')}>保存设备策略</button>
    </details>
    <button className="secondary compact" disabled={busy}
      onClick={() => void change('revoke')}>撤销设备</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </li>;
}

function MobileCompanionManager({ vms }: { vms: SharedVm[] }) {
  const [view, setView] = useState<MobileView | null>(null);
  const [policy, setPolicy] = useState<MobilePolicy>({ enabled: true,
    vmIds: [], kinds: ['cpu', 'memory', 'disk', 'service', 'backup', 'task'] });
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => setView(await api<MobileView>('/mobile-companion'));
  useEffect(() => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(1, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing?.expiresAt]);
  return <section aria-label="移动伴侣管理">
    <h4>移动伴侣</h4>
    <p>手机连接独立 HTTPS 同伴入口，只读查看选定实例状态与告警。先在“主机配对与多主机状态”启用局域网监听并重启服务。</p>
    {view && <p>HTTPS 端口 {view.listener.port} · {view.listener.active &&
      view.listener.host === '0.0.0.0' ? '局域网入口已启动' : '局域网入口尚未启动'}
      {view.listener.error && ` · ${view.listener.error}`}<br />
      手机打开 <code>https://主机局域网地址:{view.listener.port}/mobile/</code>；
      核对证书 SHA-256 指纹 <code>{view.fingerprint}</code>。</p>}
    <MobilePolicyFields policy={policy} onChange={setPolicy} vms={vms} />
    <button className="secondary compact" disabled={busy || !policy.vmIds.length ||
      !policy.kinds.length || !view?.listener.active || view.listener.host !== '0.0.0.0'}
      onClick={async () => {
        setBusy(true); setError('');
        try { setPairing(await api<{ code: string; expiresAt: number }>(
          '/mobile-companion', 'POST', { operation: 'pair', policy })); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '无法生成配对码'); }
        finally { setBusy(false); }
      }}>生成手机配对码</button>
    {pairing && <p role="status">配对码：<code>{pairing.code}</code> ·
      有效至 {formatDateTime(new Date(pairing.expiresAt))}</p>}
    <button className="secondary compact" onClick={() => void refresh()
      .catch((cause) => setError(String(cause.message || cause)))}>刷新设备</button>
    <ul>{view?.devices.map((device) => <MobileDevicePolicy key={device.id}
      device={device} vms={vms} refresh={refresh} />)}</ul>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function SharedTerminal({ grant, token }: { grant: TerminalGrantView; token: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState('正在连接终端…');
  useEffect(() => {
    let active = true;
    let socket: WebSocket | undefined;
    let terminal: import('@xterm/xterm').Terminal | undefined;
    void import('@xterm/xterm').then(({ Terminal }) => {
      if (!active || !screen.current) return;
      terminal = new Terminal({ disableStdin: true, cursorBlink: false,
        fontSize: 13, scrollback: 4000, theme: { background: '#26212c', foreground: '#eee6ef' } });
      terminal.open(screen.current);
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${scheme}//${location.host}/ws/${grant.vmId}/terminal-view?` +
        `token=${encodeURIComponent(token)}&session=${encodeURIComponent(grant.session)}`);
      socket.onopen = () => { if (active) setConnection('终端视图已连接'); };
      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'data' && typeof message.data === 'string')
            terminal?.write(message.data);
          if (message.type === 'error') setConnection(String(message.data));
          if (message.type === 'exit') setConnection('终端会话已结束');
        } catch { setConnection('终端消息格式错误'); }
      };
      socket.onclose = () => { if (active) setConnection('终端连接已断开'); };
      socket.onerror = () => { if (active) setConnection('无法连接共享终端'); };
    }).catch(() => { if (active) setConnection('无法加载终端查看器'); });
    return () => { active = false; socket?.close(); terminal?.dispose(); };
  }, [grant.id, token]);
  return <section className="system-card" aria-label="只读终端视图">
    <h2>只读终端视图</h2>
    <p role="status">{connection}。输入在服务端被拒绝。</p>
    <div className="xterm-container" ref={screen} />
  </section>;
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
  const [platformOnly, setPlatformOnly] = useState(false);
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
          '/access/passkeys/register/options', 'POST', { name, password, platformOnly });
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
      <label><input type="checkbox" checked={platformOnly} disabled={busy}
        onChange={(event) => setPlatformOnly(event.target.checked)} />
        仅使用本机平台认证器（Windows Hello 等）</label>
      <button className="secondary compact" disabled={busy || keys.length >= 10}>登记通行密钥</button>
    </form> : <p><a href={localhostUrl()}>在 localhost 打开以登记通行密钥</a></p>}
    <ul>{keys.map((key) => <li key={key.id}>
      {key.name} · 登记于 {formatDateTime(new Date(key.createdAt))}
      {key.lastUsedAt && ` · 最近使用 ${formatDateTime(new Date(key.lastUsedAt))}`}
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

function ChangeApprovalPanel({ refreshKey = 0, onApplied }: {
  refreshKey?: number; onApplied?: () => void;
}) {
  const principal = usePrincipal();
  const [changes, setChanges] = useState<ChangeView[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const refresh = async (signal?: AbortSignal) => {
    const result = await api<{ changes: ChangeView[] }>('/access/changes', 'GET', undefined, signal);
    setChanges(result.changes);
  };
  useEffect(() => {
    const abort = new AbortController();
    void refresh(abort.signal).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason.message || reason));
    });
    const timer = setInterval(() => void refresh(abort.signal).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason.message || reason));
    }), 15_000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal?.id, refreshKey]);
  const run = async (id: string, action: 'approve' | 'deny' | 'apply') => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'apply') {
        await api(`/access/changes/${id}/apply`, 'POST', {});
        onApplied?.();
      } else await api(`/access/changes/${id}/decision`, 'POST', { decision: action });
      setReviewed((value) => value.filter((item) => item !== id));
      await refresh();
      setMessage(action === 'apply' ? '已应用批准的变更' :
        action === 'approve' ? '变更已批准' : '变更已拒绝');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '审批操作失败'); }
    finally { setBusy(false); }
  };
  return <section className="system-card" aria-label="项目变更审批">
    <h3>项目变更审批</h3>
    {!changes.length && <p>目前没有可查看的变更请求。</p>}
    {[...changes].reverse().slice(0, 40).map((item) => <article key={item.id}>
      <h4>{item.summary}</h4>
      <p>{item.vmId} / {item.projectId} · {item.status} ·
        {formatDateTime(new Date(item.createdAt))}</p>
      {item.error && <p role="alert" className="inline-error">{item.error}</p>}
      <details><summary>查看完整项目配置与基线版本</summary>
        <p>基线 SHA-256：<code>{item.expectedVersion}</code></p>
        <pre className="approval-config">{JSON.stringify(item.project, null, 2)}</pre>
      </details>
      {item.status === 'pending' && item.requesterId !== principal?.id && <>
        <label><input type="checkbox" checked={reviewed.includes(item.id)}
          onChange={(event) => setReviewed((value) => event.target.checked
            ? [...value, item.id] : value.filter((id) => id !== item.id))} />
          已审阅完整配置</label>
        <button className="primary compact" disabled={busy || !reviewed.includes(item.id)}
          onClick={() => void run(item.id, 'approve')}>批准</button>
        <button className="secondary compact" disabled={busy}
          onClick={() => void run(item.id, 'deny')}>拒绝</button>
      </>}
      {item.status === 'approved' && item.requesterId === principal?.id &&
        <button className="primary compact" disabled={busy}
          onClick={() => void run(item.id, 'apply')}>应用已批准变更</button>}
    </article>)}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function PolicyBundlePanel({ vmId, projectId, onApplied }: {
  vmId: string; projectId: string; onApplied: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<PolicyKeys | null>(null);
  const [exported, setExported] = useState('');
  const [importText, setImportText] = useState('');
  const [bundle, setBundle] = useState<SignedPolicyBundle | null>(null);
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [keyName, setKeyName] = useState('外部策略签名者');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const target = { vmId, projectId };
  useEffect(() => {
    const abort = new AbortController();
    void api<PolicyKeys>('/access/policy-bundles/keys', 'GET', undefined, abort.signal)
      .then(setKeys).catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason.message || reason));
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    setPreview(null); setBundle(null); setReviewed(false); setExported('');
  }, [vmId, projectId]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { setBusy(false); }
  };
  return <section className="policy-bundle-panel" aria-label="签名项目策略包">
    <h4>签名项目策略包</h4>
    <p>导出当前项目的角色、成员授权和审批要求。导入时须先验签并审阅完整差异；只有受信任签名者的包才能应用。</p>
    {keys && <><p>本机签名密钥：<code className="policy-bundle-code">{keys.localKey.fingerprint}</code></p>
      <details><summary>公钥与受信任签名者</summary>
        <label>本机公钥<textarea rows={4} readOnly value={keys.localKey.publicKey} /></label>
        <ul>{keys.trustedKeys.map((entry) => <li key={entry.fingerprint}>
          {entry.name} · <code className="policy-bundle-code">{entry.fingerprint}</code>
          {entry.fingerprint !== keys.localKey.fingerprint &&
            <button className="secondary compact" disabled={busy} onClick={() => void perform(async () => {
              setKeys(await api<PolicyKeys>('/access/policy-bundles/keys', 'POST',
                { action: 'forget', revision: keys.revision, fingerprint: entry.fingerprint }));
              setPreview(null); setReviewed(false); setMessage('已撤销对此签名者的信任');
            })}>撤销信任</button>}</li>)}</ul>
      </details></>}
    <button className="secondary compact" disabled={busy} onClick={() => void perform(async () => {
      const result = await api<{ bundle: SignedPolicyBundle }>(
        '/access/policy-bundles/export', 'POST', target);
      setExported(JSON.stringify(result.bundle, null, 2));
      setMessage('当前项目策略已签名，可复制或下载');
    })}>导出签名策略包</button>
    {exported && <><label>导出的策略包 JSON<textarea rows={9} readOnly spellCheck={false}
      value={exported} /></label>
      <button className="secondary compact" onClick={() => {
        const url = URL.createObjectURL(new Blob([exported], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `sakura-policy-${projectId}.json`;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>下载策略包</button></>}
    <label>导入策略包 JSON<textarea rows={9} spellCheck={false} value={importText}
      onChange={(event) => { setImportText(event.target.value); setPreview(null);
        setBundle(null); setReviewed(false); }} /></label>
    <button className="secondary compact" disabled={busy || !importText.trim()}
      onClick={() => void perform(async () => {
        const parsed = JSON.parse(importText) as SignedPolicyBundle;
        const result = await api<PolicyPreview>('/access/policy-bundles/preview',
          'POST', { bundle: parsed, target });
        setBundle(parsed); setPreview(result); setReviewed(false);
        setMessage('签名已验证，请审阅当前策略和拟应用策略');
      })}>验证并预览</button>
    {preview && bundle && <div className="policy-bundle-preview">
      <p>来源：{preview.source.vmId} / {preview.source.projectId}</p>
      <p>目标：{preview.target.vmId} / {preview.target.projectId}</p>
      <p>签名者：<code className="policy-bundle-code">{preview.signer}</code>
        {' · '}{preview.trusted ? '已受信任' : '尚未信任'}</p>
      <p>目标基线：<code className="policy-bundle-code">{preview.expectedVersion}</code></p>
      <details><summary>查看完整策略差异</summary>
        <p>当前策略</p><pre>{JSON.stringify(preview.current, null, 2)}</pre>
        <p>拟应用策略</p><pre>{JSON.stringify(preview.proposed, null, 2)}</pre>
      </details>
      {!preview.trusted && keys && <><label>签名者名称<input maxLength={64}
        value={keyName} onChange={(event) => setKeyName(event.target.value)} /></label>
        <button className="secondary compact" disabled={busy || !keyName.trim()}
          onClick={() => void perform(async () => {
            setKeys(await api<PolicyKeys>('/access/policy-bundles/keys', 'POST',
              { action: 'trust', revision: keys.revision, name: keyName,
                publicKey: bundle.signature.publicKey }));
            setPreview({ ...preview, trusted: true });
            setMessage('已信任此签名者，请继续审阅并应用');
          })}>信任此签名者</button></>}
      <label><input type="checkbox" checked={reviewed}
        onChange={(event) => setReviewed(event.target.checked)} />
        已审阅完整策略、成员授权与审批要求</label>
      <button className="primary compact" disabled={busy || !preview.trusted || !reviewed}
        onClick={() => void perform(async () => {
          await api('/access/policy-bundles/apply', 'POST',
            { bundle, target, expectedVersion: preview.expectedVersion });
          await onApplied(); setPreview(null); setReviewed(false);
          setMessage('签名策略包已应用');
        })}>应用签名策略包</button>
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function RemoteAuditSettings() {
  const [status, setStatus] = useState<RemoteAuditStatus | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [bucket, setBucket] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [prefix, setPrefix] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void api<RemoteAuditStatus>('/audit/remote', 'GET', undefined, abort.signal)
      .then((value) => { setStatus(value);
        if (value.target) {
          setEndpoint(value.target.endpoint || ''); setBucket(value.target.bucket);
          setRegion(value.target.region); setPrefix(value.target.prefix);
          setRetentionDays(value.target.retentionDays);
        }
      }).catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason.message || reason));
      });
    return () => abort.abort();
  }, []);
  const run = async (action: 'configure' | 'sync' | 'verify' | 'disable') => {
    setBusy(true); setError(''); setMessage('');
    try {
      const input = action === 'configure' ? { action, target: {
        ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
        bucket: bucket.trim(), region: region.trim(), prefix: prefix.trim(),
        retentionDays,
      } } : { action };
      const result = await api<RemoteAuditStatus>('/audit/remote', 'POST', input);
      setStatus(result);
      setMessage(action === 'configure' ? '已验证对象锁并保存远程目标' :
        action === 'sync' ? '已同步并验证审计锚点' :
          action === 'verify' ? '远程锚点与本地审计链校验通过' : '远程自动锚定已停用');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '远程审计操作失败'); }
    finally { setBusy(false); }
  };
  return <section className="system-card" aria-label="远程不可变审计">
    <h3>远程不可变审计</h3>
    <p>将本地审计链头写入启用 Object Lock 的 S3 兼容桶，并核验对象版本的 COMPLIANCE 保留期。凭据由运行 Sakura 的环境提供，不会保存于此设置。</p>
    <p>主机标识：<code className="remote-audit-code">{status?.hostId || '读取中'}</code></p>
    <label>桶名<input value={bucket} onChange={(event) => setBucket(event.target.value)}
      disabled={busy || Boolean(status?.last)} /></label>
    <label>区域<input value={region} onChange={(event) => setRegion(event.target.value)}
      disabled={busy || Boolean(status?.last)} /></label>
    <label>自定义端点（可留空）<input type="url" value={endpoint}
      onChange={(event) => setEndpoint(event.target.value)}
      disabled={busy || Boolean(status?.last)} /></label>
    <label>对象前缀<input value={prefix} onChange={(event) => setPrefix(event.target.value)}
      disabled={busy || Boolean(status?.last)} /></label>
    <label>保留天数<input type="number" min={7} max={3650} value={retentionDays}
      onChange={(event) => setRetentionDays(Number(event.target.value))}
      disabled={busy || Boolean(status?.last)} /></label>
    <div className="feature-actions">
      <button className="primary compact" disabled={busy || !bucket.trim() ||
        Boolean(status?.last)} onClick={() => void run('configure')}>验证并保存目标</button>
      <button className="secondary compact" disabled={busy || !status?.target}
        onClick={() => void run('sync')}>同步审计锚点</button>
      <button className="secondary compact" disabled={busy || !status?.last}
        onClick={() => void run('verify')}>校验远端版本</button>
      <button className="secondary compact" disabled={busy || !status?.target}
        onClick={() => void run('disable')}>停用自动锚定</button>
    </div>
    {status && <><p>本地审计：{status.local.valid
      ? `第 ${status.local.sequence} 条 · ${status.local.hash}`
      : status.local.error || '校验失败'}</p>
      {status.last && <p>远端锚点：第 {status.last.sequence} 条 ·
        <code className="remote-audit-code"> {status.last.hash}</code> ·
        保留至 {formatDateTime(new Date(status.last.retainUntil))} ·
        {status.protected ? '记录保留期未过' : '记录保留期已过'} ·
        {status.caughtUp ? '已追平' : '等待下一次自动同步'}</p>}
      {status.lastVerifiedAt && <p>上次验证：{formatDateTime(new Date(status.lastVerifiedAt))}</p>}
      {status.lastError && <p role="alert" className="inline-error">{status.lastError}</p>}</>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

function ProjectPermissionSettings({ users, vms, refresh }: {
  users: UserView[]; vms: SharedVm[]; refresh: () => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [vmId, setVmId] = useState('');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState('');
  const [policy, setPolicy] = useState<ProjectPolicyView | null>(null);
  const [newRoleId, setNewRoleId] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [ownerDocument, setOwnerDocument] = useState('');
  const [ownerVersion, setOwnerVersion] = useState('');
  const [ownerScope, setOwnerScope] = useState('');
  const [ownerSummary, setOwnerSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const members = users.filter((user) => user.role === 'member');
  useEffect(() => {
    if (!vmId && vms[0]) setVmId(vms[0].id);
  }, [vmId, vms]);
  useEffect(() => {
    if (!vmId) return;
    const abort = new AbortController();
    void api<{ projects: Array<{ id: string; name: string }> }>(
      `/vms/${vmId}/projects`, 'GET', undefined, abort.signal)
      .then((result) => { setProjects(result.projects);
        setProjectId((value) => result.projects.some((item) => item.id === value)
          ? value : result.projects[0]?.id || ''); setError(''); })
      .catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    return () => abort.abort();
  }, [vmId]);
  useEffect(() => {
    if (!vmId || !projectId) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ vmId, projectId });
    void api<ProjectPolicyView>(`/access/project-permissions?${query}`, 'GET', undefined, abort.signal)
      .then((result) => { setPolicy(result); setError(''); })
      .catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    return () => abort.abort();
  }, [vmId, projectId]);
  const loadOwnerDocument = async () => {
    const scope = `${vmId}:${projectId}`;
    const result = await api<{ project: unknown; version: string }>(
      `/vms/${vmId}/project?project=${projectId}`);
    setOwnerDocument(JSON.stringify(result.project, null, 2));
    setOwnerVersion(result.version);
    setOwnerScope(scope);
  };
  useEffect(() => {
    if (!vmId || !projectId) return;
    setOwnerDocument(''); setOwnerVersion(''); setOwnerScope('');
    void loadOwnerDocument().catch((reason) => setError(String(reason.message || reason)));
  }, [vmId, projectId]);
  return <section className="system-card" aria-label="项目权限管理">
    <h3>项目成员与权限</h3>
    <p>成员默认无权访问任何项目。为每个项目定义角色，再将成员分配到角色。</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError(''); setMessage('');
      try {
        await api('/access/members', 'POST', { username, password });
        setUsername(''); setPassword(''); await refresh(); setMessage('项目成员已创建');
      } catch (reason) { setError(reason instanceof Error ? reason.message : '创建失败'); }
      finally { setBusy(false); }
    }}>
      <label>成员账户名<input required pattern="[a-z][a-z0-9_-]{2,31}" value={username}
        onChange={(event) => setUsername(event.target.value)} disabled={busy} /></label>
      <label>成员密码<input required type="password" minLength={12} maxLength={256}
        autoComplete="new-password" value={password}
        onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
      <button className="secondary compact" disabled={busy}>创建成员</button>
    </form>
    <ul>{members.map((item) => <li key={item.id}>{item.username}
      <button className="secondary compact" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await api('/access/members/' + item.id, 'DELETE'); await refresh();
          setPolicy((current) => current ? { ...current,
            grants: current.grants.filter((grant) => grant.accountId !== item.id) } : current); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败'); }
        finally { setBusy(false); }
      }}>删除成员</button></li>)}</ul>
    {vms.length > 0 && <><label>实例<select value={vmId} onChange={(event) => {
      setVmId(event.target.value); setPolicy(null); }}>
      {vms.map((vm) => <option key={vm.id} value={vm.id}>{vm.name}</option>)}
    </select></label>
      <label>项目<select value={projectId} onChange={(event) => {
        setProjectId(event.target.value); setPolicy(null); }}>
        {projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label></>}
    {policy && <><h4>角色与权限</h4>
      {policy.roles.map((role, index) => <div key={role.id}>
        <label>角色名称<input value={role.name} maxLength={64} onChange={(event) =>
          setPolicy({ ...policy, roles: policy.roles.map((item, i) => i === index
            ? { ...item, name: event.target.value } : item) })} /></label>
        <span> {role.id} </span>
        {(['read', 'write', 'execute', 'approve'] as const).map((permission) => <label key={permission}>
          <input type="checkbox" checked={role.permissions.includes(permission)}
            disabled={permission === 'read'} onChange={(event) => setPolicy({ ...policy,
              roles: policy.roles.map((item, i) => i === index ? { ...item,
                permissions: event.target.checked
                  ? [...item.permissions, permission]
                  : item.permissions.filter((entry) => entry !== permission) } : item) })} />
          {permission}</label>)}
        <button className="secondary compact" disabled={policy.grants.some((grant) => grant.roleId === role.id)}
          onClick={() => setPolicy({ ...policy,
            roles: policy.roles.filter((item) => item.id !== role.id) })}>删除角色</button>
      </div>)}
      <div><label>新角色 ID<input pattern="[a-z][a-z0-9-]{0,31}" value={newRoleId}
        onChange={(event) => setNewRoleId(event.target.value)} /></label>
        <label>名称<input value={newRoleName} onChange={(event) => setNewRoleName(event.target.value)} /></label>
        <button className="secondary compact" disabled={!newRoleId || !newRoleName ||
          policy.roles.some((role) => role.id === newRoleId) || policy.roles.length >= 20}
          onClick={() => { setPolicy({ ...policy, roles: [...policy.roles,
            { id: newRoleId, name: newRoleName, permissions: ['read'] }] });
            setNewRoleId(''); setNewRoleName(''); }}>添加角色</button></div>
      <h4>成员角色</h4>
      {members.map((member) => <label key={member.id}>{member.username}
        <select value={policy.grants.find((item) => item.accountId === member.id)?.roleId || ''}
          onChange={(event) => setPolicy({ ...policy,
            grants: [...policy.grants.filter((item) => item.accountId !== member.id),
              ...(event.target.value ? [{ accountId: member.id, roleId: event.target.value }] : [])] })}>
          <option value="">无权限</option>
          {policy.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
        </select></label>)}
      <label><input type="checkbox" checked={policy.approvalRequired}
        onChange={(event) => setPolicy({ ...policy, approvalRequired: event.target.checked })} />
        项目配置变更需要第二位账户审批</label>
      <button className="primary compact" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setMessage('');
        try {
          const query = new URLSearchParams({ vmId, projectId });
          const updated = await api<ProjectPolicyView>(`/access/project-permissions?${query}`,
            'PUT', { roles: policy.roles, grants: policy.grants,
              approvalRequired: policy.approvalRequired });
          setPolicy(updated); setMessage('项目权限已保存');
        } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
        finally { setBusy(false); }
      }}>保存项目权限</button>
      <PolicyBundlePanel vmId={vmId} projectId={projectId} onApplied={async () => {
        const query = new URLSearchParams({ vmId, projectId });
        setPolicy(await api<ProjectPolicyView>(`/access/project-permissions?${query}`));
      }} />
      {policy.approvalRequired && <><h4>提交管理员配置变更</h4>
        <p>管理员提交的配置也须由另一位具有审批权限的成员确认。</p>
        <button className="secondary compact" disabled={busy}
          onClick={() => void loadOwnerDocument().catch((reason) =>
            setError(String(reason.message || reason)))}>刷新当前配置与版本</button>
        <label>变更摘要<input minLength={8} maxLength={500} value={ownerSummary}
          onChange={(event) => setOwnerSummary(event.target.value)} /></label>
        <label>拟提交的完整项目配置<textarea rows={12} spellCheck={false}
          value={ownerDocument} onChange={(event) => setOwnerDocument(event.target.value)} /></label>
        <button className="primary compact" disabled={busy || !ownerVersion ||
          ownerScope !== `${vmId}:${projectId}` ||
          ownerSummary.trim().length < 8} onClick={async () => {
            setBusy(true); setError(''); setMessage('');
            try {
              await api('/access/changes', 'POST', { vmId, projectId,
                summary: ownerSummary, project: JSON.parse(ownerDocument),
                expectedVersion: ownerVersion });
              setOwnerSummary(''); setMessage('管理员变更已提交，请由另一成员审阅');
            } catch (reason) { setError(reason instanceof Error ? reason.message : '提交失败'); }
            finally { setBusy(false); }
          }}>提交管理员变更审批</button>
      </>}
    </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
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
        {item.username} · {item.vmIds.length} 台实例 · 到期 {formatDateTime(new Date(item.expiresAt || 0))}
        <button className="secondary compact" disabled={busy} onClick={async () => {
          setBusy(true); setError('');
          try { await api('/access/users/' + item.id, 'DELETE'); await refresh(); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '撤销失败'); }
          finally { setBusy(false); }
        }}>撤销</button>
      </li>)}</ul>
      <ProjectPermissionSettings users={users} vms={vms} refresh={refresh} />
      <ChangeApprovalPanel />
      <RemoteAuditSettings />
      <JitOwnerPanel users={users} vms={vms} />
      <BrowserExtensionManager />
      <MobileCompanionManager vms={vms} />
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
