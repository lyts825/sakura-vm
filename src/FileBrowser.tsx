import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Download, FileText, Folder, Plus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react';
import { Feedback, download, useAction, type FeatureProps } from './FeaturePanels';

type Entry = { name: string; size: number; directory: boolean; symlink: boolean; modified: number };
export function FileBrowser({ vm, request, token }: FeatureProps) {
  const [path, setPath] = useState('/workspace'),
    [input, setInput] = useState('/workspace');
  const [files, setFiles] = useState<Entry[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [edit, setEdit] = useState<{ path: string; content: string; fresh?: boolean } | null>(null);
  const [overwrite, setOverwrite] = useState(false),
    [progress, setProgress] = useState(''),
    [dragging, setDragging] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    transfer = useRef<XMLHttpRequest | null>(null);
  const action = useAction();
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    if (vm.status !== 'running') return;
    setLoading(true);
    try {
      const values = await request<Entry[]>(`/vms/${vm.id}/files?path=${encodeURIComponent(path)}`);
      if (version === requestVersion.current) {
        setFiles(values);
        setError('');
      }
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
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
  useEffect(() => () => transfer.current?.abort(), []);
  const target = (name: string) => `${path.replace(/\/$/, '')}/${name}`;
  const navigate = (next: string) => {
    setPath(next);
    setInput(next);
    setEdit(null);
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
  const open = (file: Entry) => {
    if (file.directory) navigate(target(file.name));
    else
      void action.run(async () => {
        const value = await request<{ content: string }>(
          `/vms/${vm.id}/file?path=${encodeURIComponent(target(file.name))}`,
        );
        setEdit({ path: target(file.name), content: value.content });
      });
  };
  const send = (values: FileList | File[]) =>
    action.run(async () => {
      for (const file of Array.from(values)) {
        if (file.size > 2 * 1024 ** 3) throw new Error('单文件传输上限为 2 GiB');
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          transfer.current = xhr;
          xhr.open(
            'PUT',
            `/api/vms/${vm.id}/transfer?path=${encodeURIComponent(target(file.name))}&overwrite=${overwrite ? 1 : 0}`,
          );
          xhr.setRequestHeader('X-Sakura-Token', token);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');
          xhr.upload.onprogress = (event) =>
            setProgress(
              `${file.name} · ${event.lengthComputable ? Math.round((event.loaded * 100) / event.total) + '%' : '上传中'}`,
            );
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
              let message = '上传失败';
              try {
                message = JSON.parse(xhr.responseText).error;
              } catch {}
              reject(new Error(message));
            }
          };
          xhr.onerror = () => reject(new Error('上传连接中断'));
          xhr.onabort = () => reject(new Error('上传已取消'));
          xhr.send(file);
        });
      }
      setProgress('');
      transfer.current = null;
      await refresh();
    }, '文件已上传');
  if (vm.status !== 'running')
    return (
      <div className="panel-empty">
        <Folder size={30} />
        <h3>启动 Linux，即可访问文件</h3>
        <p>支持文本编辑与任意类型文件传输。</p>
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
          onClick={() => navigate(path.split('/').slice(0, -1).join('/') || '/')}
        >
          <ArrowUp size={17} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            navigate(input);
          }}
        >
          <Folder size={15} />
          <input aria-label="Linux 文件路径" value={input} onChange={(e) => setInput(e.target.value)} />
        </form>
        <button className="icon-button" aria-label="刷新文件" onClick={() => void refresh()}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>
      <div className="feature-actions">
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={() => setEdit({ path: target('notes.txt'), content: '', fresh: true })}
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
      <Feedback error={action.error || error} message={action.message} />
      {action.busy && progress && (
        <div className="feature-actions" role="status">
          {progress}
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
            <button className="file-open" onClick={() => open(file)}>
              {file.directory ? <Folder size={17} /> : <FileText size={17} />}
              <span>
                {file.name}
                {file.symlink ? ' ↗' : ''}
              </span>
            </button>
            <span className="muted">
              {file.directory
                ? '—'
                : file.size < 1024
                  ? `${file.size} B`
                  : `${(file.size / 1024).toFixed(1)} KiB`}
            </span>
            <div className="feature-actions">
              {!file.directory && !file.symlink && (
                <button
                  className="icon-button"
                  aria-label={`下载 ${file.name}`}
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(() =>
                      download(
                        `/vms/${vm.id}/transfer?path=${encodeURIComponent(target(file.name))}`,
                        file.name,
                        token,
                      ),
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
        {!files.length && !loading && <p className="muted">目录为空，可拖拽文件到此处上传。</p>}
      </div>
      <p className="subtle-note">
        {files.length} 个项目 · 可拖拽上传 · 文件传输上限 2 GiB · 文本编辑上限 1 MiB
      </p>
      {edit && (
        <div className="feature-card">
          <div className="panel-heading">
            <h4>{edit.fresh ? '新建文本文件' : '编辑文本'}</h4>
            <button className="icon-button" aria-label="关闭编辑器" onClick={() => setEdit(null)}>
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
          />
          <button
            className="primary compact"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                await request(`/vms/${vm.id}/file`, 'PUT', { path: edit.path, content: edit.content });
                setEdit(null);
                await refresh();
              }, '文本已保存')
            }
          >
            <Save size={14} />
            保存文件
          </button>
        </div>
      )}
    </div>
  );
}
