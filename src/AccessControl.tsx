/**
 * 模块职责（中文）：账户、通行密钥、单点登录与共享会话界面；同时提供项目权限、临时授权和变更审批的配置入口。
 * Module responsibility (English): Account, login, permission and shared-session configuration and access surfaces.
 * 详细范围（中文）：公开入口包括 AccessBoundary, AccountLogoutButton, AccessSettings；职责覆盖账户、登录、权限与共享会话的配置和访问入口，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include AccessBoundary, AccountLogoutButton, AccessSettings. The scope covers Account, login, permission and shared-session configuration and access surfaces. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from './localization';
import { socketPath } from '../shared/socket-client.ts';
import type { SocketServerMessage } from '../shared/contracts/websocket-client.generated.ts';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type RFB from '@novnc/novnc';
import type { PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { AccessPrincipal } from '../shared/access-control';
import type { SessionLockView } from '../shared/session-lock';
import { api, controllerSession } from './controller-session';
import { apiResponseError } from '../shared/errors';

type AccountStatus = { enabled: boolean; session: SessionLockView };
type SharedVm = { id: string; name: string; status: string; distro?: string;
  cpus: number; memoryMiB: number; diskGiB: number };
type UserView = { id: string; username: string; role: 'owner' | 'viewer' | 'member';
  vmIds: string[]; expiresAt: number | null; createdAt: string };
type PasskeyView = { id: string; name: string; createdAt: string; lastUsedAt?: string };
type SsoProvider = 'oidc' | 'saml';
type SsoProviders = Record<SsoProvider, boolean>;
type SsoBinding = { id: string; provider: SsoProvider; accountId: string;
  issuer: string; subject: string; createdAt: string };
type SsoView = { oidc?: { issuer: string; clientId: string;
  authMethod: 'client_secret_basic' | 'client_secret_post' | 'none'; hasSecret: boolean };
  saml?: { issuer: string; entryPoint: string; fingerprints: string[] };
  callbackUrl: string; samlCallbackUrl: string; serviceProviderId: string;
  bindings: SsoBinding[] };
type TerminalGrantView = { id: string; vmId: string; session: string; projectId?: string;
  terminalId?: string; expiresAt: number };
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

/**
 * 中文：提交 POST '/api/access/passkeys/' + path，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈
 * English: Perform POST '/api/access/passkeys/' + path for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
 * 中文：输入：path：目标文件或请求路径；input：尚待校验的输入数据
 * English: Inputs: path: target file/request path; input: input data requiring validation
 */
