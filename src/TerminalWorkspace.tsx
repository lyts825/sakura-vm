import { Columns2, Plus, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Request } from './feature-shared';
import { getTerminalStore } from './terminal-store';
import { restoreLayouts } from './terminal-layouts';
import { controllerSession } from './controller-session';

type SharedViewer = { id: string; username: string; role: 'owner' | 'viewer';
  vmIds: string[]; expiresAt: number | null };
type TerminalGrant = { id: string; vmId: string; session: string;
  viewerId: string; expiresAt: number };

export function TerminalWorkspace({
  id,
  request,
  render,
}: {
  id: string;
  request: Request;
  render: (session: string) => ReactNode;
}) {
  const store = getTerminalStore(id);
  const principal = useSyncExternalStore(controllerSession.subscribe, controllerSession.getPrincipal);
  const { tabs, active, closing, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const dispatch = store.dispatch;
  const [split, setSplit] = useState(false);
  const [secondary, setSecondary] = useState('');
  const [layoutName, setLayoutName] = useState('');
  const [layoutError, setLayoutError] = useState('');
  const [layouts, setLayouts] = useState(() => {
    try {
      return restoreLayouts(JSON.parse(localStorage.getItem('sakura-terminal-layouts') || '[]'));
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sakura-terminal-view-' + id) || '{}');
      setSplit(saved.split === true);
      setSecondary(typeof saved.secondary === 'string' ? saved.secondary : '');
    } catch {
      setSplit(false);
      setSecondary('');
    }
  }, [id]);
  const saveView = (nextSplit: boolean, nextSecondary: string) => {
    setSplit(nextSplit);
    setSecondary(nextSecondary);
    try {
      localStorage.setItem(
        'sakura-terminal-view-' + id,
        JSON.stringify({ split: nextSplit, secondary: nextSecondary }),
      );
    } catch {
      setLayoutError('浏览器存储不可用，布局仅在当前页面生效');
    }
  };
  const second =
    secondary !== active && tabs.some((tab) => tab.id === secondary)
      ? secondary
      : tabs.find((t) => t.id !== active)?.id;
  return (
    <div className="terminal-workspace">
      <div className="terminal-tabs" role="tablist" aria-label="终端会话">
        {tabs.map((t) => (
          <div className={`terminal-tab ${t.id === active ? 'active' : ''}`} key={t.id}>
            <button
              role="tab"
              id={`${id}-terminal-tab-${t.id}`}
              aria-controls={`${id}-terminal-pane-${t.id}`}
              tabIndex={t.id === active ? 0 : -1}
              aria-selected={t.id === active}
              onClick={() => dispatch({ type: 'select', id: t.id })}
              onKeyDown={(event) => {
                const index = tabs.findIndex((tab) => tab.id === t.id);
                const next =
                  event.key === 'ArrowRight'
                    ? tabs[(index + 1) % tabs.length]
                    : event.key === 'ArrowLeft'
                      ? tabs[(index + tabs.length - 1) % tabs.length]
                      : event.key === 'Home'
                        ? tabs[0]
                        : event.key === 'End'
                          ? tabs[tabs.length - 1]
                          : null;
                if (!next) return;
                event.preventDefault();
                dispatch({ type: 'select', id: next.id });
                document.getElementById(`${id}-terminal-tab-${next.id}`)?.focus();
              }}
              onDoubleClick={() => {
                const name = prompt('终端名称', t.name);
                if (name?.trim()) dispatch({ type: 'rename', id: t.id, name });
              }}
            >
              {t.name}
            </button>
            {tabs.length > 1 && (
              <button
                aria-label={`关闭 ${t.name}`}
                disabled={Boolean(closing)}
                onClick={() =>
                  void store.close(t.id, () =>
                    request(`/vms/${id}/terminal-session`, 'POST', { session: t.id }),
                  )
                }
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        <button
          aria-label="新建终端"
          disabled={tabs.length >= 8}
          onClick={() => {
            dispatch({ type: 'add', id: crypto.randomUUID() });
          }}
        >
          <Plus size={14} />
        </button>
        <button
          aria-pressed={split}
          disabled={tabs.length < 2}
          onClick={() => saveView(!split, second || '')}
        >
          <Columns2 size={14} />
          分屏
        </button>
      </div>
      <details className="terminal-layout-controls">
        <summary>终端布局预设</summary>
        <div className="feature-actions">
          <input
            aria-label="布局名称"
            maxLength={40}
            value={layoutName}
            onChange={(event) => setLayoutName(event.target.value)}
            placeholder="例如：开发与日志"
          />
          <button
            disabled={!layoutName.trim() || layouts.length >= 20}
            onClick={() => {
              const next = [
                ...layouts,
                { id: crypto.randomUUID(), name: layoutName.trim(), tabs, active, split, secondary: second },
              ];
              try {
                localStorage.setItem('sakura-terminal-layouts', JSON.stringify(next));
                setLayouts(next);
                setLayoutName('');
                setLayoutError('');
              } catch {
                setLayoutError('无法保存布局，请检查浏览器存储');
              }
            }}
          >
            保存当前布局
          </button>
          {split && (
            <label>
              副窗格
              <select
                aria-label="副窗格"
                value={second || ''}
                onChange={(event) => saveView(true, event.target.value)}
              >
                {tabs
                  .filter((tab) => tab.id !== active)
                  .map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        {layouts.map((layout) => (
          <div className="feature-actions" key={layout.id}>
            <span>
              {layout.name} · {layout.tabs.length} 个终端 · {layout.split ? '分屏' : '单窗格'}
            </span>
            <button
              disabled={!!closing}
              onClick={() => {
                try {
                  store.applyLayout(layout);
                  saveView(layout.split, layout.secondary || '');
                  setLayoutError('');
                } catch (error) {
                  setLayoutError((error as Error).message);
                }
              }}
            >
              应用布局
            </button>
            <button
              onClick={() => {
                const next = layouts.filter((item) => item.id !== layout.id);
                try {
                  localStorage.setItem('sakura-terminal-layouts', JSON.stringify(next));
                  setLayouts(next);
                } catch {
                  setLayoutError('无法删除布局');
                }
              }}
            >
              删除预设
            </button>
          </div>
        ))}
        <p className="muted">预设保存在此浏览器，可用于不同实例；应用时保留其他已有会话。</p>
        {layoutError && <p role="alert">{layoutError}</p>}
      </details>
      {error && (
        <p role="alert" className="machine-error">
          {error}
        </p>
      )}
      <div className={`terminal-panes ${split && second ? 'split' : ''}`}>
        {tabs.map((t) => (
          <div
            className="terminal-pane"
            id={`${id}-terminal-pane-${t.id}`}
            role="tabpanel"
            aria-labelledby={`${id}-terminal-tab-${t.id}`}
            hidden={t.id !== active && !(split && t.id === second)}
            key={t.id}
          >
            {render(t.id)}
          </div>
        ))}
      </div>
      <p className="terminal-session-note">
        双击标签重命名 · 安装项目环境中的 tmux 后，刷新页面可恢复原会话；关闭标签会结束该会话。
      </p>
      {principal?.role === 'owner' && <TerminalShareControls vmId={id} session={active}
        request={request} />}
    </div>
  );
}

function TerminalShareControls({ vmId, session, request }: {
  vmId: string; session: string; request: Request;
}) {
  const [viewers, setViewers] = useState<SharedViewer[]>([]);
  const [grants, setGrants] = useState<TerminalGrant[]>([]);
  const [viewerId, setViewerId] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    const [users, shared] = await Promise.all([
      request<{ users: SharedViewer[] }>('/access/users'),
      request<{ grants: TerminalGrant[] }>('/access/terminal-shares?vmId=' + encodeURIComponent(vmId)),
    ]);
    const eligible = users.users.filter((item) => item.role === 'viewer' &&
      item.vmIds.includes(vmId) && (item.expiresAt === null || item.expiresAt > Date.now()));
    setViewers(eligible);
    setGrants(shared.grants);
    setViewerId((current) => eligible.some((item) => item.id === current) ? current : eligible[0]?.id || '');
  };
  useEffect(() => { void refresh().catch((reason) => setError(String(reason.message || reason))); },
    [vmId]);
  return <section className="system-card" aria-label="共享终端管理">
    <h3>共享当前终端</h3>
    <p>只读账户可实时查看此 tmux 会话；输入和尺寸调整会在服务端拒绝。</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      try {
        await request('/access/terminal-shares', 'POST', { vmId, session, viewerId, minutes });
        await refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : '无法共享终端'); }
      finally { setBusy(false); }
    }}>
      <label>只读账户<select value={viewerId} disabled={busy || !viewers.length}
        onChange={(event) => setViewerId(event.target.value)}>
        {viewers.map((item) => <option key={item.id} value={item.id}>{item.username}</option>)}
      </select></label>
      <label>有效分钟<input type="number" min={1} max={480} value={minutes} disabled={busy}
        onChange={(event) => setMinutes(Number(event.target.value))} /></label>
      <button className="secondary compact" disabled={busy || !viewerId}>共享</button>
    </form>
    {!viewers.length && <p>先在“账户与只读分享”为此实例创建只读账户。</p>}
    <ul>{grants.filter((item) => item.session === session).map((item) => <li key={item.id}>
      {viewers.find((viewer) => viewer.id === item.viewerId)?.username || '已撤销账户'}
      {' · 到期 '}{new Date(item.expiresAt).toLocaleString()}
      <button className="secondary compact" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await request('/access/terminal-shares/' + item.id, 'DELETE'); await refresh(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '无法撤销共享'); }
        finally { setBusy(false); }
      }}>撤销</button>
    </li>)}</ul>
    <button className="secondary compact" disabled={busy} onClick={() => void refresh()
      .catch((reason) => setError(String(reason.message || reason)))}>刷新共享状态</button>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}
