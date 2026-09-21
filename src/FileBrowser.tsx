import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Download, FileText, Folder, Plus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react';
import { Feedback, download, useAction, type FeatureProps } from './FeaturePanels';
import { uploadFiles, transferBytes, type UploadProgress } from './transfers';
import { completeFileSave, dirtyEdit, registerEditorGuard, type FileEdit } from './file-editor-state';

type Entry = { name: string; size: number; directory: boolean; symlink: boolean; modified: number };
function DraftDialog({
  kind,
  choose,
}: {
  kind: 'leave' | 'replace' | 'discard';
  choose: (allowed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="draft-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        choose(false);
      }}
    >
      <div className="modal-head">
        <h3 id="draft-dialog-title">有未保存的修改</h3>
      </div>
      <div className="content-panel">
        <p>
          {kind === 'leave'
            ? '离开后，草稿仍会保留在本机浏览器，返回文件面板可继续编辑。'
            : kind === 'replace'
              ? '打开另一个文件会替换当前草稿，请先保存需要保留的内容。'
              : '关闭编辑器会放弃当前草稿。'}
        </p>
      </div>
      <div className="modal-footer">
        <button className="secondary" autoFocus onClick={() => choose(false)}>
          继续编辑
        </button>
        <button className="primary" onClick={() => choose(true)}>
          {kind === 'leave' ? '保留草稿并离开' : '放弃草稿并继续'}
        </button>
      </div>
    </dialog>
  );
}
export function FileBrowser({ vm, request, token }: FeatureProps) {
  const [path, setPath] = useState('/workspace'),
    [input, setInput] = useState('/workspace');
  const [files, setFiles] = useState<Entry[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const draftKey = `sakura-draft:${vm.id}`;
  const [edit, setEdit] = useState<FileEdit | null>(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
      return draft && typeof draft.path === 'string' && typeof draft.content === 'string' ? draft : null;
    } catch {
      return null;
    }
  });
  const [draftError, setDraftError] = useState(''),
    [conflict, setConflict] = useState<{ content: string; version: string } | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  const [leaveKind, setLeaveKind] = useState<'leave' | 'replace' | 'discard' | null>(null);
  const pendingLeave = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(
    null,
  );
  const leave = (kind: 'leave' | 'replace' | 'discard' = 'leave') => {
    if (!dirtyEdit(editRef.current)) return Promise.resolve(true);
    if (pendingLeave.current) return pendingLeave.current.promise;
    let resolve!: (allowed: boolean) => void;
    const promise = new Promise<boolean>((done) => {
      resolve = done;
    });
    pendingLeave.current = { promise, resolve };
    setLeaveKind(kind);
    return promise;
  };
  const chooseLeave = (allowed: boolean) => {
    pendingLeave.current?.resolve(allowed);
    pendingLeave.current = null;
    setLeaveKind(null);
  };
  const draftDialog = leaveKind ? <DraftDialog kind={leaveKind} choose={chooseLeave} /> : null;
  useEffect(() => registerEditorGuard(leave), []);
  useEffect(() => () => pendingLeave.current?.resolve(false), []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirtyEdit(editRef.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  useEffect(() => {
    try {
      if (edit) localStorage.setItem(draftKey, JSON.stringify(edit));
      else localStorage.removeItem(draftKey);
      setDraftError('');
    } catch {
      setDraftError('浏览器无法保存草稿，请及时保存文件。');
    }
  }, [edit, draftKey]);
  const [overwrite, setOverwrite] = useState(false),
    [progress, setProgress] = useState<UploadProgress | null>(null),
    [dragging, setDragging] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    transfer = useRef<AbortController | null>(null),
    alive = useRef(true);
  const action = useAction();
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (vm.status !== 'running') {
      setFiles([]);
      setLoading(false);
      transfer.current?.abort();
      return;
    }
    setLoading(true);
    try {
      const values = await request<Entry[]>(`/vms/${vm.id}/files?path=${encodeURIComponent(path)}`);
      if (version === requestVersion.current) {
        setFiles(values);
        setError('');
      }
    } catch (e) {
      if (version === requestVersion.current) {
        setFiles([]);
        setError((e as Error).message);
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [vm.id, vm.status, path, request]);
  useEffect(() => {
    void refresh();
    return () => {
      requestVersion.current++;
    };
  }, [refresh]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      transfer.current?.abort();
    };
  }, []);
  const target = (name: string) => `${path.replace(/\/$/, '')}/${name}`;
  const navigate = async (next: string) => {
    if (!(await leave())) return;
    requestVersion.current++;
    setFiles([]);
    setError('');
    setLoading(true);
    setPath(next);
    setInput(next);
    if (next === path) void refresh();
  };
  const operation = (kind: string, filePath: string, destination?: string, recursive = false) =>
    action.run(async () => {
      await request(`/vms/${vm.id}/file-operation`, 'POST', {
        action: kind,
        path: filePath,
        destination,
        recursive,
      });
      await refresh();
    }, '文件操作已完成');
  const open = async (file: Entry) => {
    if (file.directory) navigate(target(file.name));
    else {
      if (!(await leave('replace'))) return;
      void action.run(async () => {
        const value = await request<{ content: string; version: string }>(
          `/vms/${vm.id}/file?path=${encodeURIComponent(target(file.name))}`,
        );
        setConflict(null);
        setEdit({
          path: target(file.name),
          content: value.content,
          baseContent: value.content,
          version: value.version,
        });
      });
    }
  };
  const save = () => {
    const submitted = editRef.current;
    if (!submitted) return;
    return action.run(async () => {
      try {
        const result = await request<{ version: string }>(`/vms/${vm.id}/file`, 'PUT', {
          path: submitted.path,
          content: submitted.content,
          overwrite: !submitted.fresh,
          expectedVersion: submitted.version,
        });
        setEdit((current) => {
          const next = completeFileSave(current, submitted);
          return next?.path === submitted.path
            ? { ...next, baseContent: submitted.content, version: result.version }
            : next;
        });
        setConflict(null);
        await refresh();
      } catch (error) {
        if (!submitted.fresh) {
          const latest = await request<{ content: string; version: string }>(
            `/vms/${vm.id}/file?path=${encodeURIComponent(submitted.path)}`,
          ).catch(() => null);
          if (latest && latest.version !== submitted.version) setConflict(latest);
        }
        throw error;
      }
    }, '文本已保存');
  };
  const send = (values: FileList | File[]) => {
    const files = Array.from(values);
    if (!files.length) return;
    return action.run(async () => {
      const abort = new AbortController();
      transfer.current = abort;
      try {
        await uploadFiles({
          files,
          token,
          signal: abort.signal,
          url: (name) =>
            `/api/vms/${vm.id}/transfer?path=${encodeURIComponent(target(name))}&overwrite=${overwrite ? 1 : 0}`,
          progress: setProgress,
        });
      } finally {
        transfer.current = null;
        if (alive.current) {
          setProgress(null);
          await refresh();
        }
      }
    }, `${files.length} 个文件已上传`);
  };
  if (vm.status !== 'running')
    return (
      <div className="panel-empty">
        <Folder size={30} />
        <h3>启动 Linux，即可访问文件</h3>
        <p>支持文本编辑与任意类型文件传输。</p>
        {draftDialog}
      </div>
    );
  return (
    <div
      className={`content-panel feature-panel file-browser ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!action.busy) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!action.busy) void send(e.dataTransfer.files);
      }}
    >
      <div className="file-tools">
        <button
          className="icon-button"
          aria-label="上级目录"
          disabled={action.busy}
          onClick={() => navigate(path.split('/').slice(0, -1).join('/') || '/')}
        >
          <ArrowUp size={17} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!action.busy) navigate(input);
          }}
        >
          <Folder size={15} />
          <input
            aria-label="Linux 文件路径"
            disabled={action.busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </form>
        <button className="icon-button" aria-label="刷新文件" onClick={() => void refresh()}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={async () => {
            if (await leave('replace')) {
              setConflict(null);
              setEdit({ path: target('notes.txt'), content: '', fresh: true });
            }
          }}
        >
          <Plus size={14} />
          文件
        </button>
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={() => {
            const name = prompt('新文件夹名称');
            if (name && !/[\/\\]/.test(name)) void operation('mkdir', target(name));
          }}
        >
          <Plus size={14} />
          文件夹
        </button>
        <button className="secondary compact" disabled={action.busy} onClick={() => upload.current?.click()}>
          <Upload size={14} />
          上传文件
        </button>
        <label className="checkbox-label">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          覆盖同名文件
        </label>
        <input
          type="file"
          ref={upload}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void send(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <Feedback error={action.error || error || draftError} message={action.message} />
      {action.busy && progress && (
        <div className="feature-actions" role="status">
          <span>
            {progress.name} · {progress.index}/{progress.count} · {transferBytes(progress.loaded)} /{' '}
            {transferBytes(progress.total)}
            {progress.loaded === progress.total ? ' · 正在保存…' : ''}
          </span>
          <progress aria-label="上传进度" max={progress.total || 1} value={progress.loaded} />
          <button className="text-button" onClick={() => transfer.current?.abort()}>
            取消上传
          </button>
        </div>
      )}
      <div className="browser-table">
        <div className="browser-header">
          <span>名称</span>
          <span>大小</span>
          <span>操作</span>
        </div>
        {files.map((file) => (
          <div className="browser-row" key={file.name}>
            <button className="file-open" disabled={action.busy} onClick={() => open(file)}>
              {file.directory ? <Folder size={17} /> : <FileText size={17} />}
              <span>
                {file.name}
                {file.symlink ? ' ↗' : ''}
              </span>
            </button>
            <span className="muted">{file.directory ? '—' : transferBytes(file.size)}</span>
            <div className="feature-actions">
              {!file.directory && !file.symlink && (
                <button
                  className="icon-button"
                  aria-label={`下载 ${file.name}`}
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(
                      () => download(request, vm.id, { type: 'file', path: target(file.name) }),
                      '下载已开始，请在浏览器查看进度',
                    )
                  }
                >
                  <Download size={15} />
                </button>
              )}
              <button
                className="text-button"
                disabled={action.busy}
                onClick={() => {
                  const name = prompt('新名称', file.name);
                  if (name && name !== file.name && !/[\/\\]/.test(name))
                    void operation('rename', target(file.name), target(name));
                }}
              >
                重命名
              </button>
              <button
                className="icon-button danger-text"
                aria-label={`删除 ${file.name}`}
                disabled={action.busy}
                onClick={() => {
                  if (file.directory && !file.symlink) {
                    if (
                      prompt(`将永久删除 ${target(file.name)} 及其内容。输入文件夹名称确认：`) === file.name
                    )
                      void operation('delete', target(file.name), undefined, true);
                  } else if (confirm(`删除“${file.name}”？`)) void operation('delete', target(file.name));
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!files.length && !loading && !error && <p className="muted">目录为空，可拖拽文件到此处上传。</p>}
      </div>
      <p className="subtle-note">
        {files.length} 个项目 · 可拖拽上传 · 文件传输上限 2 GiB · 文本编辑上限 1 MiB
      </p>
      {edit && (
        <div className="feature-card">
          <div className="panel-heading">
            <h4>
              {edit.fresh ? '新建文本文件' : '编辑文本'}
              {dirtyEdit(edit) ? ' · 未保存' : ''}
            </h4>
            <button
              className="icon-button"
              aria-label="关闭编辑器"
              onClick={async () => {
                if (await leave('discard')) {
                  setEdit(null);
                  setConflict(null);
                }
              }}
            >
              <X size={16} />
            </button>
          </div>
          <label>
            文件路径
            <input
              value={edit.path}
              readOnly={!edit.fresh}
              onChange={(e) => setEdit({ ...edit, path: e.target.value })}
            />
          </label>
          <textarea
            className="file-editor"
            aria-label="文件内容"
            value={edit.content}
            spellCheck={false}
            onChange={(e) => setEdit({ ...edit, content: e.target.value })}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                void save();
              }
            }}
          />
          <p className="subtle-note">Ctrl / ⌘ + S 保存 · 草稿保存在本机浏览器 · UTF-8 文本上限 1 MiB</p>
          {conflict && (
            <div className="feature-card" role="alert">
              <h4>文件已在其他位置修改</h4>
              <p>左侧是服务器最新内容，右侧是当前草稿。合并后再保存。</p>
              <div className="feature-grid">
                <pre className="feature-log">{conflict.content}</pre>
                <pre className="feature-log">{edit.content}</pre>
              </div>
              <div className="feature-actions">
                <button
                  className="secondary compact"
                  onClick={() => {
                    setEdit({
                      ...edit,
                      content: conflict.content,
                      baseContent: conflict.content,
                      version: conflict.version,
                    });
                    setConflict(null);
                    action.clear();
                  }}
                >
                  使用最新内容
                </button>
                <button
                  className="secondary compact"
                  onClick={() => {
                    setEdit({ ...edit, baseContent: conflict.content, version: conflict.version });
                    setConflict(null);
                    action.clear();
                  }}
                >
                  保留草稿继续合并
                </button>
              </div>
            </div>
          )}
          <button className="primary compact" disabled={action.busy} onClick={() => void save()}>
            <Save size={14} />
            保存文件
          </button>
        </div>
      )}
      {draftDialog}
    </div>
  );
}
