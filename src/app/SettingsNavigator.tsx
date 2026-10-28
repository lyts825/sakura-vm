/** 读取已呈现的设置标题，让定位入口随可用卡片和界面语言更新。
 * Read rendered setting titles so navigation follows available cards and localized labels. */
import { Search, ArrowDownRight, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import './settings-navigator.css';

export function SettingsNavigator({ grid }: { grid: RefObject<HTMLDivElement | null> }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Array<{ label: string; element: HTMLElement }>>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const root = grid.current;
    if (!root) return;
    const collect = () => {
      const next = Array.from(root.children).flatMap(node => {
        if (!(node instanceof HTMLElement) || !node.classList.contains('system-card')) return [];
        const label = node.querySelector('h2, h3')?.textContent?.trim();
        return label ? [{ label, element: node }] : [];
      });
      setItems(current => current.length === next.length && current.every((item, index) =>
        item.label === next[index].label && item.element === next[index].element) ? current : next);
    };
    collect();
    const observer = new MutationObserver(collect);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [grid]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = items.filter(item => item.label.toLocaleLowerCase().includes(needle));
  const clear = () => { setQuery(''); input.current?.focus(); };
  return <section className="settings-navigator" aria-label="设置快速定位">
    <div className="settings-search">
      <Search size={17} aria-hidden="true" />
      <input ref={input} type="search" aria-label="快速查找设置" placeholder="查找设置，例如：剪贴板、锁定、语言…"
        value={query} aria-controls="settings-search-results" onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); clear(); }
        }} />
      {query && <button type="button" aria-label="清空设置搜索" title="清空设置搜索" onClick={clear}><X size={16} /></button>}
    </div>
    <p className="settings-search-summary" role="status">{needle ? `找到 ${matches.length} 项设置` : `${items.length} 项设置 · 输入名称快速前往`}</p>
    <div id="settings-search-results" className="settings-search-results">
      {needle && matches.map((item, index) => <button key={`${item.label}-${index}`} type="button" onClick={() => {
        if (!item.element.isConnected) return;
        item.element.tabIndex = -1;
        setQuery('');
        requestAnimationFrame(() => {
          if (!item.element.isConnected) return;
          item.element.scrollIntoView({ block: 'start', behavior: 'instant' });
          item.element.focus({ preventScroll: true });
        });
      }}><span>{item.label}</span><ArrowDownRight size={16} aria-hidden="true" /></button>)}
      {needle && !matches.length && <div className="settings-search-empty">
        <p>没有找到匹配的设置，试试更短的名称。</p><button type="button" onClick={clear}>清空搜索</button>
      </div>}
    </div>
  </section>;
}
