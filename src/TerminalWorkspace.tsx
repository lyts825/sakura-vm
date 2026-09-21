import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Plus, X, Columns2 } from 'lucide-react';
import type { Request } from './FeaturePanels';
import { getTerminalStore } from './terminal-store';

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
  const { tabs, active, closing, error } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const dispatch = store.dispatch;
  const [split, setSplit] = useState(false);
  const second = tabs.find((t) => t.id !== active)?.id;
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
        <button aria-pressed={split} disabled={tabs.length < 2} onClick={() => setSplit((v) => !v)}>
          <Columns2 size={14} />
          分屏
        </button>
      </div>
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
    </div>
  );
}
