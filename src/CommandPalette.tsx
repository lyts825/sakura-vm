/**
 * 模块职责（中文）：组合实例切换、工作区导航、项目命令和文件搜索，提供键盘驱动的命令面板。
 * Module responsibility (English): Providing navigation, project commands and file search for enabled capabilities.
 * 详细范围（中文）：公开入口包括 PaletteTarget, PaletteAction, CommandPalette；职责覆盖按启用能力提供导航、项目命令与文件搜索，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PaletteTarget, PaletteAction, CommandPalette. The scope covers Providing navigation, project commands and file search for enabled capabilities. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PresetRunner } from '../plugins/commands/client';
import type { CommandPreset } from '../server/command-presets';
import type { VMView } from '../shared/contracts/vm.ts';
import type { ProjectFile } from '../server/project-files';
import { pluginNavigation } from './plugin-navigation';
import { Feedback, useRemote, type Request } from './feature-shared';
import { nextSelection } from './keyboard-navigation';
import { usePlugins } from './plugin-context';
import './command-palette.css';

export type PaletteTarget = { id?: string; page?: string; tab?: string; file?: string };
export type PaletteAction = {
  key: string;
  title: string;
  detail: string;
  keywords?: string[];
  run: /** 中文：执行本命令条目绑定的动作，入口决定导航或远端执行；这是 PaletteAction 的调用契约 | English: Execute the action bound to this command entry, whose entry point chooses navigation/remote work; this is the callable contract of PaletteAction | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  disabled?: boolean;
};
/**
 * 中文：呈现按启用能力提供导航、项目命令与文件搜索中的 CommandPalette 界面，订阅 /vms/{vm?.id}/commands、/vms/{vm?.id}/project-files?q={encodeURIComponent(search)}，组合 X、PresetRunner、Search，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the CommandPalette surface for Providing navigation, project commands and file search for enabled capabilities, subscribing to /vms/{vm?.id}/commands, /vms/{vm?.id}/project-files?q={encodeURIComponent(search)} and composing X, PresetRunner, Search. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vms,
  vm,
  request,
  navigate,
  close,
  actions = [],
} 提供 vms（vms 状态）、vm（vm 状态）、request（带身份和权限作用域的传输能力）、navigate（navigate 状态）、close（close 状态）、actions（actions 状态） 上下文字段
 * English: Inputs: {
  vms,
  vm,
  request,
  navigate,
  close,
  actions = [],
} provides context fields vms (vms state), vm (vm state), request (transport capability bound to identity/authority scope), navigate (navigate state), close (close state), actions (actions state)
 */
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
  navigate: /** 中文：把实例、项目、页面、分区或文件目标交给外层导航；这是 CommandPalette 的调用契约 | English: Deliver VM/project/page/tab/file targets to outer navigation; this is the callable contract of CommandPalette | 中文：输入：target：事件目标或操作目标 | English: Inputs: target: event/operation target | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (target: PaletteTarget) => Promise<void>;
  close: /** 中文：请求关闭当前界面，实际导航或卸载由父级决定；这是 CommandPalette 的调用契约 | English: Request surface closure, leaving actual navigation/unmounting to the parent; this is the callable contract of CommandPalette | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
  actions?: PaletteAction[];
}) {
  const plugins = usePlugins();
  const dialog = useRef<HTMLDialogElement>(null),
    searchInput = useRef<HTMLInputElement>(null),
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
  useEffect(/** 中文：当依赖 [] 变化时打开原生模态对话框，把输入焦点移到目标元素；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, open a native modal dialog, move input focus to the target. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    /**
     * 中文：在按启用能力提供导航、项目命令与文件搜索流程中关闭所属连接或存储对象，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Providing navigation, project commands and file search for enabled capabilities, close the owned connection/storage object, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(/** 中文：当依赖 [query] 变化时timeout 状态，index 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [query] change, timeout state, index state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    setIndex(0);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!preset) searchInput.current?.focus();
  }, [preset]);
  const needle = query.trim().toLocaleLowerCase(),
    /**
     * 中文：按区域小写匹配名称及别名中是否包含当前搜索词，任一命中即可保留命令。
     * English: Match the current search term against locale-lowercased names/aliases, retaining a command on any match.
     * 中文：输入：value：待校验、转换或保存的输入值；values：签名所示 string[] 业务值（缺省 []）
     * English: Inputs: value: input value to validate/transform/save; values: the string[] domain value in the signature (default [])
     */
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
            /**
             * 中文：执行当前搜索条目绑定的入口：实例、分区和页面交给 navigate，预设进入执行选择，文件结果补全根路径后打开文件分区；目标来自本条目的闭包。
             * English: Execute the entry bound to this search item: delegate VM/tab/page navigation, select presets for execution, or complete a file's root path and open the files tab. The item's closure owns the target.
             */
            run: () => void navigate({ id: item.id, page: 'workspace' }),
          }))),
    ...pluginNavigation(plugins, 'tabs')
      .filter(({ id, label }) => vm && match(label, ['功能', 'workspace', id]))
      .map(({ id, label }) => ({
        key: `tab:${id}`,
        title: label,
        detail: vm?.name || '',
        keywords: ['功能', '打开', vm?.name || ''],
        /**
         * 中文：执行当前搜索条目绑定的入口：实例、分区和页面交给 navigate，预设进入执行选择，文件结果补全根路径后打开文件分区；目标来自本条目的闭包。
         * English: Execute the entry bound to this search item: delegate VM/tab/page navigation, select presets for execution, or complete a file's root path and open the files tab. The item's closure owns the target.
         */
        run: () => void navigate({ tab: id, page: 'workspace' }),
      })),
    ...pluginNavigation(plugins, 'pages')
      .filter(({ id, label }) => match(label, ['全局', '导航', id]))
      .map(({ id, label }) => ({
        key: `page:${id}`,
        title: label,
        detail: '全局操作',
        keywords: ['全局', '导航', label],
        /**
         * 中文：执行当前搜索条目绑定的入口：实例、分区和页面交给 navigate，预设进入执行选择，文件结果补全根路径后打开文件分区；目标来自本条目的闭包。
         * English: Execute the entry bound to this search item: delegate VM/tab/page navigation, select presets for execution, or complete a file's root path and open the files tab. The item's closure owns the target.
         */
        run: () => void navigate({ page: id }),
      })),
    ...(commands.data?.presets || [])
      .filter((item) => vm?.status === 'running' && match(item.name))
      .map((item) => ({
        key: `preset:${item.id}`,
        title: item.name,
        detail: '收藏命令 · 填写参数后执行',
        keywords: ['命令', '收藏', 'preset', item.name],
        /**
         * 中文：执行当前搜索条目绑定的入口：实例、分区和页面交给 navigate，预设进入执行选择，文件结果补全根路径后打开文件分区；目标来自本条目的闭包。
         * English: Execute the entry bound to this search item: delegate VM/tab/page navigation, select presets for execution, or complete a file's root path and open the files tab. The item's closure owns the target.
         */
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
        /**
         * 中文：执行当前搜索条目绑定的入口：实例、分区和页面交给 navigate，预设进入执行选择，文件结果补全根路径后打开文件分区；目标来自本条目的闭包。
         * English: Execute the entry bound to this search item: delegate VM/tab/page navigation, select presets for execution, or complete a file's root path and open the files tab. The item's closure owns the target.
         */
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
  const chosen = selectable[selectedSlot];
  // Keep the action order intact while exposing its scope in the result list.
  const groups = entries.reduce<Array<{ label: string; start: number; entries: PaletteAction[] }>>((result, entry, start) => {
    const label = entry.key.startsWith('switch:') || entry.key.endsWith(':switch') ? '切换工作空间'
      : entry.key.startsWith('tab:') ? '当前实例功能'
      : entry.key.startsWith('page:') ? '全局导航'
      : entry.key.startsWith('preset:') ? '收藏命令'
      : entry.key.startsWith('file:') ? '项目文件' : '空间操作';
    const previous = result.at(-1);
    if (previous?.label === label) previous.entries.push(entry);
    else result.push({ label, start, entries: [entry] });
    return result;
  }, []);
  const filesPending = plugins.includes('project-search') && vm?.status === 'running' && !!query.trim() &&
    (search !== query.trim() || (!files.data && !files.error));
  const commandsPending = plugins.includes('commands') && vm?.status === 'running' && !commands.data && !commands.error;
  const filesTruncated = search === query.trim() && (files.data?.truncated || (files.data?.files.filter(item => !item.directory).length || 0) > 30);
  useEffect(/** 中文：当依赖 [chosen] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [chosen] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (chosen !== undefined) document.getElementById(`palette-result-${chosen}`)?.scrollIntoView({ block: 'nearest' });
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
      <div className={`palette-body${preset ? ' palette-preset-body' : ''}`}>
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
                ref={searchInput}
                autoFocus
                role="combobox"
                aria-label="搜索实例、文件或操作"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-activedescendant={chosen !== undefined ? `palette-result-${chosen}` : undefined}
                aria-describedby="palette-keyboard-hint"
                value={query}
                placeholder="实例、项目文件、操作、收藏命令…"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={/**
                 * 中文功能：处理 Escape 关闭、上下键循环选择及 Enter 执行，阻止对应浏览器默认动作并跳过禁用条目。
                 * English: Handle Escape closure, up/down selection and Enter execution, prevent matching browser defaults and skip disabled entries.
                 * 输入 / Inputs: e.
                 * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
                 * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
                 */
                (e) => {
                  // IME confirmation and candidate navigation belong to the input method.
                  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
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
                    const entry = chosen === undefined ? undefined : entries[chosen];
                    if (!entry?.disabled) entry?.run();
                  }
                }}
              />
              {query && <button className="palette-clear" type="button" aria-label="清空搜索" title="清空搜索"
                onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X size={16} /></button>}
            </div>
            <Feedback error={commands.error || files.error} />
            <div className="palette-result-summary" role="status" aria-live="polite">
              <span>{entries.length} 个结果</span>
              <span>{filesPending ? '正在搜索项目文件…' : commandsPending ? '正在读取收藏命令…' : filesTruncated ? '文件结果较多，请缩小搜索范围。' : ''}</span>
            </div>
            <div id="palette-results" role="listbox" tabIndex={-1} aria-label="搜索结果" className="palette-results">
              {groups.map(group => <div className="palette-result-group" role="group" aria-label={group.label} key={`${group.label}-${group.start}`}>
                <div className="palette-group-label" aria-hidden="true">{group.label}<span>{group.entries.length}</span></div>
                {group.entries.map((entry, offset) => {
                  const i = group.start + offset;
                  return (
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
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
                  );
                })}
              </div>)}
            </div>
            {!entries.length && !filesPending && !commandsPending && <div className="palette-empty" role="status">
              <Search size={26} aria-hidden="true" />
              <strong>没有匹配结果</strong>
              <p>试试更短的关键词，或清空搜索查看可用操作。</p>
              <button className="secondary compact" type="button" onClick={() => { setQuery(''); searchInput.current?.focus(); }}>查看全部操作</button>
            </div>}
            <div className="palette-hints">
              <p id="palette-keyboard-hint"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></p>
              {plugins.includes('project-search') && <p>{vm?.status === 'running' ? '文件搜索范围：当前实例的项目目录' : '启动当前实例后可搜索项目文件'}</p>}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
