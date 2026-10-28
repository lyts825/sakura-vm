/**
 * 模块职责（中文）：呈现当前实例的项目导航，协调项目切换、创建与列表刷新。
 * Module responsibility (English): Providing a project file tree, keyboard navigation and file-opening actions.
 * 详细范围（中文）：公开入口包括 ProjectNavigator；职责覆盖提供项目文件树、键盘导航与文件打开入口，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ProjectNavigator. The scope covers Providing a project file tree, keyboard navigation and file-opening actions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { ChevronRight, FileText, Folder, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectFile, SearchMatch } from '../server/project-files';
import { Feedback, type Request } from './feature-shared';
import { nextSelection } from './keyboard-navigation';
import './project-navigator.css';

/**
 * 中文：呈现提供项目文件树、键盘导航与文件打开入口中的 ProjectNavigator 界面，组合 RefreshCw、Search，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ProjectNavigator surface for Providing a project file tree, keyboard navigation and file-opening actions and composing RefreshCw, Search. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  id,
  request,
  open,
} 提供 id（目标资源标识）、request（带身份和权限作用域的传输能力）、open（open 状态） 上下文字段
 * English: Inputs: {
  id,
  request,
  open,
} provides context fields id (target resource identifier), request (transport capability bound to identity/authority scope), open (open state)
 */