async function publicPasskeyRequest<T>(path: string, input: unknown) {
  const response = await fetch('/api/access/passkeys/' + path, {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok) throw apiResponseError(response.status, result);
  return result as T;
}

/**
 * 中文：提交 operation /access/sso/start；POST /api/access/sso/start，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈
 * English: Perform operation /access/sso/start; POST /api/access/sso/start for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
 * 中文：输入：provider：签名所示 SsoProvider 业务值；mode：签名所示 'login' | 'link' 业务值
 * English: Inputs: provider: the SsoProvider domain value in the signature; mode: the 'login' | 'link' domain value in the signature
 * 中文：拒绝原因：浏览器阻止了登录窗口，请允许弹出窗口后重试；身份提供商登录地址必须使用 HTTPS。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 浏览器阻止了登录窗口，请允许弹出窗口后重试; 身份提供商登录地址必须使用 HTTPS. These errors reach the direct caller or this function's catch handler
 */
async function startSso(provider: SsoProvider, mode: 'login' | 'link') {
  const popup = window.open('', '_blank', 'popup,width=640,height=720');
  if (!popup) throw new Error('浏览器阻止了登录窗口，请允许弹出窗口后重试');
  try {
    popup.document.title = 'Sakura 单点登录';
    popup.document.body.textContent = '正在连接身份提供商…';
    const input = { provider, mode, origin: location.origin };
    let begin: { redirect: string; state: string };
    if (mode === 'link') begin = await api('/access/sso/start', 'POST', input);
    else {
      const response = await fetch('/api/access/sso/start', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw apiResponseError(response.status, data);
      begin = data;
    }
    if (new URL(begin.redirect).protocol !== 'https:')
      throw new Error('身份提供商登录地址必须使用 HTTPS');
    return await new Promise<{ token: string; principal: AccessPrincipal } | { linked: true }>(
      /**
       * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中interval 状态，timeout 状态，登记浏览器或资源事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Account, login, permission and shared-session configuration and access surfaces, interval state, timeout state, register browser/resource event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：输入：resolve：此处理器的调用值；reject：此处理器的调用值
       * English: Inputs: resolve: the invocation value for this handler; reject: the invocation value for this handler
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      (resolve, reject) => {
        let settled = false;
        /**
         * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中移除登记的事件监听，停止周期计时任务，取消延迟计时任务，关闭所属连接或存储对象，拒绝当前异步等待，兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
         * English: In Account, login, permission and shared-session configuration and access surfaces, remove registered event listeners, stop periodic timers, cancel delayed timers, close the owned connection/storage object, reject the current asynchronous wait, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
         * 中文：输入：error：签名所示 Error 业务值；value：待校验、转换或保存的输入值
         * English: Inputs: error: the Error domain value in the signature; value: input value to validate/transform/save
         * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
         * English: Result: deliver through the described state/resource effects without returning business data
         */
        const finish = (error?: Error, value?: { token: string; principal: AccessPrincipal } |
          { linked: true }) => {
          if (settled) return;
          settled = true;
          window.removeEventListener('message', onMessage);
          clearInterval(closed);
          clearTimeout(timeout);
          try { popup.close(); } catch {}
          error ? reject(error) : resolve(value!);
        };
        /**
         * 中文：只接受本次弹窗、localhost origin、SSO 类型和 state 全部匹配的消息；登录需令牌与主体，关联需 linked 确认，其他结果以明确错误结束握手。
         * English: Accept messages only when popup, localhost origin, SSO type and state all match. Login requires token/principal and linking requires linked confirmation; other results end the handshake with an explicit error.
         * 中文：输入：event：触发本处理器的事件及其数据
         * English: Inputs: event: triggering event and its data
         * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
         * English: Result: deliver through the described state/resource effects without returning business data
         */
        const onMessage = (event: MessageEvent) => {
          if (event.source !== popup || event.origin !== `http://localhost:${location.port}` ||
              event.data?.type !== 'sakura-sso' || event.data.state !== begin.state) return;
          if (event.data.error) finish(new Error(String(event.data.error)));
          else if (mode === 'login' && typeof event.data.result?.token === 'string' &&
              event.data.result?.principal) finish(undefined, event.data.result);
          else if (mode === 'link' && event.data.result?.linked === true)
            finish(undefined, { linked: true });
          else finish(new Error('身份提供商返回了无效结果'));
        };
        window.addEventListener('message', onMessage);
        const closed = setInterval(() => { if (popup.closed) finish(new Error('登录窗口已关闭')); }, 1000);
        const timeout = setTimeout(() => finish(new Error('单点登录已超时')), 5 * 60_000);
        try { popup.location.assign(begin.redirect); }
        catch (reason) { finish(reason instanceof Error ? reason : new Error('无法打开身份提供商')); }
      });
  } catch (error) {
    try { popup.close(); } catch {}
    throw error;
  }
}

/**
 * 中文：返回当前端口的 localhost 首页地址，供需要 localhost 来源的账户授权流程使用；缺省端口为 80。
 * English: Return the localhost home URL on the current port for account-authorization flows requiring localhost origin, defaulting the port to eighty.
 */
const localhostUrl = () => `http://localhost:${location.port || '80'}/`;

/**
 * 中文：通过外部存储订阅当前会话令牌，凭证撤销或替换时触发重新渲染。
 * English: Subscribe to the session token through the external store, rerendering when credentials are revoked/replaced.
 */
const useToken = () => useSyncExternalStore(controllerSession.subscribe, controllerSession.getToken);
/**
 * 中文：订阅当前账户主体，使角色与权限界面跟随凭证变化。
 * English: Subscribe to the account principal so role/permission surfaces follow credential changes.
 */
const usePrincipal = () => useSyncExternalStore(controllerSession.subscribe, controllerSession.getPrincipal);
/**
 * 中文：订阅账户登录模式，供账户边界选择登录或共享控制面入口。
 * English: Subscribe to account-login mode so the account boundary selects login/shared-controller access.
 */
const useAccountMode = () => useSyncExternalStore(controllerSession.subscribe, controllerSession.getAccountMode);

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 AccessBoundary 界面，组合 SharedInventory、ProjectMemberPortal，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the AccessBoundary surface for Account, login, permission and shared-session configuration and access surfaces and composing SharedInventory, ProjectMemberPortal. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ children } 提供 children（children 状态） 上下文字段
 * English: Inputs: { children } provides context fields children (children state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
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
  const [ssoProviders, setSsoProviders] = useState<SsoProviders>({ oidc: false, saml: false });

  useEffect(/** 中文：读取 GET /api/access/status，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新interval 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /api/access/status for Account, login, permission and shared-session configuration and access surfaces and update interval state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const abort = new AbortController();
    /**
     * 中文：读取 GET /api/access/status，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新启用标记、statusError 状态；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform GET /api/access/status for Account, login, permission and shared-session configuration and access surfaces and update enabled marker, statusError state. Propagate asynchronous failure to this catch path or the outer action feedback
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：拒绝原因：无法读取账户模式。这些错误交给直接调用者或本函数 catch 处理
     * English: Refusal reasons: 无法读取账户模式. These errors reach the direct caller or this function's catch handler
     */
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
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命，停止周期计时任务；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime, stop periodic timers. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal]);

  useEffect(/** 中文：读取 GET /api/access/sso/providers，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /api/access/sso/providers for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!enabled) return;
    const abort = new AbortController();
    void fetch('/api/access/sso/providers', { cache: 'no-store', signal: abort.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((providers) => { if (!abort.signal.aborted && providers) setSsoProviders(providers); })
      .catch(() => {});
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, [enabled, token]);

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
      <form onSubmit={/** 中文：提交 POST /api/access/login，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、password 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /api/access/login for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, password state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
          if (!response.ok) throw apiResponseError(response.status, result);
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
      <form onSubmit={/** 中文：提交 POST /api/access/handoff/redeem，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、handoffCode 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /api/access/handoff/redeem for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, handoffCode state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
        event.preventDefault(); setBusy(true); setError('');
        try {
          const response = await fetch('/api/access/handoff/redeem', {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: handoffCode.trim() }),
            signal: AbortSignal.timeout(15_000),
          });
          const login = await response.json();
          if (!response.ok) throw apiResponseError(response.status, login);
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
        onClick={/** 中文：在账户、登录、权限与共享会话的配置和访问入口流程中忙碌标记，错误反馈；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Account, login, permission and shared-session configuration and access surfaces, busy flag, error feedback. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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
      {(Object.keys(ssoProviders) as SsoProvider[]).filter((provider) =>
        ssoProviders[provider]).map((provider) =>
        <button key={provider} className="secondary" disabled={busy}
          onClick={/** 中文：在账户、登录、权限与共享会话的配置和访问入口流程中忙碌标记，错误反馈；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Account, login, permission and shared-session configuration and access surfaces, busy flag, error feedback. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
            setBusy(true); setError('');
            try {
              const result = await startSso(provider, 'login');
              if ('token' in result) controllerSession.adoptAccount(result.token, result.principal);
            } catch (reason) { setError(reason instanceof Error ? reason.message : '单点登录失败'); }
            finally { setBusy(false); }
          }}>使用 {provider === 'oidc' ? 'OIDC' : 'SAML'} 登录</button>)}
      {error && <p role="alert" className="inline-error">{error}</p>}
      {statusError && <p role="status" className="inline-error">{statusError}</p>}
    </section>
  </main>;
}

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 ProjectMemberPortal 界面，组合 SsoAccountLinks、ChangeApprovalPanel、PasskeyManager、SessionHandoffManager，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ProjectMemberPortal surface for Account, login, permission and shared-session configuration and access surfaces and composing SsoAccountLinks, ChangeApprovalPanel, PasskeyManager, SessionHandoffManager. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ principal } 提供 principal（账户主体及角色视图） 上下文字段
 * English: Inputs: { principal } provides context fields principal (account principal/role view)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
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
  useEffect(/** 中文：提交 operation /access/projects，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新interval 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/projects for Account, login, permission and shared-session configuration and access surfaces and update interval state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const abort = new AbortController();
    /**
     * 中文：提交 operation /access/projects，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform operation /access/projects for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
     */
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
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命，停止周期计时任务；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime, stop periodic timers. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal.id]);
  useEffect(/** 中文：提交 operation /vms/{current.vmId}/project?project={current.projectId}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /vms/{current.vmId}/project?project={current.projectId} for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!current) return;
    const abort = new AbortController();
    void api<{ project: unknown; version: string }>(`/vms/${current.vmId}/project?project=${current.projectId}`,
      'GET', undefined, abort.signal)
      .then((result) => { setDocument(JSON.stringify(result.project, null, 2));
        setVersion(result.version); setError(''); })
      .catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, [selected, projects, changeRefresh]);
  return <main className="app-shell"><header className="app-header">
    <h1>Sakura · 项目成员</h1><span>{principal.username}</span>
    <button className="secondary compact" onClick={/** 中文：提交 operation /access/logout，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/logout for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback */ () => void api('/access/logout', 'POST')
      .finally(() => controllerSession.clearCredential())}>退出登录</button>
  </header><SsoAccountLinks accountId={principal.id} /><section className="system-card" aria-label="授权项目">
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
        onClick={/** 中文：提交 operation /access/changes；operation /vms/{current.vmId}/project?project={current.projectId}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、summary 状态、changeRefresh 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/changes; operation /vms/{current.vmId}/project?project={current.projectId} for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, summary state, changeRefresh state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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
          className="secondary compact" disabled={busy} onClick={/** 中文：提交 operation /vms/{current.vmId}/project?project={current.projectId}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /vms/{current.vmId}/project?project={current.projectId} for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 SharedInventory 界面，组合 SsoAccountLinks、SharedDesktop、JitViewerPanel、PasskeyManager、SessionHandoffManager，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SharedInventory surface for Account, login, permission and shared-session configuration and access surfaces and composing SsoAccountLinks, SharedDesktop, JitViewerPanel, PasskeyManager, SessionHandoffManager. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ principal } 提供 principal（账户主体及角色视图） 上下文字段
 * English: Inputs: { principal } provides context fields principal (account principal/role view)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function SharedInventory({ principal }: { principal: AccessPrincipal }) {
  const [vms, setVms] = useState<SharedVm[]>([]);
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [desktopId, setDesktopId] = useState('');
  const [terminalGrants, setTerminalGrants] = useState<TerminalGrantView[]>([]);
  const [openTerminal, setOpenTerminal] = useState('');
  const [error, setError] = useState('');
  const token = useToken();
  useEffect(/** 中文：提交 operation /access/view；operation /access/terminal-shares，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新interval 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/view; operation /access/terminal-shares for Account, login, permission and shared-session configuration and access surfaces and update interval state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const abort = new AbortController();
    /**
     * 中文：提交 operation /access/view；operation /access/terminal-shares，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform operation /access/view; operation /access/terminal-shares for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
     */
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
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命，停止周期计时任务；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime, stop periodic timers. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal.id]);
  return <main className="app-shell">
    <header className="app-header"><h1>Sakura · 只读分享</h1>
      <span>{principal.username}</span>
      <button className="secondary compact" onClick={/** 中文：提交 operation /access/logout，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/logout for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback */ () => void api('/access/logout', 'POST')
        .finally(() => controllerSession.clearCredential())}>退出登录</button>
    </header>
    <SsoAccountLinks accountId={principal.id} />
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
/**
 * 中文：根据  判断账户、登录、权限与共享会话的配置和访问入口中的输入或条目是否符合条件，返回布尔判断供调用者筛选/保护分支
 * English: Evaluate  to test inputs/entries in Account, login, permission and shared-session configuration and access surfaces, returning a boolean for filtering/guard branches
 * 中文：输入：requests：签名所示 JitRequestView[] 业务值
 * English: Inputs: requests: the JitRequestView[] domain value in the signature
 */
