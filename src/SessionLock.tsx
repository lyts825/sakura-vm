import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';
import type { SessionLockView } from '../shared/session-lock';
import { api, controllerSession } from './controller-session';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

const useSession = () =>
  useSyncExternalStore(controllerSession.subscribeSession, controllerSession.getSession);

export function SessionBoundary({ children }: { children: ReactNode }) {
  const session = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session.enabled && !session.locked) return;
    const abort = new AbortController();
    let pending = false;
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
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [session.enabled, session.locked]);
  useEffect(() => {
    if (!session.enabled || session.locked) return;
    let last = 0,
      pending = false;
    const abort = new AbortController();
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
    return () => {
      abort.abort();
      for (const event of events) document.removeEventListener(event, activity, true);
    };
  }, [session.enabled, session.locked]);
  useEffect(() => {
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
          onSubmit={async (event) => {
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
              if (!response.ok) throw new Error(value.error || '解锁失败');
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
        onClick={async () => {
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

export function SessionLockSettings({ request }: { request: Request }) {
  const remote = useRemote<SessionLockView>(request, '/session/settings', true, 0);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(15);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => {
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
      <p className="subtle-note">
        本机所有标签页、CLI 和 SDK
        共用锁定状态。空闲后断开终端与桌面连接，重启服务后也需要解锁。锁定期间实例和已提交任务继续运行。
      </p>
      <p className="subtle-note">
        此功能保护控制入口，不加密磁盘，也不会清除浏览器草稿和已选择保存的离线监控快照。请妥善保存密码。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          const input = { enabled, idleMinutes, password, ...(newPassword ? { newPassword } : {}) };
          setPassword('');
          setNewPassword('');
          setConfirmation('');
          void action.run(async (signal) => {
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
                onChange={(event) => setIdleMinutes(Number(event.target.value))}
                required
              />
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
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              确认新解锁密码
              <input
                type="password"
                autoComplete="new-password"
                maxLength={256}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
          </div>
          <button className="secondary compact" type="submit" disabled={!valid}>
            保存锁定策略
          </button>
        </fieldset>
      </form>
      <Feedback error={remote.error || action.error} message={action.message} />
    </section>
  );
}
