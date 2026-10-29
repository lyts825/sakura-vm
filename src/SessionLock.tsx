/**
 * 模块职责（中文）：把控制面锁定状态映射为解锁界面、锁定按钮与闲置锁定配置。
 * Module responsibility (English): Coordinating locking, unlocking and idle-detection surfaces.
 * 详细范围（中文）：公开入口包括 SessionBoundary, SessionLockButton, SessionLockSettings；职责覆盖协调锁定、解锁和闲置检测界面，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SessionBoundary, SessionLockButton, SessionLockSettings. The scope covers Coordinating locking, unlocking and idle-detection surfaces. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type { SessionLockView } from '../shared/session-lock';
import { api, controllerSession } from './controller-session';
import { apiResponseError } from '../shared/errors';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './settings-feedback.css';

/**
 * 中文：通过外部存储订阅控制面锁定/到期快照，锁屏界面随服务端和本地闲置变化更新。
 * English: Subscribe to controller lock/expiry snapshots through the external store so lock surfaces follow server/local-idle transitions.
 */
const useSession = () =>
  useSyncExternalStore(controllerSession.subscribeSession, controllerSession.getSession);

/**
 * 中文：呈现协调锁定、解锁和闲置检测界面中的 SessionBoundary 界面，组合 LockKeyhole，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SessionBoundary surface for Coordinating locking, unlocking and idle-detection surfaces and composing LockKeyhole. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ children } 提供 children（children 状态） 上下文字段
 * English: Inputs: { children } provides context fields children (children state)
 */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const session = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountEnabled, setAccountEnabled] = useState(false);
  useEffect(/** 中文：读取 GET /api/access/status，完成协调锁定、解锁和闲置检测界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /api/access/status for Coordinating locking, unlocking and idle-detection surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!session.locked) return;
    const abort = new AbortController();
    void fetch('/api/access/status', { cache: 'no-store', signal: abort.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value) => { if (!abort.signal.aborted) setAccountEnabled(value?.enabled === true); })
      .catch(() => { if (!abort.signal.aborted) setAccountEnabled(false); });
    /**
     * 中文：在协调锁定、解锁和闲置检测界面流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Coordinating locking, unlocking and idle-detection surfaces, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     */
    return () => abort.abort();
  }, [session.locked]);
  useEffect(/** 中文：读取 GET /api/session，完成协调锁定、解锁和闲置检测界面的数据交互并更新interval 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /api/session for Coordinating locking, unlocking and idle-detection surfaces and update interval state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!session.enabled && !session.locked) return;
    const abort = new AbortController();
    let pending = false;
    /**
     * 中文：读取 GET /api/session，完成协调锁定、解锁和闲置检测界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform GET /api/session for Coordinating locking, unlocking and idle-detection surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
     * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
     * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
     * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
     * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
     * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
     * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
     */
    const refresh = async () => {
      const current = controllerSession.getSession();
      if (!current.locked && current.expiresAt && Date.now() >= current.expiresAt)
        controllerSession.lockLocally();
      if (pending) return;
      pending = true;
      const generation = controllerSession.getGeneration();
      try {
        const response = await fetch('/api/session', {
          cache: 'no-store',
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) return;
        const value = await response.json();
        if (!abort.signal.aborted && generation === controllerSession.getGeneration())
          controllerSession.updateSession(value);
      } catch {
        /* Keep the private interface hidden while a locked host is unreachable. */
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    document.addEventListener('visibilitychange', refresh);
    /**
     * 中文：在协调锁定、解锁和闲置检测界面流程中取消捕获的异步寿命，停止周期计时任务，移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Coordinating locking, unlocking and idle-detection surfaces, abort the captured asynchronous lifetime, stop periodic timers, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [session.enabled, session.locked]);
  useEffect(/** 中文：提交 operation /session/activity，完成协调锁定、解锁和闲置检测界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /session/activity for Coordinating locking, unlocking and idle-detection surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    if (!session.enabled || session.locked) return;
    let last = 0,
      pending = false;
    const abort = new AbortController();
    /**
     * 中文：提交 operation /session/activity，完成协调锁定、解锁和闲置检测界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
     * English: Perform operation /session/activity for Coordinating locking, unlocking and idle-detection surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
     * 中文：输入：event：触发本处理器的事件及其数据
     * English: Inputs: event: triggering event and its data
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const activity = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== 'visible' || pending || Date.now() - last < 5000)
        return;
      last = Date.now();
      pending = true;
      const generation = controllerSession.getGeneration();
      void api<SessionLockView>('/session/activity', 'POST', {}, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted && generation === controllerSession.getGeneration())
            controllerSession.updateSession(value);
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'];
    for (const event of events) document.addEventListener(event, activity, { capture: true, passive: true });
    /**
     * 中文：在协调锁定、解锁和闲置检测界面流程中取消捕获的异步寿命，移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Coordinating locking, unlocking and idle-detection surfaces, abort the captured asynchronous lifetime, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      abort.abort();
      for (const event of events) document.removeEventListener(event, activity, true);
    };
  }, [session.enabled, session.locked]);
  useEffect(/** 中文：当依赖 [session.locked] 变化时password 状态，错误反馈；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [session.locked] change, password state, error feedback. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setPassword('');
    setError('');
  }, [session.locked]);
  if (!session.locked) return children;
  return (
    <main className="session-lock-screen">
      <section className="session-lock-panel" aria-labelledby="session-lock-title">
        <LockKeyhole size={36} aria-hidden="true" />
        <h1 id="session-lock-title">Sakura 已锁定</h1>
        <p>输入本机解锁密码恢复控制。实例和已提交的后台任务继续运行。</p>
        <form
          onSubmit={/** 中文：提交 POST /api/session/unlock，完成协调锁定、解锁和闲置检测界面的数据交互并更新password 状态、错误反馈、忙碌标记；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /api/session/unlock for Coordinating locking, unlocking and idle-detection surfaces and update password state, error feedback, busy flag. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
            event.preventDefault();
            const secret = password;
            setPassword('');
            setError('');
            setBusy(true);
            try {
              const response = await fetch('/api/session/unlock', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: secret }),
                signal: AbortSignal.timeout(15000),
              });
              const value = await response.json();
              if (!response.ok) throw apiResponseError(response.status, value);
              controllerSession.updateSession(value);
            } catch (error) {
              setError(error instanceof Error ? error.message : '解锁失败');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            解锁密码
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              maxLength={256}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </label>
          <button className="primary" disabled={busy || !password || session.retryAfterSeconds > 0}>
            {busy ? '正在解锁…' : '解锁控制面'}
          </button>
        </form>
        {accountEnabled && location.hostname === 'localhost' ? <button type="button" className="secondary"
          disabled={busy} onClick={/** 中文：提交 POST '/api/session/unlock/passkey/' + path；GET options；GET verify，完成协调锁定、解锁和闲置检测界面的数据交互并更新错误反馈、忙碌标记；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST '/api/session/unlock/passkey/' + path; GET options; GET verify for Coordinating locking, unlocking and idle-detection surfaces and update error feedback, busy flag. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：当前浏览器不支持通行密钥。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 当前浏览器不支持通行密钥. These errors reach the direct caller or this function's catch handler | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
            setError(''); setBusy(true);
            try {
              if (!window.PublicKeyCredential) throw new Error('当前浏览器不支持通行密钥');
              /**
               * 中文：提交 POST '/api/session/unlock/passkey/' + path，完成协调锁定、解锁和闲置检测界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
               * English: Perform POST '/api/session/unlock/passkey/' + path for Coordinating locking, unlocking and idle-detection surfaces. Propagate asynchronous failure to this catch path or the outer action feedback
               * 中文：输入：path：目标文件或请求路径；input：尚待校验的输入数据
               * English: Inputs: path: target file/request path; input: input data requiring validation
               */
              const request = async (path: string, input: unknown) => {
                const response = await fetch('/api/session/unlock/passkey/' + path, {
                  method: 'POST', cache: 'no-store',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(input), signal: AbortSignal.timeout(60_000),
                });
                const value = await response.json();
                if (!response.ok) throw apiResponseError(response.status, value);
                return value;
              };
              const begin = await request('options', {}) as
                { ceremonyId: string; options: PublicKeyCredentialRequestOptionsJSON };
              const { startAuthentication } = await import('@simplewebauthn/browser');
              const response = await startAuthentication({ optionsJSON: begin.options });
              const result = await request('verify',
                { ceremonyId: begin.ceremonyId, response });
              controllerSession.updateSession(result.session);
              controllerSession.adoptAccount(result.token, result.principal);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '通行密钥解锁失败');
            } finally { setBusy(false); }
          }}>使用 Windows Hello / 本机通行密钥解锁</button>
          : accountEnabled && <p><a href={`http://localhost:${location.port || '80'}/`}>
            在 localhost 打开以使用本机通行密钥解锁</a></p>}
        {session.retryAfterSeconds > 0 && (
          <p role="status">尝试过多，请在 {session.retryAfterSeconds} 秒后重试。</p>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

/**
 * 中文：呈现协调锁定、解锁和闲置检测界面中的 SessionLockButton 界面，组合 LockKeyhole，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SessionLockButton surface for Coordinating locking, unlocking and idle-detection surfaces and composing LockKeyhole. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 */
export function SessionLockButton() {
  const session = useSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!session.enabled || session.locked) return null;
  return (
    <>
      <button
        className="icon-button"
        title="立即锁定控制面"
        aria-label="立即锁定控制面"
        disabled={busy}
        onClick={/** 中文：提交 operation /session/lock，完成协调锁定、解锁和闲置检测界面的数据交互并更新忙碌标记、错误反馈；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform operation /session/lock for Coordinating locking, unlocking and idle-detection surfaces and update busy flag, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
          setBusy(true);
          setError('');
          try {
            controllerSession.updateSession(await api('/session/lock', 'POST', {}));
          } catch (error) {
            setError(error instanceof Error ? error.message : '锁定失败');
          } finally {
            setBusy(false);
          }
        }}
      >
        <LockKeyhole size={18} />
      </button>
      {error && (
        <span role="alert" className="inline-error">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * 中文：呈现协调锁定、解锁和闲置检测界面中的 SessionLockSettings 界面，订阅 /session/settings，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SessionLockSettings surface for Coordinating locking, unlocking and idle-detection surfaces, subscribing to /session/settings. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function SessionLockSettings({ request }: { request: Request }) {
  const remote = useRemote<SessionLockView>(request, '/session/settings', true, 0);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const hintId = useId();
  const idleValid = Number.isInteger(idleMinutes) && idleMinutes >= 1 && idleMinutes <= 240;
  const passwordShort = !!newPassword && newPassword.length < 12;
  const passwordsDiffer = !!newPassword && !!confirmation && newPassword !== confirmation;
  useEffect(/** 中文：当依赖 [remote.data] 变化时启用标记，idleMinutes 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data] change, enabled marker, idleMinutes state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (remote.data) {
      setEnabled(remote.data.enabled);
      setIdleMinutes(remote.data.idleMinutes);
      controllerSession.updateSession(remote.data);
    }
  }, [remote.data]);
  const valid =
    Number.isInteger(idleMinutes) &&
    idleMinutes >= 1 &&
    idleMinutes <= 240 &&
    (!remote.data?.configured || !!password) &&
    (!enabled || remote.data?.configured || newPassword.length >= 12) &&
    (!newPassword || (newPassword.length >= 12 && newPassword === confirmation));
  return (
    <section className="system-card session-lock-settings" aria-label="会话自动锁定设置">
      <h3>会话自动锁定</h3>
      <p className="lock-settings-state" role="status">{remote.data ? `已保存状态：${remote.data.enabled ? '已启用自动锁定' : '未启用自动锁定'}` : remote.error ? '暂时无法读取锁定设置' : '正在读取锁定设置…'}</p>
      <p className="subtle-note">
        本机所有标签页、CLI 和 SDK
        共用锁定状态。空闲后断开终端与桌面连接，重启服务后也需要解锁。锁定期间实例和已提交任务继续运行。
      </p>
      <p className="subtle-note">
        此功能保护控制入口，不加密磁盘，也不会清除浏览器草稿和已选择保存的离线监控快照。请妥善保存密码。
      </p>
      <form
        onSubmit={/**
         * 中文功能：拦截锁定策略提交，验证输入后捕获密码并立即清空敏感表单；保存响应更新当前会话，finally 刷新远端设置。
         * English: Intercept lock-policy submission, validate/capture passwords and clear sensitive fields immediately; update the session from the save response and refresh remote settings in finally.
         * 输入 / Inputs: event.
         * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
         * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
         * 设计思路：密码保留在本次 input 中而不是长期表单状态；刷新在失败路径也执行，以重新读取控制面的最终设置。
         * Design: Retain passwords in this invocation input rather than persistent form state; refresh also runs on failure to reread final control-plane settings.
         */
        (event) => {
          event.preventDefault();
          if (!valid || action.busy || !remote.data) return;
          const input = { enabled, idleMinutes, password, ...(newPassword ? { newPassword } : {}) };
          setPassword('');
          setNewPassword('');
          setConfirmation('');
          void action.run(/** 中文：提交 PATCH /session/settings，完成协调锁定、解锁和闲置检测界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PATCH /session/settings for Coordinating locking, unlocking and idle-detection surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
            try {
              controllerSession.updateSession(await request('/session/settings', 'PATCH', input, signal));
            } finally {
              remote.reload();
            }
          }, '会话锁定策略已保存');
        }}
      >
        <fieldset disabled={action.busy || !remote.data}>
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            启用空闲自动锁定
          </label>
          <div className="shortcut-fields">
            <label>
              空闲分钟数
              <input
                type="number"
                min={1}
                max={240}
                step={1}
                value={idleMinutes || ''}
                aria-label="空闲分钟数"
                aria-invalid={!idleValid || undefined}
                aria-describedby={`${hintId}-idle`}
                onChange={(event) => setIdleMinutes(Number(event.target.value))}
                required
              />
              <small id={`${hintId}-idle`} className={!idleValid ? 'settings-field-error' : undefined}>请输入 1～240 的整数，单位为分钟。</small>
            </label>
            {remote.data?.configured && (
              <label>
                当前解锁密码
                <input
                  type="password"
                  autoComplete="current-password"
                  maxLength={256}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
            )}
            <label>
              {remote.data?.configured ? '新解锁密码（留空保留）' : '设置解锁密码'}
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                value={newPassword}
                aria-label={remote.data?.configured ? '新解锁密码（留空保留）' : '设置解锁密码'}
                aria-invalid={passwordShort || undefined}
                aria-describedby={`${hintId}-password`}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <small id={`${hintId}-password`} className={passwordShort ? 'settings-field-error' : undefined}>{passwordShort ? '新密码不足 12 个字符。' : '新密码至少 12 个字符，最多 256 个字符。'}</small>
            </label>
            <label>
              确认新解锁密码
              <input
                type="password"
                autoComplete="new-password"
                maxLength={256}
                value={confirmation}
                aria-label="确认新解锁密码"
                aria-invalid={passwordsDiffer || undefined}
                aria-describedby={`${hintId}-confirmation`}
                onChange={(event) => setConfirmation(event.target.value)}
              />
              <small id={`${hintId}-confirmation`} className={passwordsDiffer ? 'settings-field-error' : undefined}>{passwordsDiffer ? '两次输入的新密码不一致。' : '更换密码时，请再次输入相同的新密码。'}</small>
            </label>
          </div>
          <button className="secondary compact" type="submit" disabled={!valid}>
            {action.busy ? '正在保存锁定策略…' : '保存锁定策略'}
          </button>
        </fieldset>
      </form>
      <Feedback error={remote.error || action.error} message={action.message} />
      {remote.error && <button className="secondary compact" disabled={action.busy} onClick={remote.reload}>重新读取锁定设置</button>}
    </section>
  );
}
