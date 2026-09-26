import { Columns2, Plus, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Request } from './feature-shared';
import { getTerminalStore } from './terminal-store';
import { restoreLayouts } from './terminal-layouts';

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
    </div>
  );
}
