import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Download, FileText, Folder, Plus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react';
import { Feedback, download, useAction, useRemote, type FeatureProps } from './FeaturePanels';
import { uploadFiles, transferBytes, type UploadProgress } from './transfers';
import { dirtyEdit, registerEditorGuard, type FileEdit } from './file-editor-state';
import { restoreDrafts, saveDraftResult, anyDirty, type EditorDraft } from './editor-drafts';
const CodeEditor = lazy(() => import('./CodeEditor').then((module) => ({ default: module.CodeEditor })));
import { ProjectNavigator } from './ProjectNavigator';
import { PluginGate } from './plugin-context';

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
export function FileBrowser({
  vm,
  request,
  token,
  openFile,
}: FeatureProps & { openFile?: { path: string; line?: number; revision: number } }) {
  const [path, setPath] = useState('/workspace'),
    [input, setInput] = useState('/workspace');
  const [files, setFiles] = useState<Entry[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const draftKey = `sakura-drafts:${vm.id}`;
  const [workspace, setWorkspace] = useState<{ drafts: EditorDraft[]; active: string }>(() => {
    try {
      const drafts = restoreDrafts(
        JSON.parse(localStorage.getItem(draftKey) || localStorage.getItem(`sakura-draft:${vm.id}`) || 'null'),
      );
      return { drafts, active: drafts[0]?.id || '' };
    } catch {
      return { drafts: [], active: '' };
    }
  });
  const edit = workspace.drafts.find((draft) => draft.id === workspace.active) || null;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const setEdit = (value: FileEdit | null) => {
    const active = workspaceRef.current.active;
    setWorkspace((current) => {
      const drafts = value
        ? current.drafts.map((draft) => (draft.id === active ? { ...value, id: draft.id } : draft))
        : current.drafts.filter((draft) => draft.id !== active);
      return { drafts, active: value ? current.active : drafts[0]?.id || '' };
    });
  };
  const [line, setLine] = useState<{ path: string; number?: number }>({ path: '' });
  const [draftError, setDraftError] = useState(''),
    [conflicts, setConflicts] = useState<Record<string, { content: string; version: string }>>({});
  const [diagnostics, setDiagnostics] = useState<{ message: string; line?: number; column?: number }[]>([]);
  const conflict = edit ? conflicts[edit.id] : null;
  const setConflict = (value: { content: string; version: string } | null) => {
    const id = workspaceRef.current.active;
    setConflicts((current) => {
      const next = { ...current };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  };
  const editRef = useRef(edit);
  editRef.current = edit;
  const [leaveKind, setLeaveKind] = useState<'leave' | 'replace' | 'discard' | null>(null);
  const history = useRemote<{
    items: {
      id: string;
      path: string;
      kind: 'version' | 'trash';
      createdAt: string;
      bytes: number;
      version?: string;
    }[];
  }>(request, `/vms/${vm.id}/history`, vm.status === 'running', 10000);
  const pendingLeave = useRef<{ promise: Promise<boolean>; resolve: (allowed: boolean) => void } | null>(
    null,
  );
  const leave = (kind: 'leave' | 'replace' | 'discard' = 'leave') => {
    if (!(kind === 'leave' ? anyDirty(workspaceRef.current.drafts) : dirtyEdit(editRef.current)))
      return Promise.resolve(true);
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
      if (anyDirty(workspaceRef.current.drafts)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);
  useEffect(() => {
    try {
      if (workspace.drafts.length) localStorage.setItem(draftKey, JSON.stringify(workspace.drafts));
      else localStorage.removeItem(draftKey);
      localStorage.removeItem(`sakura-draft:${vm.id}`);
      setDraftError('');
    } catch {
      setDraftError('浏览器无法保存草稿，请及时保存文件。');
    }
  }, [workspace.drafts, draftKey]);
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
  const openPath = async (filePath: string, jump?: number) => {
    const existing = workspaceRef.current.drafts.find((draft) => draft.path === filePath);
    setLine({ path: filePath, number: jump });
    if (existing) {
      setWorkspace((current) => ({ ...current, active: existing.id }));
      return;
    }
    if (workspaceRef.current.drafts.length >= 20) {
      setError('最多同时打开 20 个文件，请先关闭部分标签');
      return;
    }
    await action.run(async () => {
      const value = await request<{ content: string; version: string }>(
        `/vms/${vm.id}/file?path=${encodeURIComponent(filePath)}`,
      );
      const draft: EditorDraft = {
        id: crypto.randomUUID(),
        path: filePath,
        content: value.content,
        baseContent: value.content,
        version: value.version,
      };
      setWorkspace((current) => ({ drafts: [...current.drafts, draft], active: draft.id }));
    });
  };
  const open = (file: Entry) => (file.directory ? navigate(target(file.name)) : openPath(target(file.name)));
  useEffect(() => {
    if (openFile && vm.status === 'running') void openPath(openFile.path, openFile.line);
  }, [openFile?.revision, vm.status]);
  const save = () => {
    const submitted = editRef.current;
    if (!submitted) return;
    return action.run(async () => {
      if (
        workspaceRef.current.drafts.some(
          (draft) => draft.id !== submitted.id && draft.path === submitted.path,
        )
      )
        throw new Error('另一个标签已打开同一路径');
      try {
        const result = await request<{ version: string }>(`/vms/${vm.id}/file`, 'PUT', {
          path: submitted.path,
          content: submitted.content,
          overwrite: !submitted.fresh,
          expectedVersion: submitted.version,
        });
        setWorkspace((current) => ({
          ...current,
          drafts: saveDraftResult(current.drafts, submitted, result.version),
        }));
        setConflicts((current) => {
          const next = { ...current };
          delete next[submitted.id];
          return next;
        });
        await refresh();
      } catch (error) {
        if (!submitted.fresh) {
          const latest = await request<{ content: string; version: string }>(
            `/vms/${vm.id}/file?path=${encodeURIComponent(submitted.path)}`,
          ).catch(() => null);
          if (latest && latest.version !== submitted.version)
            setConflicts((current) => ({ ...current, [submitted.id]: latest }));
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
      <PluginGate id="project-search">
        <details className="feature-card project-tree-disclosure" open>
          <summary>项目文件树与全文搜索</summary>
          <ProjectNavigator id={vm.id} request={request} open={(path, line) => void openPath(path, line)} />
        </details>
      </PluginGate>
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
          onClick={() => {
            if (workspace.drafts.length >= 20) {
              setError('最多同时打开 20 个文件');
              return;
            }
            const draft: EditorDraft = {
              id: crypto.randomUUID(),
              path: target(`untitled-${workspace.drafts.length + 1}.txt`),
              content: '',
              fresh: true,
            };
            setWorkspace((current) => ({ drafts: [...current.drafts, draft], active: draft.id }));
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
      {history.data?.items.length ? (
        <details className="feature-card">
          <summary>文件历史与回收站（{history.data.items.length}）</summary>
          {history.data.items
            .slice()
            .reverse()
            .slice(0, 50)
            .map((item) => (
              <div className="development-row" key={item.id}>
                <div>
                  <code>{item.kind === 'trash' ? '回收站' : '历史版本'}</code> <b>{item.path}</b>
                  <small> · {new Date(item.createdAt).toLocaleString()}</small>
                </div>
                <div className="feature-actions">
                  <button
                    className="text-button"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async (signal) => {
                        let expectedVersion: string | undefined;
                        if (item.kind === 'version') {
                          const current = await request<{ version: string }>(
                            `/vms/${vm.id}/file?path=${encodeURIComponent(item.path)}`,
                            'GET',
                            undefined,
                            signal,
                          ).catch(() => null);
                          expectedVersion = current?.version;
                        }
                        await request(
                          `/vms/${vm.id}/history`,
                          'POST',
                          { action: 'restore', id: item.id, ...(expectedVersion ? { expectedVersion } : {}) },
                          signal,
                        );
                        history.reload();
                      })
                    }
                  >
                    恢复
                  </button>
                  <button
                    className="text-button danger-text"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async (signal) => {
                        await request(
                          `/vms/${vm.id}/history`,
                          'POST',
                          { action: 'purge', id: item.id },
                          signal,
                        );
                        history.reload();
                      })
                    }
                  >
                    清理
                  </button>
                </div>
              </div>
            ))}
        </details>
      ) : null}
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
      {!!workspace.drafts.length && (
        <div className="editor-tabs" role="tablist" aria-label="打开的文件">
          {workspace.drafts.map((draft) => (
            <button
              key={draft.id}
              role="tab"
              aria-selected={draft.id === workspace.active}
              title={draft.path}
              className={draft.id === workspace.active ? 'active' : ''}
              onClick={() => setWorkspace((current) => ({ ...current, active: draft.id }))}
            >
              {draft.path.split('/').at(-1)}
              {dirtyEdit(draft) ? ' ●' : ''}
            </button>
          ))}
        </div>
      )}
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
          <Suspense fallback={<p className="muted">正在加载编辑器…</p>}>
            <CodeEditor
              key={edit.id}
              path={edit.path}
              value={edit.content}
              change={(content) => setEdit({ ...edit, content })}
              save={() => void save()}
              line={line.path === edit.path ? line.number : undefined}
            />
          </Suspense>
          <div className="feature-actions">
            <PluginGate id="code-checks">
              <button
                className="secondary compact"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async (signal) => {
                    const result = await request<{
                      diagnostics: { message: string; line?: number; column?: number }[];
                    }>(
                      `/vms/${vm.id}/code-diagnostics?path=${encodeURIComponent(edit.path)}`,
                      'GET',
                      undefined,
                      signal,
                    );
                    setDiagnostics(result.diagnostics);
                  }, '检查完成')
                }
              >
                运行代码检查
              </button>
            </PluginGate>
          </div>
          {diagnostics.length > 0 && (
            <div className="feature-card" role="status">
              <b>代码检查</b>
              {diagnostics.map((item, index) => (
                <p className="machine-error" key={index}>
                  {item.line ? `${item.line}:${item.column || 1} ` : ''}
                  {item.message}
                </p>
              ))}
            </div>
          )}
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
