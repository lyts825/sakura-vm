/**
 * 模块职责（中文）：展示服务端识别的二进制文件预览，按媒体类型呈现内容并处理无法预览的结果。
 * Module responsibility (English): Presenting binary previews by file type and explaining unavailable previews.
 * 详细范围（中文）：公开入口包括 BinaryPreview；职责覆盖按文件类型展示二进制预览和不可用反馈，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include BinaryPreview. The scope covers Presenting binary previews by file type and explaining unavailable previews. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useRef, useState } from 'react';
import type { Preview } from '../server/file-preview';
import { useRemote, type Request } from './feature-shared';

/**
 * 中文：呈现按文件类型展示二进制预览和不可用反馈中的 BinaryPreview 界面，订阅 /vms/{id}/file-preview?path={encodeURIComponent(path)}，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the BinaryPreview surface for Presenting binary previews by file type and explaining unavailable previews, subscribing to /vms/{id}/file-preview?path={encodeURIComponent(path)}. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  request,
  id,
  path,
  close,
} 提供 request（带身份和权限作用域的传输能力）、id（目标资源标识）、path（目标文件或请求路径）、close（close 状态） 上下文字段
 * English: Inputs: {
  request,
  id,
  path,
  close,
} provides context fields request (transport capability bound to identity/authority scope), id (target resource identifier), path (target file/request path), close (close state)
 */
export function BinaryPreview({
  request,
  id,
  path,
  close,
}: {
  request: Request;
  id: string;
  path: string;
  close: /** 中文：请求关闭当前界面，实际导航或卸载由父级决定；这是 BinaryPreview 的调用契约 | English: Request surface closure, leaving actual navigation/unmounting to the parent; this is the callable contract of BinaryPreview | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRemote<Preview>(
    request,
    `/vms/${id}/file-preview?path=${encodeURIComponent(path)}`,
    true,
    0,
  );
  const [url, setUrl] = useState('');
  useEffect(/** 中文：当依赖 [] 变化时打开原生模态对话框；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, open a native modal dialog. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    /**
     * 中文：在按文件类型展示二进制预览和不可用反馈流程中关闭所属连接或存储对象，把输入焦点移到目标元素；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Presenting binary previews by file type and explaining unavailable previews, close the owned connection/storage object, move input focus to the target. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(/** 中文：当依赖 [preview.data] 变化时创建二进制内容临时 URL，url 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [preview.data] change, create temporary binary-content URLs, url state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
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
