import { FileText, Folder, RefreshCw, Search } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectFile, SearchMatch } from '../server/project-files';
import { Feedback, type Request } from './feature-shared';
import { nextSelection } from './keyboard-navigation';

export function ProjectNavigator({
  id,
  request,
  open,
}: {
  id: string;
  request: Request;
  open: (path: string, line?: number) => void;
}) {
  const [query, setQuery] = useState(''),
    [content, setContent] = useState(false),
    [expanded, setExpanded] = useState(new Set<string>()),
    [revision, setRevision] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{
      root: string;
      files: ProjectFile[];
      matches: SearchMatch[];
      truncated: boolean;
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(
      () => {
        if (content && !query.trim()) {
          setData(null);
          setBusy(false);
          setError('');
          return;
        }
        setBusy(true);
        request(
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
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [id, request, query, content, revision]);
  const visible = (path: string) =>
    query ||
    path
      .split('/')
      .slice(0, -1)
      .every((_segment, index, parts) => expanded.has(parts.slice(0, index + 1).join('/')));
  const openFile = (path: string, line?: number) =>
    data && open(`${data.root.replace(/\/$/, '')}/${path}`, line);
  const files = !content
    ? (data?.files || []).filter((file) => visible(file.path)).sort((a, b) => a.path.localeCompare(b.path))
    : [];
  const focusTreeEntry = (index: number, key: string) => {
    const entries = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>('[data-project-entry]') || [],
    );
    const next = nextSelection(index, entries.length, key);
    if (next !== null) entries[next]?.focus();
  };
  const onTreeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, file: ProjectFile) => {
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
          onClick={() => setRevision((current) => current + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <label>
        <Search size={14} />
        <input
          aria-label="搜索项目"
          aria-controls="project-tree"
          placeholder="文件名或内容"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(event) => {
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
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} />
        搜索文件内容
      </label>
      <Feedback error={error} />
      {busy && <p className="muted">正在搜索…</p>}
      <div
        ref={treeRef}
        id="project-tree"
        className="project-tree"
        role={content ? 'listbox' : 'tree'}
        aria-label={content ? '项目内容搜索结果' : '项目文件'}
      >
        {!content &&
          files.map((file, index) => (
            <button
              type="button"
              role="treeitem"
              data-project-entry
              data-project-path={file.path}
              aria-level={file.path.split('/').length}
              aria-expanded={file.directory ? expanded.has(file.path) : undefined}
              className="tree-entry"
              key={file.path}
              style={{ paddingLeft: query ? 8 : 8 + (file.path.split('/').length - 1) * 14 }}
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
              {file.directory ? <Folder size={14} /> : <FileText size={14} />}
              <span>{query ? file.path : file.path.split('/').at(-1)}</span>
            </button>
          ))}
        {content &&
          data?.matches.map((match, index) => (
            <button
              type="button"
              role="option"
              data-project-entry
              data-project-path={match.path}
              className="search-match"
              key={`${match.path}:${match.line}`}
              onKeyDown={(event) => {
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  focusTreeEntry(index, event.key);
                }
              }}
              onClick={() => openFile(match.path, match.line)}
            >
              <b>
                {match.path}:{match.line}
              </b>
              <small>{match.text}</small>
            </button>
          ))}
      </div>
      {data?.truncated && <p className="subtle-note">结果已达上限，请缩小搜索范围。</p>}
      <p className="subtle-note">跳过依赖、构建目录和符号链接。内容搜索限 1 MiB 内的文本文件。</p>
    </aside>
  );
}