export function ProjectNavigator({
  id,
  request,
  open,
}: {
  id: string;
  request: Request;
  open: /** 中文：把选中文件路径交给文件编辑器入口；这是 ProjectNavigator 的调用契约 | English: Pass the selected file path to the file-editor entry point; this is the callable contract of ProjectNavigator | 中文：输入：path：目标文件或请求路径；line：签名所示 number 业务值 | English: Inputs: path: target file/request path; line: the number domain value in the signature | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (path: string, line?: number) => void;
}) {
  const [query, setQuery] = useState(''),
    [content, setContent] = useState(false),
    [expanded, setExpanded] = useState(new Set<string>()),
    [activeEntry, setActiveEntry] = useState(''),
    [revision, setRevision] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<{
      root: string;
      files: ProjectFile[];
      matches: SearchMatch[];
      truncated: boolean;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true);
  useEffect(/** 中文：读取 GET /vms/{id}/project-files?q={encodeURIComponent(query)}&content={content ? 1 : 0}，完成提供项目文件树、键盘导航与文件打开入口的数据交互并更新timeout 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform GET /vms/{id}/project-files?q={encodeURIComponent(query)}&content={content ? 1 : 0} for Providing a project file tree, keyboard navigation and file-opening actions and update timeout state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const abort = new AbortController();
    setBusy(!(content && !query.trim()));
    setError('');
    const timer = setTimeout(
      /**
       * 中文：读取 GET /vms/{id}/project-files?q={encodeURIComponent(query)}&content={content ? 1 : 0}，完成提供项目文件树、键盘导航与文件打开入口的数据交互并更新远端数据、忙碌标记、错误反馈；异步失败传给此处的捕获分支或外层动作反馈
       * English: Perform GET /vms/{id}/project-files?q={encodeURIComponent(query)}&content={content ? 1 : 0} for Providing a project file tree, keyboard navigation and file-opening actions and update remote data, busy flag, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback
       * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
       * English: Result: deliver through the described state/resource effects without returning business data
       */
      () => {
        if (content && !query.trim()) {
          setData(null);
          setBusy(false);
          setError('');
          return;
        }
        setBusy(true);
        request<NonNullable<typeof data>>(
          `/vms/${id}/project-files?q=${encodeURIComponent(query)}&content=${content ? 1 : 0}`,
          'GET',
          undefined,
          abort.signal,
        )
          .then((value) => {
            if (!abort.signal.aborted) {
              setData(value);
              setError('');
            }
          })
          .catch((e: Error) => {
            if (!abort.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!abort.signal.aborted) setBusy(false);
          });
      },
      query ? 300 : 0,
    );
    /**
     * 中文：在提供项目文件树、键盘导航与文件打开入口流程中取消延迟计时任务，取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Providing a project file tree, keyboard navigation and file-opening actions, cancel delayed timers, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [id, request, query, content, revision]);
  /**
   * 中文：根据  判断提供项目文件树、键盘导航与文件打开入口中的输入或条目是否符合条件，返回布尔判断供调用者筛选/保护分支
   * English: Evaluate  to test inputs/entries in Providing a project file tree, keyboard navigation and file-opening actions, returning a boolean for filtering/guard branches
   * 中文：输入：path：目标文件或请求路径
   * English: Inputs: path: target file/request path
   */
  const visible = (path: string) =>
    query ||
    path
      .split('/')
      .slice(0, -1)
      .every((_segment, index, parts) => expanded.has(parts.slice(0, index + 1).join('/')));
  /**
   * 中文：仅在项目树已加载时把相对路径接到根目录，并将可选行号交给编辑器打开入口。
   * English: Join a relative path to the root only after the project tree is loaded, forwarding the optional line number to the editor opening entry.
   * 中文：输入：path：目标文件或请求路径；line：签名所示 number 业务值
   * English: Inputs: path: target file/request path; line: the number domain value in the signature
   */
  const openFile = (path: string, line?: number) =>
    data && open(`${data.root.replace(/\/$/, '')}/${path}`, line);
  const files = !content
    ? (data?.files || []).filter((file) => visible(file.path)).sort((a, b) => a.path.localeCompare(b.path))
    : [];
  const needsQuery = content && !query.trim();
  const showResults = !!data && !busy && !error && !needsQuery;
  const resultCount = content ? data?.matches.length || 0 : data?.files.length || 0;
  const entryKeys = content
    ? (data?.matches || []).map((match) => `match:${match.path}:${match.line}`)
    : files.map((file) => `file:${file.path}`);
  const tabEntry = entryKeys.includes(activeEntry) ? activeEntry : entryKeys[0];
  const clearSearch = () => {
    setQuery('');
    searchRef.current?.focus();
  };
  /**
   * 中文：在提供项目文件树、键盘导航与文件打开入口流程中把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Providing a project file tree, keyboard navigation and file-opening actions, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：index：签名所示 number 业务值；key：签名所示 string 业务值
   * English: Inputs: index: the number domain value in the signature; key: the string domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const focusTreeEntry = (index: number, key: string) => {
    const entries = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>('[data-project-entry]') || [],
    );
    const next = nextSelection(index, entries.length, key);
    if (next !== null) entries[next]?.focus();
  };
  /**
   * 中文：在提供项目文件树、键盘导航与文件打开入口流程中expanded 状态，阻止浏览器默认行为，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Providing a project file tree, keyboard navigation and file-opening actions, expanded state, prevent browser default behavior, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：event：触发本处理器的事件及其数据；index：签名所示 number 业务值；file：当前上传或处理的文件
   * English: Inputs: event: triggering event and its data; index: the number domain value in the signature; file: file being uploaded/processed
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const onTreeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, file: ProjectFile) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const directory = file.directory;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      focusTreeEntry(index, event.key);
      return;
    }
    if (event.key === 'ArrowRight' && directory) {
      event.preventDefault();
      if (!expanded.has(file.path)) {
        setExpanded((current) => new Set(current).add(file.path));
        return;
      }
      const entries = Array.from(
        treeRef.current?.querySelectorAll<HTMLButtonElement>('[data-project-entry]') || [],
      );
      const child = entries.findIndex((entry) => entry.dataset.projectPath?.startsWith(`${file.path}/`));
      if (child >= 0) entries[child]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (directory && expanded.has(file.path)) {
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(file.path);
          return next;
        });
        return;
      }
      const parent = file.path.split('/').slice(0, -1).join('/');
      const entries = Array.from(
        treeRef.current?.querySelectorAll<HTMLButtonElement>('[data-project-entry]') || [],
      );
      entries.find((entry) => entry.dataset.projectPath === parent)?.focus();
    }
  };
  return (
    <aside className="project-navigator" aria-label="项目文件树">
      <div className="panel-heading">
        <h4>项目文件</h4>
        <button
          className="icon-button"
          aria-label="刷新项目文件树"
          title="刷新项目文件树"
          disabled={busy}
          onClick={() => setRevision((current) => current + 1)}
        >
          <RefreshCw size={14} className={busy ? 'spin' : ''} />
        </button>
      </div>
      <label className="project-search-field">
        <Search size={14} />
        <input
          ref={searchRef}
          type="search"
          aria-label="搜索项目"
          aria-controls="project-tree"
          placeholder={content ? '搜索文件内容…' : '按文件名查找…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={/**
           * 中文功能：在查询框处理 Escape 清空搜索和 ArrowDown 聚焦第一个项目条目，仅在实际处理时阻止默认键盘行为。
           * English: Handle Escape to clear search and ArrowDown to focus the first project entry, preventing default keyboard behavior only when handled.
           * 输入 / Inputs: event.
           * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
           * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
           */
          (event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Escape' && query) {
              event.preventDefault();
              setQuery('');
            }
            if (event.key === 'ArrowDown') {
              const first = treeRef.current?.querySelector<HTMLButtonElement>('[data-project-entry]');
              if (first) {
                event.preventDefault();
                first.focus();
              }
            }
          }}
        />
        {query && <button type="button" aria-label="清空项目搜索" title="清空项目搜索" onClick={clearSearch}>
          <X size={14} aria-hidden="true" />
        </button>}
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} />
        搜索文件内容
      </label>
      <Feedback error={error} />
      {error && <button className="secondary compact" onClick={() => setRevision((current) => current + 1)}>重新读取项目文件</button>}
      <div className="project-result-summary" role="status" aria-live="polite" aria-atomic="true">
        {busy ? <><LoaderCircle size={14} className="spin" aria-hidden="true" />{query.trim() ? '正在搜索…' : '正在读取项目文件…'}</>
          : showResults ? <span>{content ? `${resultCount} 处内容匹配` : `共 ${resultCount} 项文件与目录`}</span> : null}
      </div>
      <div
        ref={treeRef}
        id="project-tree"
        className="project-tree"
        role={content ? 'listbox' : 'tree'}
        aria-label={content ? '项目内容搜索结果' : '项目文件'}
        aria-busy={busy}
      >
        {showResults && !content &&
          files.map((file, index) => (
            <button
              type="button"
              role="treeitem"
              data-project-entry
              data-project-path={file.path}
              aria-level={file.path.split('/').length}
              aria-expanded={file.directory ? expanded.has(file.path) : undefined}
              aria-label={file.path}
              aria-selected={tabEntry === `file:${file.path}`}
              tabIndex={tabEntry === `file:${file.path}` ? 0 : -1}
              className="tree-entry"
              key={file.path}
              style={{ paddingLeft: query ? 8 : 8 + Math.min(file.path.split('/').length - 1, 3) * 12 }}
              onFocus={() => setActiveEntry(`file:${file.path}`)}
              onKeyDown={(event) => onTreeKeyDown(event, index, file)}
              onClick={() =>
                file.directory
                  ? setExpanded((current) => {
                      const next = new Set(current);
                      next.has(file.path) ? next.delete(file.path) : next.add(file.path);
                      return next;
                    })
                  : openFile(file.path)
              }
              title={file.path}
            >
              {file.directory ? <ChevronRight size={12} className="project-directory-chevron" aria-hidden="true" />
                : <span className="project-entry-spacer" aria-hidden="true" />}
              {file.directory ? <Folder size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
              <span className="project-entry-label">
                <span className="project-entry-name">{file.path.split('/').at(-1)}</span>
                {query && file.path.includes('/') && <small className="project-entry-path">{file.path.split('/').slice(0, -1).join('/')}</small>}
              </span>
            </button>
          ))}
        {showResults && content &&
          data?.matches.map((match, index) => (
            <button
              type="button"
              role="option"
              data-project-entry
              data-project-path={match.path}
              aria-label={`${match.path}，第 ${match.line} 行`}
              aria-selected={tabEntry === `match:${match.path}:${match.line}`}
              tabIndex={tabEntry === `match:${match.path}:${match.line}` ? 0 : -1}
              className="search-match"
              key={`${match.path}:${match.line}`}
              title={`${match.path}:${match.line}`}
              onFocus={() => setActiveEntry(`match:${match.path}:${match.line}`)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  focusTreeEntry(index, event.key);
                }
              }}
              onClick={() => openFile(match.path, match.line)}
            >
              <span className="project-match-heading">
                <b className="project-entry-name">{match.path.split('/').at(-1)}</b>
                <span className="project-match-line">第 {match.line} 行</span>
              </span>
              <small className="project-entry-path">{match.path.split('/').slice(0, -1).join('/') || '项目根目录'}</small>
              <small className="project-match-snippet">{match.text}</small>
            </button>
          ))}
      </div>
      {!busy && !error && (needsQuery || (showResults && resultCount === 0)) && (
        <div className="project-empty">
          {needsQuery || query ? <Search size={24} aria-hidden="true" /> : <Folder size={24} aria-hidden="true" />}
          <strong>{needsQuery ? '输入关键词，查找文件内容' : query ? '没有找到匹配结果' : '项目目录为空'}</strong>
          <p>{needsQuery ? '输入文本后开始搜索，也可以返回文件列表。'
            : query ? '试试其他关键词，或清除搜索后重新查找。' : '添加文件后，刷新列表即可查看。'}</p>
          {needsQuery ? <button className="text-button" onClick={() => {
            setContent(false);
            searchRef.current?.focus();
          }}>查看文件列表</button> : query ? <button className="text-button" onClick={clearSearch}>清除搜索</button> : null}
        </div>
      )}
      {showResults && data?.truncated && <p className="subtle-note">结果已达上限，请缩小搜索范围。</p>}
      <p className="subtle-note">跳过依赖、构建目录和符号链接。内容搜索限 1 MiB 内的文本文件。</p>
    </aside>
  );
}
