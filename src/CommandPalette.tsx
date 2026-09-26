import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PresetRunner } from '../plugins/commands/client';
import type { CommandPreset } from '../server/command-presets';
import type { VMView } from '../server/model';
import type { ProjectFile } from '../server/project-files';
import { pluginNavigation } from './plugin-navigation';
import { Feedback, useRemote, type Request } from './feature-shared';
import { nextSelection } from './keyboard-navigation';
import { usePlugins } from './plugin-context';

export type PaletteTarget = { id?: string; page?: string; tab?: string; file?: string };
export type PaletteAction = {
  key: string;
  title: string;
  detail: string;
  keywords?: string[];
  run: () => void;
  disabled?: boolean;
};
export function CommandPalette({
  vms,
  vm,
  request,
  navigate,
  close,
  actions = [],
}: {
  vms: VMView[];
  vm?: VMView;
  request: Request;
  navigate: (target: PaletteTarget) => Promise<void>;
  close: () => void;
  actions?: PaletteAction[];
}) {
  const plugins = usePlugins();
  const dialog = useRef<HTMLDialogElement>(null),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [index, setIndex] = useState(0),
    [preset, setPreset] = useState<CommandPreset | null>(null);
  const commands = useRemote<{ presets: CommandPreset[] }>(
    request,
    `/vms/${vm?.id}/commands`,
    !!vm && plugins.includes('commands'),
    0,
  );
  const files = useRemote<{ root: string; files: ProjectFile[]; truncated: boolean }>(
    request,
    `/vms/${vm?.id}/project-files?q=${encodeURIComponent(search)}`,
    vm?.status === 'running' && !!search && plugins.includes('project-search'),
    0,
  );
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    setIndex(0);
    return () => clearTimeout(timer);
  }, [query]);
  const needle = query.trim().toLocaleLowerCase(),
    match = (value: string, values: string[] = []) =>
      [value, ...values].some((item) => item.toLocaleLowerCase().includes(needle));
  const hasWorkspaceSwitchActions = actions.some((item) => item.key.endsWith(':switch'));
  const entries: PaletteAction[] = [
    ...actions.filter((item) => match(item.title, [item.detail, ...(item.keywords || [])])),
    ...(hasWorkspaceSwitchActions
      ? []
      : vms
          .filter((item) => match(item.name, ['切换', '打开', 'switch', 'open', item.status]))
          .map((item) => ({
            key: `switch:${item.id}`,
            title: `切换到 ${item.name}`,
            detail: `工作空间 · ${item.status === 'running' ? '运行中' : item.status === 'paused' ? '已暂停' : '已停止'}`,
            keywords: ['实例', '工作空间', '切换', item.name],
            run: () => void navigate({ id: item.id, page: 'workspace' }),
          }))),
    ...pluginNavigation(plugins, 'tabs')
      .filter(({ id, label }) => vm && match(label, ['功能', 'workspace', id]))
      .map(({ id, label }) => ({
        key: `tab:${id}`,
        title: label,
        detail: vm?.name || '',
        keywords: ['功能', '打开', vm?.name || ''],
        run: () => void navigate({ tab: id, page: 'workspace' }),
      })),
    ...pluginNavigation(plugins, 'pages')
      .filter(({ id, label }) => match(label, ['全局', '导航', id]))
      .map(({ id, label }) => ({
        key: `page:${id}`,
        title: label,
        detail: '全局操作',
        keywords: ['全局', '导航', label],
        run: () => void navigate({ page: id }),
      })),
    ...(commands.data?.presets || [])
      .filter((item) => vm?.status === 'running' && match(item.name))
      .map((item) => ({
        key: `preset:${item.id}`,
        title: item.name,
        detail: '收藏命令 · 填写参数后执行',
        keywords: ['命令', '收藏', 'preset', item.name],
        run: () => setPreset(item),
      })),
    ...(search === query.trim() ? files.data?.files || [] : [])
      .filter((item) => !item.directory)
      .slice(0, 30)
      .map((item) => ({
        key: 'file:' + item.path,
        title: item.path,
        detail: '项目文件',
        keywords: ['文件', '项目', item.path],
        run: () =>
          void navigate({
            tab: 'files',
            page: 'workspace',
            file: `${files.data!.root.replace(/\/$/, '')}/${item.path}`,
          }),
      })),
  ];
  const selectable = entries.reduce<number[]>((result, entry, entryIndex) => {
    if (!entry.disabled) result.push(entryIndex);
    return result;
  }, []);
  const selectedSlot = Math.min(index, Math.max(0, selectable.length - 1));
  const chosen = selectable[selectedSlot] ?? Math.min(index, Math.max(0, entries.length - 1));
  useEffect(() => {
    document.getElementById(`palette-result-${chosen}`)?.scrollIntoView({ block: 'nearest' });
  }, [chosen]);
  return (
    <dialog
      ref={dialog}
      className="modal command-palette"
      aria-labelledby="palette-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <div>
          <h2 id="palette-title">快速前往</h2>
          <p>{vm ? `当前实例 · ${vm.name}` : '搜索实例与操作'}</p>
        </div>
        <button className="icon-button" aria-label="关闭命令面板" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="palette-body">
        {preset && vm ? (
          <>
            <button className="text-button" onClick={() => setPreset(null)}>
              ← 返回搜索
            </button>
            <PresetRunner key={preset.id} preset={preset} id={vm.id} request={request} />
          </>
        ) : (
          <>
            <div className="palette-search">
              <Search size={18} />
              <input
                autoFocus
                role="combobox"
                aria-label="搜索实例、文件或操作"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-activedescendant={entries.length ? `palette-result-${chosen}` : undefined}
                value={query}
                placeholder="实例、项目文件、操作、收藏命令…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    close();
                    return;
                  }
                  if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
                    e.preventDefault();
                    const next = nextSelection(selectedSlot, selectable.length, e.key);
                    if (next !== null) setIndex(next);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const entry = entries[chosen];
                    if (!entry?.disabled) entry?.run();
                  }
                }}
              />
            </div>
            <Feedback error={commands.error || files.error} />
            <div id="palette-results" role="listbox" aria-label="搜索结果" className="palette-results">
              {entries.map((entry, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={i === chosen}
                  id={`palette-result-${i}`}
                  key={entry.key}
                  className={i === chosen ? 'selected' : ''}
                  disabled={entry.disabled}
                  onClick={entry.run}
                >
                  <span>{entry.title}</span>
                  <small>{entry.detail}</small>
                </button>
              ))}
              {!entries.length && <p className="muted">没有匹配结果。</p>}
            </div>
            <p className="subtle-note">
              ↑ ↓ 选择 · Enter 打开 · Esc 关闭 · 文件搜索使用当前运行实例的项目目录
            </p>
          </>
        )}
      </div>
    </dialog>
  );
}
