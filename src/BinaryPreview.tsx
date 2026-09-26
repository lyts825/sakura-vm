import { useEffect, useRef, useState } from 'react';
import type { Preview } from '../server/file-preview';
import { useRemote, type Request } from './feature-shared';

export function BinaryPreview({
  request,
  id,
  path,
  close,
}: {
  request: Request;
  id: string;
  path: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRemote<Preview>(
    request,
    `/vms/${id}/file-preview?path=${encodeURIComponent(path)}`,
    true,
    0,
  );
  const [url, setUrl] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    setUrl('');
    if (typeof preview.data?.base64 !== 'string' || typeof preview.data.mime !== 'string') return;
    const bytes = Uint8Array.from(atob(preview.data.base64), (character) => character.charCodeAt(0));
    const value = URL.createObjectURL(new Blob([bytes], { type: preview.data.mime }));
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [preview.data]);
  const data = preview.data as any;
  return (
    <dialog
      ref={dialog}
      className="modal file-preview-modal"
      aria-label={'预览 ' + path}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h3>{data?.name || '文件预览'}</h3>
        <button onClick={close}>关闭预览</button>
      </div>
      <div className="content-panel">
        {preview.error && <p role="alert">{preview.error}</p>}
        {!data && !preview.error && <p role="status">正在读取文件…</p>}
        {data?.kind === 'image' && url && <img className="binary-preview-image" src={url} alt={data.name} />}
        {data?.kind === 'pdf' && url && (
          <object data={url} type="application/pdf" aria-label={data.name} className="binary-preview-pdf">
            <a href={url} download={data.name}>
              保存 PDF 后查看
            </a>
          </object>
        )}
        {data?.kind === 'table' && (
          <div className="binary-preview-table">
            <table>
              <tbody>
                {data.rows.map((row: string[], index: number) => (
                  <tr key={index}>
                    {row.map((cell, column) => (
                      <td key={column}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.kind === 'archive' && (
          <div className="binary-preview-table">
            <table>
              <thead>
                <tr>
                  <th>成员</th>
                  <th>大小（字节）</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry: any, index: number) => (
                  <tr key={index}>
                    <td>{entry.name}</td>
                    <td>{entry.bytes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data?.kind === 'hex' && (
          <pre className="feature-log">
            {(data.hex.match(/.{1,32}/g) || [])
              .map(
                (line: string, index: number) =>
                  (index * 16).toString(16).padStart(8, '0') + '  ' + (line.match(/.{1,2}/g) || []).join(' '),
              )
              .join('\n')}
          </pre>
        )}
        {data?.truncated && (
          <p className="muted">{data.message || '内容较多，仅显示预览范围；完整内容可下载查看。'}</p>
        )}
      </div>
    </dialog>
  );
}
