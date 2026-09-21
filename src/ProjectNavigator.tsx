import { useEffect, useState } from 'react';
import { Folder, FileText, Search, RefreshCw } from 'lucide-react';
import type { ProjectFile, SearchMatch } from '../server/project-files';
import { type Request, Feedback } from './FeaturePanels';

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
          placeholder="文件名或内容"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={content} onChange={(e) => setContent(e.target.checked)} />
        搜索文件内容
      </label>
      <Feedback error={error} />
      {busy && <p className="muted">正在搜索…</p>}
      <div className="project-tree">
        {!content &&
          data?.files
            .filter((file) => visible(file.path))
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((file) => (
              <button
                className="tree-entry"
                key={file.path}
                style={{ paddingLeft: query ? 8 : 8 + (file.path.split('/').length - 1) * 14 }}
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
          data?.matches.map((match) => (
            <button
              className="search-match"
              key={`${match.path}:${match.line}`}
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
