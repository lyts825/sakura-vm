import { useEffect, useState, type ReactNode } from 'react';
import { Plus, X, Columns2 } from 'lucide-react';
import type { Request } from './FeaturePanels';

type Tab = { id: string; name: string };
export function TerminalWorkspace({
  id,
  request,
  render,
}: {
  id: string;
  request: Request;
  render: (session: string) => ReactNode;
}) {
  const [tabs, setTabs] = useState<Tab[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`sakura-terminals-${id}`) || 'null');
      if (
        Array.isArray(saved) &&
        saved.length > 0 &&
        saved.length <= 8 &&
        saved.every((t) => /^[a-z0-9-]{1,48}$/.test(t.id) && typeof t.name === 'string')
      )
        return saved;
    } catch {}
    return [{ id: 'main', name: '终端 1' }];
  });
  const [active, setActive] = useState(tabs[0].id),
    [split, setSplit] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(`sakura-terminals-${id}`, JSON.stringify(tabs));
    } catch {}
  }, [tabs, id]);
  const second = tabs.find((t) => t.id !== active)?.id;
  return (
    <div className="terminal-workspace">
      <div className="terminal-tabs" role="tablist" aria-label="终端会话">
        {tabs.map((t) => (
          <div className={`terminal-tab ${t.id === active ? 'active' : ''}`} key={t.id}>
            <button
              role="tab"
              aria-selected={t.id === active}
              onClick={() => setActive(t.id)}
              onDoubleClick={() => {
                const name = prompt('终端名称', t.name);
                if (name?.trim())
                  setTabs((list) => list.map((n) => (n.id === t.id ? { ...n, name: name.slice(0, 32) } : n)));
              }}
            >
              {t.name}
            </button>
            {tabs.length > 1 && (
              <button
                aria-label={`关闭 ${t.name}`}
                onClick={async () => {
                  try {
                    await request(`/vms/${id}/terminal-session`, 'POST', { session: t.id });
                    setTabs((list) => list.filter((n) => n.id !== t.id));
                    if (active === t.id) setActive(tabs.find((n) => n.id !== t.id)!.id);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
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
            const session = crypto.randomUUID();
            setTabs((list) => [...list, { id: session, name: `终端 ${list.length + 1}` }]);
            setActive(session);
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
          <div className="terminal-pane" hidden={t.id !== active && !(split && t.id === second)} key={t.id}>
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