const visibleJitRequests = (requests: JitRequestView[]) => [
  ...requests.filter((item) => item.status === 'pending' || item.status === 'approved'),
  ...requests.filter((item) => item.status !== 'pending' && item.status !== 'approved').slice(-30),
].sort((a, b) => b.createdAt - a.createdAt);

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 JitViewerPanel 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the JitViewerPanel surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vms } 提供 vms（vms 状态） 上下文字段
 * English: Inputs: { vms } provides context fields vms (vms state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function JitViewerPanel({ vms }: { vms: SharedVm[] }) {
  const [requests, setRequests] = useState<JitRequestView[]>([]);
  const [vmId, setVmId] = useState('');
  const [operation, setOperation] = useState<'start' | 'stop'>('start');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /**
   * 中文：提交 operation /access/jit，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新requests 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/jit for Account, login, permission and shared-session configuration and access surfaces and update requests state. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refresh = async () => setRequests((await api<{ requests: JitRequestView[] }>(
    '/access/jit')).requests);
  useEffect(/** 中文：当依赖 [] 变化时重新核对父级远端视图，interval 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, reconcile the parent's remote view, interval state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }, []);
  return <section className="system-card" aria-label="临时操作授权">
    <h2>申请临时操作授权</h2>
    <p>对已分享实例申请一次启停操作。管理员批准后，请在有效期内手动执行。</p>
    <form onSubmit={/** 中文：提交 operation /access/jit，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、反馈原因；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/jit for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, feedback reason. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
        onClick={/** 中文：提交 operation '/access/jit/' + item.id + '/execute'，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation '/access/jit/' + item.id + '/execute' for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 JitOwnerPanel 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the JitOwnerPanel surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ users, vms } 提供 users（users 状态）、vms（vms 状态） 上下文字段
 * English: Inputs: { users, vms } provides context fields users (users state), vms (vms state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function JitOwnerPanel({ users, vms }: { users: UserView[]; vms: SharedVm[] }) {
  const [requests, setRequests] = useState<JitRequestView[]>([]);
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /**
   * 中文：提交 operation /access/jit，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新requests 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/jit for Account, login, permission and shared-session configuration and access surfaces and update requests state. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refresh = async () => setRequests((await api<{ requests: JitRequestView[] }>(
    '/access/jit')).requests);
  useEffect(/** 中文：当依赖 [] 变化时重新核对父级远端视图，interval 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, reconcile the parent's remote view, interval state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 15_000);
    return () => clearInterval(timer);
  }, []);
  /**
   * 中文：提交 operation '/access/jit/' + id + '/decision'，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation '/access/jit/' + id + '/decision' for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：id：目标资源标识；decision：签名所示 'approve' | 'deny' 业务值
   * English: Inputs: id: target resource identifier; decision: the 'approve' | 'deny' domain value in the signature
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 BrowserExtensionManager 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the BrowserExtensionManager surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function BrowserExtensionManager() {
  const [connections, setConnections] = useState<BrowserExtensionView[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /**
   * 中文：提交 operation /browser-extensions，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新connections 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /browser-extensions for Account, login, permission and shared-session configuration and access surfaces and update connections state. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refresh = async () => setConnections((await api<{ connections: BrowserExtensionView[] }>(
    '/browser-extensions')).connections);
  useEffect(/** 中文：当依赖 [] 变化时重新核对父级远端视图，interval 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, reconcile the parent's remote view, interval state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(/** 中文：当依赖 [pairing?.expiresAt] 变化时timeout 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [pairing?.expiresAt] change, timeout state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(1, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing?.expiresAt]);
  return <section aria-label="浏览器扩展管理">
    <h4>浏览器扩展</h4>
    <p>在 Chromium 或 Chrome 的扩展程序页启用开发者模式，选择源码或发行包中的
      <code>browser-extension</code> 文件夹加载。扩展仅可读取本机实例摘要，不能操作实例。</p>
    <button className="secondary compact" disabled={busy} onClick={/** 中文：提交 operation /browser-extensions，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、pairing 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /browser-extensions for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, pairing state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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
      <button className="secondary compact" disabled={busy} onClick={/** 中文：提交 operation '/browser-extensions/' + item.id，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation '/browser-extensions/' + item.id for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 MobilePolicyFields 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MobilePolicyFields surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ policy, onChange, vms } 提供 policy（策略草稿）、onChange（onChange 状态）、vms（vms 状态） 上下文字段
 * English: Inputs: { policy, onChange, vms } provides context fields policy (policy draft), onChange (onChange state), vms (vms state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function MobilePolicyFields({ policy, onChange, vms }: {
  policy: MobilePolicy; onChange: /** 中文：把新表单值交给父级状态所有者；这是 MobilePolicyFields 的调用契约 | English: Deliver newly edited form values to the parent state owner; this is the callable contract of MobilePolicyFields | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: MobilePolicy) => void; vms: SharedVm[];
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 MobileDevicePolicy 界面，组合 MobilePolicyFields，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MobileDevicePolicy surface for Account, login, permission and shared-session configuration and access surfaces and composing MobilePolicyFields. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ device, vms, refresh } 提供 device（device 状态）、vms（vms 状态）、refresh（refresh 状态） 上下文字段
 * English: Inputs: { device, vms, refresh } provides context fields device (device state), vms (vms state), refresh (refresh state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function MobileDevicePolicy({ device, vms, refresh }: {
  device: MobileView['devices'][number]; vms: SharedVm[]; refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 MobileDevicePolicy 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of MobileDevicePolicy | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<void>;
}) {
  const [draft, setDraft] = useState<MobilePolicy>(device.policy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const savedPolicy = JSON.stringify(device.policy);
  useEffect(/** 中文：当依赖 [device.id, savedPolicy] 变化时编辑草稿；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [device.id, savedPolicy] change, editing draft. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => setDraft(device.policy), [device.id, savedPolicy]);
  /**
   * 中文：提交 operation /mobile-companion，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /mobile-companion for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：operation：签名所示 'policy' | 'revoke' 业务值
   * English: Inputs: operation: the 'policy' | 'revoke' domain value in the signature
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 MobileCompanionManager 界面，组合 MobilePolicyFields，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MobileCompanionManager surface for Account, login, permission and shared-session configuration and access surfaces and composing MobilePolicyFields. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vms } 提供 vms（vms 状态） 上下文字段
 * English: Inputs: { vms } provides context fields vms (vms state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function MobileCompanionManager({ vms }: { vms: SharedVm[] }) {
  const [view, setView] = useState<MobileView | null>(null);
  const [policy, setPolicy] = useState<MobilePolicy>({ enabled: true,
    vmIds: [], kinds: ['cpu', 'memory', 'disk', 'service', 'backup', 'task'] });
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /**
   * 中文：提交 operation /mobile-companion，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新服务端视图；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /mobile-companion for Account, login, permission and shared-session configuration and access surfaces and update server view. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refresh = async () => setView(await api<MobileView>('/mobile-companion'));
  useEffect(/** 中文：当依赖 [] 变化时重新核对父级远端视图，interval 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, reconcile the parent's remote view, interval state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    void refresh().catch((cause) => setError(String(cause.message || cause)));
    const timer = setInterval(() => void refresh().catch(() => {}), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(/** 中文：当依赖 [pairing?.expiresAt] 变化时timeout 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [pairing?.expiresAt] change, timeout state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
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
      onClick={/** 中文：提交 operation /mobile-companion，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、pairing 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /mobile-companion for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, pairing state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 SharedTerminal 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SharedTerminal surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ grant, token } 提供 grant（grant 状态）、token（当前传输认证凭证） 上下文字段
 * English: Inputs: { grant, token } provides context fields grant (grant state), token (current transport credential)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function SharedTerminal({ grant, token }: { grant: TerminalGrantView; token: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState('正在连接终端…');
  useEffect(/** 中文：懒加载 @xterm/xterm 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load @xterm/xterm and adapt its selected export as the default React component, deferring this feature's UI code download | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    let active = true;
    let socket: WebSocket | undefined;
    let terminal: import('@xterm/xterm').Terminal | undefined;
    void import('@xterm/xterm').then(/**
     * 中文功能：终端库加载完成且视图仍有效时建立只读 xterm 与 terminal-view WebSocket，按消息更新输出和连接状态。
     * English: Create readonly xterm and a terminal-view WebSocket after the terminal library loads and the view remains active, updating output/connection status from messages.
     * 输入 / Inputs: { Terminal }.
     * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
     * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
     * 设计思路：先检查 active 和挂载节点，防止迟到 import 在已卸载界面创建资源；消息回调同样检查 active，异常格式通过连接状态显示。
     * Design: Check active and the mount node before creating resources after a late import; message handlers also check active and display malformed-message failures through connection state.
     */
    ({ Terminal }) => {
      if (!active || !screen.current) return;
      terminal = new Terminal({ disableStdin: true, cursorBlink: false,
        fontSize: 13, scrollback: 4000, theme: { background: '#26212c', foreground: '#eee6ef' } });
      terminal.open(screen.current);
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${scheme}//${location.host}` + socketPath('terminal-view', { vmId: grant.vmId },
        { token, session: grant.session, project: grant.projectId || undefined }));
      /**
       * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中connection 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Account, login, permission and shared-session configuration and access surfaces, connection state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      socket.onopen = () => { if (active) setConnection('正在连接终端…'); };
      /**
       * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中connection 状态，按指定 Schema 校验并解码，把数据写入当前输出；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Account, login, permission and shared-session configuration and access surfaces, connection state, validate/decode with the specified schema, write data into the current output. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：输入：event：触发本处理器的事件及其数据
       * English: Inputs: event: triggering event and its data
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      socket.onmessage = (event) => {
        if (!active) return;
        try {
          const message = JSON.parse(event.data) as SocketServerMessage<'terminal-view'>;
          if (message.type === 'data' && typeof message.data === 'string')
            terminal?.write(message.data);
          if (message.type === 'ready') setConnection('终端视图已连接');
          if (message.type === 'error') setConnection(String(message.data));
          if (message.type === 'exit') setConnection('终端会话已结束');
        } catch { setConnection('终端消息格式错误'); }
      };
      /**
       * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中connection 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Account, login, permission and shared-session configuration and access surfaces, connection state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      socket.onclose = () => { if (active) setConnection('终端连接已断开'); };
      /**
       * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中connection 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
       * English: In Account, login, permission and shared-session configuration and access surfaces, connection state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      socket.onerror = () => { if (active) setConnection('无法连接共享终端'); };
    }).catch(() => { if (active) setConnection('无法加载终端查看器'); });
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中关闭所属连接或存储对象，释放所属连接或界面寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, close the owned connection/storage object, dispose owned connection/UI lifetimes. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => { active = false; socket?.close(); terminal?.dispose(); };
  }, [grant.id, grant.projectId, grant.terminalId, grant.expiresAt, token]);
  return <section className="system-card" aria-label="只读终端视图"
    data-clipboard-app="terminal" data-clipboard-vm={grant.vmId}>
    <h2>只读终端视图</h2>
    <p role="status">{connection}。输入在服务端被拒绝。</p>
    <div className="xterm-container" ref={screen} />
  </section>;
}

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 SessionHandoffManager 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SessionHandoffManager surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function SessionHandoffManager() {
  const [password, setPassword] = useState('');
  const [handoff, setHandoff] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(/** 中文：当依赖 [handoff?.expiresAt] 变化时timeout 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [handoff?.expiresAt] change, timeout state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!handoff) return;
    const timer = setTimeout(() => setHandoff(null), Math.max(1, handoff.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [handoff?.expiresAt]);
  return <section className="system-card" aria-label="会话交接">
    <h3>会话交接</h3>
    <p>使用当前密码生成两分钟有效的一次性交接码。在另一个本机浏览器会话接收后，当前会话立即失效。</p>
    <form onSubmit={/** 中文：提交 operation /access/handoff，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、password 状态、handoff 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/handoff for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, password state, handoff state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
      <button className="secondary compact" disabled={busy} onClick={/** 中文：提交 operation /access/handoff，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、handoff 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/handoff for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, handoff state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
        setBusy(true); setError('');
        try { await api('/access/handoff', 'DELETE'); setHandoff(null); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '无法取消交接码'); }
        finally { setBusy(false); }
      }}>取消交接码</button>
    </p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 PasskeyManager 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PasskeyManager surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function PasskeyManager() {
  const principal = usePrincipal();
  const [keys, setKeys] = useState<PasskeyView[]>([]);
  const [name, setName] = useState('此设备');
  const [platformOnly, setPlatformOnly] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /**
   * 中文：提交 operation /access/passkeys，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新keys 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/passkeys for Account, login, permission and shared-session configuration and access surfaces and update keys state. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refresh = async () => setKeys((await api<{ passkeys: PasskeyView[] }>(
    '/access/passkeys')).passkeys);
  useEffect(/** 中文：当依赖 [principal?.id] 变化时重新核对父级远端视图；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [principal?.id] change, reconcile the parent's remote view. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { void refresh().catch((reason) => setError(String(reason.message || reason))); },
    [principal?.id]);
  return <section className="system-card" aria-label="通行密钥管理">
    <h3>通行密钥</h3>
    <p>每个账户最多登记 10 把通行密钥。登记和撤销需要当前账户密码。</p>
    {location.hostname === 'localhost' ? <form onSubmit={/** 中文：提交 operation /access/passkeys/register/options；operation /access/passkeys/register/verify，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、password 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/passkeys/register/options; operation /access/passkeys/register/verify for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, password state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
      <button className="secondary compact" disabled={busy || !password} onClick={/** 中文：提交 operation '/access/passkeys/' + key.id，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、password 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation '/access/passkeys/' + key.id for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, password state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 SharedDesktop 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SharedDesktop surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, token } 提供 vmId（当前实例标识）、token（当前传输认证凭证） 上下文字段
 * English: Inputs: { vmId, token } provides context fields vmId (current VM identifier), token (current transport credential)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function SharedDesktop({ vmId, token }: { vmId: string; token: string }) {
  const screen = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState('正在连接桌面…');
  useEffect(/** 中文：懒加载 @novnc/novnc 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码 | English: Lazily load @novnc/novnc and adapt its selected export as the default React component, deferring this feature's UI code download | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    let alive = true;
    let client: RFB | undefined;
    void import('@novnc/novnc').then(/** 中文：在账户、登录、权限与共享会话的配置和访问入口流程中登记浏览器或资源事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Account, login, permission and shared-session configuration and access surfaces, register browser/resource event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：{ default: RFBClient } 提供 default（default 状态） 上下文字段 | English: Inputs: { default: RFBClient } provides context fields default (default state) | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ ({ default: RFBClient }) => {
      if (!alive || !screen.current) return;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      client = new RFBClient(screen.current,
        `${scheme}//${location.host}` + socketPath('desktop-view', { vmId }, { token }));
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 AccountLogoutButton 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the AccountLogoutButton surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function AccountLogoutButton() {
  const principal = usePrincipal();
  if (!principal) return null;
  return <button className="secondary compact" title="退出账户" onClick={/** 中文：提交 operation /access/logout，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/logout for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback */ () =>
    void api('/access/logout', 'POST').finally(() => controllerSession.clearCredential())}>
    {principal.username} · 退出
  </button>;
}

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 ChangeApprovalPanel 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ChangeApprovalPanel surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ refreshKey = 0, onApplied } 提供 refreshKey（refreshKey 状态）、onApplied（onApplied 状态） 上下文字段
 * English: Inputs: { refreshKey = 0, onApplied } provides context fields refreshKey (refreshKey state), onApplied (onApplied state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function ChangeApprovalPanel({ refreshKey = 0, onApplied }: {
  refreshKey?: number; onApplied?: /** 中文：在操作确认后通知父级核对已应用状态；这是 ChangeApprovalPanel 的调用契约 | English: Notify the parent to reconcile applied state after operation confirmation; this is the callable contract of ChangeApprovalPanel | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
}) {
  const principal = usePrincipal();
  const [changes, setChanges] = useState<ChangeView[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /**
   * 中文：提交 operation /access/changes，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新changes 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/changes for Account, login, permission and shared-session configuration and access surfaces and update changes state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：signal：本次调用的取消寿命
   * English: Inputs: signal: cancellation lifetime for this invocation
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const refresh = async (signal?: AbortSignal) => {
    const result = await api<{ changes: ChangeView[] }>('/access/changes', 'GET', undefined, signal);
    setChanges(result.changes);
  };
  useEffect(/** 中文：当依赖 [principal?.id, refreshKey] 变化时重新核对父级远端视图，interval 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [principal?.id, refreshKey] change, reconcile the parent's remote view, interval state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const abort = new AbortController();
    void refresh(abort.signal).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason.message || reason));
    });
    const timer = setInterval(() => void refresh(abort.signal).catch((reason) => {
      if (!abort.signal.aborted) setError(String(reason.message || reason));
    }), 15_000);
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命，停止周期计时任务；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime, stop periodic timers. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => { abort.abort(); clearInterval(timer); };
  }, [principal?.id, refreshKey]);
  /**
   * 中文：提交 operation /access/changes/{id}/apply；operation /access/changes/{id}/decision，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、reviewed 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/changes/{id}/apply; operation /access/changes/{id}/decision for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, reviewed state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：id：目标资源标识；action：本次动作或状态机输入
   * English: Inputs: id: target resource identifier; action: current action/state-machine input
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 PolicyBundlePanel 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PolicyBundlePanel surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, projectId, onApplied } 提供 vmId（当前实例标识）、projectId（当前项目标识）、onApplied（onApplied 状态） 上下文字段
 * English: Inputs: { vmId, projectId, onApplied } provides context fields vmId (current VM identifier), projectId (current project identifier), onApplied (onApplied state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function PolicyBundlePanel({ vmId, projectId, onApplied }: {
  vmId: string; projectId: string; onApplied: /** 中文：在操作确认后通知父级核对已应用状态；这是 PolicyBundlePanel 的调用契约 | English: Notify the parent to reconcile applied state after operation confirmation; this is the callable contract of PolicyBundlePanel | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<void>;
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
  useEffect(/** 中文：提交 operation /access/policy-bundles/keys，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/policy-bundles/keys for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const abort = new AbortController();
    void api<PolicyKeys>('/access/policy-bundles/keys', 'GET', undefined, abort.signal)
      .then(setKeys).catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason.message || reason));
      });
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, []);
  useEffect(/** 中文：当依赖 [vmId, projectId] 变化时preview 状态，bundle 状态，reviewed 状态，exported 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, projectId] change, preview state, bundle state, reviewed state, exported state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setPreview(null); setBundle(null); setReviewed(false); setExported('');
  }, [vmId, projectId]);
  /**
   * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中忙碌标记，错误反馈，完成提示；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Account, login, permission and shared-session configuration and access surfaces, busy flag, error feedback, completion message. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：action：本次动作或状态机输入
   * English: Inputs: action: current action/state-machine input
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
  const perform = async (action: /** 中文：在调用者提供的取消信号范围内执行用户动作，失败以拒绝或抛错传回；这是 PolicyBundlePanel.perform 的调用契约 | English: Execute a user action within the supplied cancellation signal, propagating failure through rejection/throw; this is the callable contract of PolicyBundlePanel.perform | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<void>) => {
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
            <button className="secondary compact" disabled={busy} onClick={() => void perform(/** 中文：提交 operation /access/policy-bundles/keys，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新keys 状态、preview 状态、reviewed 状态、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/policy-bundles/keys for Account, login, permission and shared-session configuration and access surfaces and update keys state, preview state, reviewed state, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
              setKeys(await api<PolicyKeys>('/access/policy-bundles/keys', 'POST',
                { action: 'forget', revision: keys.revision, fingerprint: entry.fingerprint }));
              setPreview(null); setReviewed(false); setMessage('已撤销对此签名者的信任');
            })}>撤销信任</button>}</li>)}</ul>
      </details></>}
    <button className="secondary compact" disabled={busy} onClick={() => void perform(/** 中文：提交 operation /access/policy-bundles/export，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新exported 状态、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/policy-bundles/export for Account, login, permission and shared-session configuration and access surfaces and update exported state, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
      const result = await api<{ bundle: SignedPolicyBundle }>(
        '/access/policy-bundles/export', 'POST', target);
      setExported(JSON.stringify(result.bundle, null, 2));
      setMessage('当前项目策略已签名，可复制或下载');
    })}>导出签名策略包</button>
    {exported && <><label>导出的策略包 JSON<textarea rows={9} readOnly spellCheck={false}
      value={exported} /></label>
      <button className="secondary compact" onClick={/** 中文：在账户、登录、权限与共享会话的配置和访问入口流程中timeout 状态，创建二进制内容临时 URL；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Account, login, permission and shared-session configuration and access surfaces, timeout state, create temporary binary-content URLs. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
        const url = URL.createObjectURL(new Blob([exported], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `sakura-policy-${projectId}.json`;
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>下载策略包</button></>}
    <label>导入策略包 JSON<textarea rows={9} spellCheck={false} value={importText}
      onChange={(event) => { setImportText(event.target.value); setPreview(null);
        setBundle(null); setReviewed(false); }} /></label>
    <button className="secondary compact" disabled={busy || !importText.trim()}
      onClick={() => void perform(/** 中文：提交 operation /access/policy-bundles/preview，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新bundle 状态、preview 状态、reviewed 状态、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/policy-bundles/preview for Account, login, permission and shared-session configuration and access surfaces and update bundle state, preview state, reviewed state, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
          onClick={() => void perform(/** 中文：提交 operation /access/policy-bundles/keys，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新keys 状态、preview 状态、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/policy-bundles/keys for Account, login, permission and shared-session configuration and access surfaces and update keys state, preview state, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
        onClick={() => void perform(/** 中文：提交 operation /access/policy-bundles/apply，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新preview 状态、reviewed 状态、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/policy-bundles/apply for Account, login, permission and shared-session configuration and access surfaces and update preview state, reviewed state, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 RemoteAuditSettings 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RemoteAuditSettings surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
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
  useEffect(/** 中文：提交 operation /audit/remote，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /audit/remote for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
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
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, []);
  /**
   * 中文：提交 operation /audit/remote，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、status 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /audit/remote for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, status state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：action：本次动作或状态机输入
   * English: Inputs: action: current action/state-machine input
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 ProjectPermissionSettings 界面，组合 PolicyBundlePanel，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ProjectPermissionSettings surface for Account, login, permission and shared-session configuration and access surfaces and composing PolicyBundlePanel. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ users, vms, refresh } 提供 users（users 状态）、vms（vms 状态）、refresh（refresh 状态） 上下文字段
 * English: Inputs: { users, vms, refresh } provides context fields users (users state), vms (vms state), refresh (refresh state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function ProjectPermissionSettings({ users, vms, refresh }: {
  users: UserView[]; vms: SharedVm[]; refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 ProjectPermissionSettings 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of ProjectPermissionSettings | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<void>;
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
  useEffect(/** 中文：当依赖 [vmId, vms] 变化时vmId 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, vms] change, vmId state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!vmId && vms[0]) setVmId(vms[0].id);
  }, [vmId, vms]);
  useEffect(/** 中文：提交 operation /vms/{vmId}/projects，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /vms/{vmId}/projects for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!vmId) return;
    const abort = new AbortController();
    void api<{ projects: Array<{ id: string; name: string }> }>(
      `/vms/${vmId}/projects`, 'GET', undefined, abort.signal)
      .then((result) => { setProjects(result.projects);
        setProjectId((value) => result.projects.some((item) => item.id === value)
          ? value : result.projects[0]?.id || ''); setError(''); })
      .catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, [vmId]);
  useEffect(/** 中文：提交 operation /access/project-permissions?{query}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/project-permissions?{query} for Account, login, permission and shared-session configuration and access surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!vmId || !projectId) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ vmId, projectId });
    void api<ProjectPolicyView>(`/access/project-permissions?${query}`, 'GET', undefined, abort.signal)
      .then((result) => { setPolicy(result); setError(''); })
      .catch((reason) => { if (!abort.signal.aborted) setError(String(reason.message || reason)); });
    /**
     * 中文：在账户、登录、权限与共享会话的配置和访问入口流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Account, login, permission and shared-session configuration and access surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, [vmId, projectId]);
  /**
   * 中文：提交 operation /vms/{vmId}/project?project={projectId}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新ownerDocument 状态、ownerVersion 状态、ownerScope 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /vms/{vmId}/project?project={projectId} for Account, login, permission and shared-session configuration and access surfaces and update ownerDocument state, ownerVersion state, ownerScope state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const loadOwnerDocument = async () => {
    const scope = `${vmId}:${projectId}`;
    const result = await api<{ project: unknown; version: string }>(
      `/vms/${vmId}/project?project=${projectId}`);
    setOwnerDocument(JSON.stringify(result.project, null, 2));
    setOwnerVersion(result.version);
    setOwnerScope(scope);
  };
  useEffect(/** 中文：当依赖 [vmId, projectId] 变化时ownerDocument 状态，ownerVersion 状态，ownerScope 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, projectId] change, ownerDocument state, ownerVersion state, ownerScope state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!vmId || !projectId) return;
    setOwnerDocument(''); setOwnerVersion(''); setOwnerScope('');
    void loadOwnerDocument().catch((reason) => setError(String(reason.message || reason)));
  }, [vmId, projectId]);
  return <section className="system-card" aria-label="项目权限管理">
    <h3>项目成员与权限</h3>
    <p>成员默认无权访问任何项目。为每个项目定义角色，再将成员分配到角色。</p>
    <form onSubmit={/** 中文：提交 operation /access/members，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、username 状态、password 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/members for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, username state, password state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
      <button className="secondary compact" disabled={busy} onClick={/** 中文：提交 operation '/access/members/' + item.id，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、策略草稿；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation '/access/members/' + item.id for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, policy draft. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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
      <button className="primary compact" disabled={busy} onClick={/** 中文：提交 operation /access/project-permissions?{query}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、策略草稿；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/project-permissions?{query} for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, policy draft. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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
      <PolicyBundlePanel vmId={vmId} projectId={projectId} onApplied={/** 中文：提交 operation /access/project-permissions?{query}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新策略草稿；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/project-permissions?{query} for Account, login, permission and shared-session configuration and access surfaces and update policy draft. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
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
          ownerSummary.trim().length < 8} onClick={/** 中文：提交 operation /access/changes，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、ownerSummary 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/changes for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, ownerSummary state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 SsoAccountLinks 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SsoAccountLinks surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ accountId } 提供 accountId（accountId 状态） 上下文字段
 * English: Inputs: { accountId } provides context fields accountId (accountId state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function SsoAccountLinks({ accountId }: { accountId: string }) {
  const [view, setView] = useState<SsoView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /**
   * 中文：提交 operation /access/sso，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新服务端视图；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/sso for Account, login, permission and shared-session configuration and access surfaces and update server view. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refresh = async () => setView(await api<SsoView>('/access/sso'));
  useEffect(/** 中文：当依赖 [accountId] 变化时重新核对父级远端视图；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [accountId] change, reconcile the parent's remote view. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { void refresh().catch((reason) => setError(String(reason.message || reason))); },
    [accountId]);
  if (!view) return null;
  const bindings = view.bindings.filter((item) => item.accountId === accountId);
  return <section className="system-card" aria-label="单点登录身份">
    <h3>单点登录身份</h3>
    <p>先使用当前账户绑定外部身份，之后即可在登录页使用该提供商登录。</p>
    {(['oidc', 'saml'] as const).filter((provider) => !!view[provider]).map(/**
     * 中文功能：为当前启用的 OIDC/SAML 提供者展示绑定状态以及绑定、重新绑定、解除按钮，动作通过 busy 和反馈状态协调。
     * English: Render binding state and link/relink/unlink actions for enabled OIDC/SAML providers, coordinating actions through busy/feedback state.
     * 输入 / Inputs: provider.
     * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
     * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
     */
    (provider) => {
      const binding = bindings.find((item) => item.provider === provider);
      return <div key={provider}>
        <strong>{provider === 'oidc' ? 'OIDC' : 'SAML'}</strong>
        {binding ? <p>已绑定：{binding.subject} · {binding.issuer}</p> : <p>尚未绑定</p>}
        <button className="secondary compact" disabled={busy} onClick={/** 中文：在账户、登录、权限与共享会话的配置和访问入口流程中忙碌标记，错误反馈，完成提示，重新核对父级远端视图；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Account, login, permission and shared-session configuration and access surfaces, busy flag, error feedback, completion message, reconcile the parent's remote view. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
          setBusy(true); setError(''); setMessage('');
          try { await startSso(provider, 'link'); await refresh(); setMessage('外部身份已绑定'); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '绑定失败'); }
          finally { setBusy(false); }
        }}>{binding ? '重新绑定' : '绑定身份'}</button>
        {binding && <button className="secondary compact" disabled={busy} onClick={/** 中文：提交 operation /access/sso/link/{provider}，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/sso/link/{provider} for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
          setBusy(true); setError(''); setMessage('');
          try { await api(`/access/sso/link/${provider}`, 'DELETE');
            await refresh(); setMessage('已解除绑定，关联登录会话已撤销'); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '解除绑定失败'); }
          finally { setBusy(false); }
        }}>解除绑定</button>}
      </div>;
    })}
    {!view.oidc && !view.saml && <p>管理员尚未配置身份提供商。</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 SsoConfiguration 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SsoConfiguration surface for Account, login, permission and shared-session configuration and access surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ users } 提供 users（users 状态） 上下文字段
 * English: Inputs: { users } provides context fields users (users state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function SsoConfiguration({ users }: { users: UserView[] }) {
  const [view, setView] = useState<SsoView | null>(null);
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [authMethod, setAuthMethod] = useState<'client_secret_basic' |
    'client_secret_post' | 'none'>('client_secret_basic');
  const [secret, setSecret] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /**
   * 中文：提交 operation /access/sso，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新服务端视图、issuer 状态、clientId 状态、authMethod 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/sso for Account, login, permission and shared-session configuration and access surfaces and update server view, issuer state, clientId state, authMethod state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const refresh = async () => {
    const next = await api<SsoView>('/access/sso');
    setView(next);
    if (next.oidc) {
      setIssuer(next.oidc.issuer); setClientId(next.oidc.clientId);
      setAuthMethod(next.oidc.authMethod);
    }
  };
  useEffect(/** 中文：当依赖 [] 变化时重新核对父级远端视图；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, reconcile the parent's remote view. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { void refresh().catch((reason) => setError(String(reason.message || reason))); }, []);
  if (!view) return null;
  return <section className="system-card" aria-label="单点登录配置">
    <h3>OIDC 与 SAML 单点登录</h3>
    <p>为本机账户绑定外部身份。提供商配置变更会解除该提供商的所有账户绑定并撤销其登录会话。</p>
    <p>OIDC 回调：<code>{view.callbackUrl}</code></p>
    <p>SAML 服务提供商 ID：<code>{view.serviceProviderId}</code>；ACS：
      <code>{view.samlCallbackUrl}</code></p>
    <form onSubmit={/** 中文：提交 operation /access/sso/oidc，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、secret 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/sso/oidc for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, secret state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
      event.preventDefault(); setBusy(true); setError(''); setMessage('');
      try {
        await api('/access/sso/oidc', 'PUT', { issuer, clientId, authMethod,
          ...(authMethod !== 'none' ? { clientSecret: secret } : {}) });
        setSecret(''); await refresh(); setMessage('OIDC 已配置，请在下方绑定账户身份');
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'OIDC 配置失败'); }
      finally { setBusy(false); }
    }}>
      <h4>OIDC</h4>
      <label>Issuer URL<input type="url" required value={issuer} disabled={busy}
        placeholder="https://id.example.com/" onChange={(event) => setIssuer(event.target.value)} /></label>
      <label>Client ID<input required value={clientId} disabled={busy}
        onChange={(event) => setClientId(event.target.value)} /></label>
      <label>Token 认证方式<select value={authMethod} disabled={busy}
        onChange={(event) => setAuthMethod(event.target.value as typeof authMethod)}>
        <option value="client_secret_basic">Client Secret Basic</option>
        <option value="client_secret_post">Client Secret Post</option>
        <option value="none">Public Client</option>
      </select></label>
      {authMethod !== 'none' && <label>Client Secret<input type="password" required value={secret}
        autoComplete="off" disabled={busy} onChange={(event) => setSecret(event.target.value)} /></label>}
      <button className="primary compact" disabled={busy || !issuer || !clientId ||
        (authMethod !== 'none' && !secret)}>保存 OIDC 配置</button>
      {view.oidc && <button type="button" className="secondary compact" disabled={busy}
        onClick={/** 中文：提交 operation /access/sso/oidc，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/sso/oidc for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
          setBusy(true); setError(''); setMessage('');
          try { await api('/access/sso/oidc', 'DELETE'); await refresh();
            setMessage('OIDC 已停用'); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '停用失败'); }
          finally { setBusy(false); }
        }}>停用 OIDC</button>}
    </form>
    <form onSubmit={/** 中文：提交 operation /access/sso/saml，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示、metadataXml 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/sso/saml for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message, metadataXml state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
      event.preventDefault(); setBusy(true); setError(''); setMessage('');
      try { await api('/access/sso/saml', 'PUT', { metadataXml });
        setMetadataXml(''); await refresh(); setMessage('SAML 已配置，请在下方绑定账户身份'); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'SAML 配置失败'); }
      finally { setBusy(false); }
    }}>
      <h4>SAML 2.0</h4>
      {view.saml && <p>当前 IdP：{view.saml.issuer} · 签名证书指纹：
        {view.saml.fingerprints.join('、')}</p>}
      <label>IdP 元数据 XML<textarea required rows={8} value={metadataXml} disabled={busy}
        onChange={(event) => setMetadataXml(event.target.value)} /></label>
      <button className="primary compact" disabled={busy || !metadataXml.trim()}>保存 SAML 配置</button>
      {view.saml && <button type="button" className="secondary compact" disabled={busy}
        onClick={/** 中文：提交 operation /access/sso/saml，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈、完成提示；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/sso/saml for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback, completion message. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
          setBusy(true); setError(''); setMessage('');
          try { await api('/access/sso/saml', 'DELETE'); await refresh();
            setMessage('SAML 已停用'); }
          catch (reason) { setError(reason instanceof Error ? reason.message : '停用失败'); }
          finally { setBusy(false); }
        }}>停用 SAML</button>}
    </form>
    {view.bindings.length > 0 && <><h4>已绑定账户</h4><ul>
      {view.bindings.map((binding) => <li key={binding.id}>
        {users.find((user) => user.id === binding.accountId)?.username || '已删除账户'} ·
        {' '}{binding.provider.toUpperCase()} · {binding.subject}
      </li>)}
    </ul></>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

/**
 * 中文：呈现账户、登录、权限与共享会话的配置和访问入口中的 AccessSettings 界面，组合 ProjectPermissionSettings、ChangeApprovalPanel、RemoteAuditSettings、JitOwnerPanel、BrowserExtensionManager、MobileCompanionManager、SsoConfiguration、SsoAccountLinks，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the AccessSettings surface for Account, login, permission and shared-session configuration and access surfaces and composing ProjectPermissionSettings, ChangeApprovalPanel, RemoteAuditSettings, JitOwnerPanel, BrowserExtensionManager, MobileCompanionManager, SsoConfiguration, SsoAccountLinks. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
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
  /**
   * 中文：提交 operation /access/users；operation /vms，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新users 状态、vms 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform operation /access/users; operation /vms for Account, login, permission and shared-session configuration and access surfaces and update users state, vms state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const refresh = async () => {
    if (!accountMode || principal?.role !== 'owner') return;
    const [accounts, machines] = await Promise.all([
      api<{ users: UserView[] }>('/access/users'), api<SharedVm[]>('/vms'),
    ]);
    setUsers(accounts.users);
    setVms(machines);
  };
  useEffect(/** 中文：当依赖 [accountMode, principal?.id] 变化时重新核对父级远端视图；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [accountMode, principal?.id] change, reconcile the parent's remote view. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { void refresh().catch((reason) => setError(String(reason.message || reason))); },
    [accountMode, principal?.id]);
  return <section className="system-card">
    <h3>账户与只读分享</h3>
    {!accountMode ? <>
      <p>启用后，原本机共享凭证立即失效；管理员以 owner 账户登录。只读账户仅能查看指定实例摘要。</p>
      <form onSubmit={/** 中文：提交 operation /access/enable，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新错误反馈、完成提示、忙碌标记、password 状态、confirm 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/enable for Account, login, permission and shared-session configuration and access surfaces and update error feedback, completion message, busy flag, password state, confirm state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
      <form onSubmit={/** 中文：提交 operation /access/users，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新错误反馈、完成提示、忙碌标记、username 状态、viewerPassword 状态、当前选择；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/users for Account, login, permission and shared-session configuration and access surfaces and update error feedback, completion message, busy flag, username state, viewerPassword state, current selection. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
        <button className="secondary compact" disabled={busy} onClick={/** 中文：提交 operation '/access/users/' + item.id，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新忙碌标记、错误反馈；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation '/access/users/' + item.id for Account, login, permission and shared-session configuration and access surfaces and update busy flag, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
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
      {principal?.role === 'owner' && <><SsoConfiguration users={users} />
        <SsoAccountLinks accountId={principal.id} /></>}
      <h4>更换管理员密码</h4>
      <p>更换后所有账户会话立即失效，需要用新密码重新登录。</p>
      <form onSubmit={/** 中文：提交 operation /access/password，完成账户、登录、权限与共享会话的配置和访问入口的数据交互并更新错误反馈、完成提示、忙碌标记、oldPassword 状态、newPassword 状态、newPasswordConfirm 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /access/password for Account, login, permission and shared-session configuration and access surfaces and update error feedback, completion message, busy flag, oldPassword state, newPassword state, newPasswordConfirm state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
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
