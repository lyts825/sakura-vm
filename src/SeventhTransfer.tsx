/** 原始字节分块上传及固定票据恢复。 */
import { useEffect, useRef, useState } from 'react';
import type { SuiteRecord, SuiteUpload } from '../shared/contracts/suite-common.ts';
import { DeliveryHash } from './delivery-transfer.ts';
import { suiteBase64 } from './suite-client.ts';

export type SeventhTransferPost = <T>(domain: string, action: string, body: unknown, signal?: AbortSignal) => Promise<T>;
type Props = {
  post: SeventhTransferPost;
  workspaceId: string;
  domain: string;
  onUploaded: (record: SuiteRecord) => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
};
const chunkSize = 512 * 1024;
const maximumBytes = 256 * 1024 * 1024;
const formats = ['json', 'jsonl', 'csv', 'text', 'pdf', 'png', 'jpeg', 'webp', 'wasm', 'binary', 'wav', 'mp4', 'site'] as const;
type Format = typeof formats[number];
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const inferFormat = (name: string): Format => {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'jpg') return 'jpeg';
  if (extension === 'txt') return 'text';
  return formats.includes(extension as Format) ? extension as Format : 'binary';
};
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function SeventhTransfer({ post, workspaceId, domain, onUploaded, onError, onBusy }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<Format>('json');
  const [allowExport, setAllowExport] = useState(false);
  const [uploads, setUploads] = useState<SuiteUpload[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [selected, setSelected] = useState('');
  const control = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const alive = useRef(false);
  const handlers = useRef({ post, onUploaded, onError, onBusy });
  handlers.current = { post, onUploaded, onError, onBusy };
  const scope = useRef({ workspaceId, domain });
  scope.current = { workspaceId, domain };

  useEffect(() => {
    alive.current = true;
    generation.current++;
    control.current?.abort();
    busyRef.current = false;
    setBusy(false); setUploads([]); setFile(null); setSelected(''); setProgress('');
    return () => { alive.current = false; generation.current++; control.current?.abort(); if (busyRef.current) handlers.current.onBusy?.(false); };
  }, [workspaceId, domain]);

  async function work(action: (api: SeventhTransferPost, signal: AbortSignal, update: (message: string) => void) => Promise<void>) {
    if (busyRef.current || !workspaceId) return;
    const current = generation.current, original = { workspaceId, domain };
    const abort = new AbortController(); control.current = abort;
    const check = () => {
      abort.signal.throwIfAborted();
      if (!alive.current || generation.current !== current || scope.current.domain !== original.domain || scope.current.workspaceId !== original.workspaceId) throw new DOMException('上传范围已变化', 'AbortError');
    };
    const api: SeventhTransferPost = async <T,>(provider: string, method: string, body: unknown, signal?: AbortSignal) => {
      check();
      const result = await handlers.current.post<T>(provider, method, body, signal ? AbortSignal.any([abort.signal, signal]) : abort.signal);
      check(); return result;
    };
    busyRef.current = true; setBusy(true); handlers.current.onBusy?.(true);
    try { await action(api, abort.signal, message => { check(); setProgress(message); }); }
    catch (error) {
      if (alive.current && generation.current === current) {
        if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) setProgress('已停止本地传输。服务端票据保留，可刷新后恢复。');
        else handlers.current.onError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (alive.current && generation.current === current) {
        busyRef.current = false; setBusy(false); handlers.current.onBusy?.(false); control.current = null;
      }
    }
  }

  const refresh = () => work(async api => {
    const values = await api<SuiteUpload[]>(domain, 'uploads', { workspaceId });
    setUploads(values.filter(upload => upload.state !== 'discarded'));
  });

  const upload = (resume?: SuiteUpload) => work(async (api, signal, update) => {
    const originalFile = file;
    if (!originalFile) throw new Error('请先选择本地原文件。');
    if (originalFile.size > maximumBytes) throw new Error('单份材料最多 256 MiB。');
    if (resume && (resume.workspaceId !== workspaceId || resume.name !== originalFile.name || resume.bytes !== originalFile.size)) throw new Error('续传文件的名称和字节长度必须与原票据完全一致。');
    if (resume && resume.state !== 'uploading' && resume.state !== 'ready') throw new Error('此票据状态未知，先刷新核对；无法恢复时可丢弃票据后重新上传。');
    const hash = new DeliveryHash();
    for (let offset = 0; offset < originalFile.size; offset += chunkSize) {
      signal.throwIfAborted();
      const bytes = new Uint8Array(await originalFile.slice(offset, offset + chunkSize).arrayBuffer());
      signal.throwIfAborted(); hash.update(bytes);
      update(`核验原文件 ${size(Math.min(offset + bytes.length, originalFile.size))} / ${size(originalFile.size)}`);
    }
    const digest = hash.digest();
    if (resume && resume.digest !== digest) throw new Error('原文件 SHA-256 与票据不匹配，已拒绝续传。');
    const declaredFormat = format;
    let ticket = resume ?? await api<SuiteUpload>(domain, 'beginUpload', { workspaceId, name: originalFile.name, format: declaredFormat, bytes: originalFile.size, digest, allowExport });
    if (ticket.workspaceId !== workspaceId || ticket.digest !== digest || ticket.bytes !== originalFile.size || ticket.name !== originalFile.name || !Number.isSafeInteger(ticket.offset) || ticket.offset < 0 || ticket.offset > originalFile.size) throw new Error('上传票据与原文件不一致。');
    setSelected(ticket.id);
    setUploads(previous => [ticket, ...previous.filter(item => item.id !== ticket.id)]);
    while (ticket.offset < originalFile.size) {
      signal.throwIfAborted();
      const offset = ticket.offset;
      const bytes = new Uint8Array(await originalFile.slice(offset, offset + chunkSize).arrayBuffer());
      signal.throwIfAborted();
      if (!bytes.length) throw new Error('原文件未能提供请求的字节。');
      const next = await api<SuiteUpload>(domain, 'appendUpload', { workspaceId, id: ticket.id, offset, data: suiteBase64(bytes) });
      if (next.id !== ticket.id || next.digest !== digest || next.bytes !== originalFile.size || next.offset !== offset + bytes.length) throw new Error('服务端分块偏移或文件摘要不一致，已停止上传。');
      ticket = next;
      setUploads(previous => [ticket, ...previous.filter(item => item.id !== ticket.id)]);
      update(`上传 ${size(ticket.offset)} / ${size(originalFile.size)}`);
    }
    update('正在核验完整材料并封存修订……');
    const record = await api<SuiteRecord>(domain, 'finishUpload', { workspaceId, id: ticket.id });
    const material = object(record.content);
    if (record.domain !== domain || record.workspaceId !== workspaceId || record.kind !== 'source' || record.state !== 'sealed' || material?.digest !== digest || material?.bytes !== originalFile.size || (!resume && material?.format !== declaredFormat)) throw new Error('材料完成回执与上传声明不一致，请在材料记录中核对原票据。');
    setUploads(previous => previous.filter(item => item.id !== ticket.id));
    setSelected(''); setFile(null);
    update(`已封存 ${originalFile.name} · ${size(originalFile.size)} · ${String(material.format)}`);
    handlers.current.onUploaded(record);
  });

  const discard = (ticket: SuiteUpload) => work(async api => {
    const result = await api<SuiteUpload>(domain, 'discardUpload', { workspaceId, id: ticket.id });
    if (result.id !== ticket.id || result.state !== 'discarded') throw new Error('票据尚未确认丢弃，请刷新核对。');
    setUploads(previous => previous.filter(item => item.id !== ticket.id));
    if (selected === ticket.id) setSelected('');
  });
  const resume = uploads.find(item => item.id === selected);
  return <section className="sv-transfer sv-field" aria-label="材料分块上传与恢复">
    <h3>上传原始材料</h3>
    <p className="sv-hint">单份最多 256 MiB，按 512 KiB 分块核验。计算绑定最多 1 MiB；较大材料仍可保存和交接。</p>
    <div className="sv-toolbar">
      <label>本地文件<input type="file" disabled={busy || !workspaceId} onChange={event => { const next = event.target.files?.[0] ?? null; event.currentTarget.value = ''; setFile(next); if (next) setFormat(inferFormat(next.name)); }} /></label>
      <label>真实格式<select value={format} disabled={busy || !!resume} onChange={event => setFormat(event.target.value as Format)}>{formats.map(value => <option key={value}>{value}</option>)}</select></label>
      <label><input type="checkbox" checked={allowExport} disabled={busy || !!resume} onChange={event => setAllowExport(event.target.checked)} />允许后续导出</label>
    </div>
    {file && <p>{file.name} · {size(file.size)}{file.size > 1024 ** 2 ? ' · 超过首版计算绑定上限' : ''}</p>}
    {(format === 'jsonl' || format === 'csv') && <p className="sv-hint">保留原始文本和换行；使用时选择文本绑定，解析方式由所选领域动作决定。</p>}
    {resume && <p className="sv-hint">正在恢复票据 {resume.id}。格式和导出策略沿用原声明；选择完全相同的原文件后继续。</p>}
    <div className="sv-toolbar">
      <button type="button" disabled={!workspaceId || busy || !file || file.size > maximumBytes} onClick={() => void upload(resume)}>{resume ? '核验原文件并续传' : '核验并分块上传'}</button>
      {resume && <button type="button" disabled={busy} onClick={() => setSelected('')}>改为新上传</button>}
      <button type="button" disabled={!busy} onClick={() => control.current?.abort()}>停止本地传输</button>
      <button type="button" disabled={!workspaceId || busy} onClick={() => void refresh()}>查询原上传票据</button>
    </div>
    <p role="status" aria-live="polite">{progress}</p>
    {uploads.length > 0 && <div className="sv-table"><table><thead><tr><th>原文件与票据</th><th>状态和偏移</th><th>操作</th></tr></thead><tbody>{uploads.map(ticket => <tr key={ticket.id}><td>{ticket.name}<br /><code>{ticket.id}</code><br /><small>兼容容器 {ticket.format} · SHA-256 {ticket.digest}</small></td><td>{ticket.state}<br />{size(ticket.offset)} / {size(ticket.bytes)}</td><td><button type="button" disabled={busy || !['uploading', 'ready'].includes(ticket.state)} onClick={() => { setSelected(ticket.id); setProgress('请重选此票据对应的原文件；文件名称、长度和摘要均会重新核验。'); }}>选择此票据</button><button type="button" disabled={busy} onClick={() => void discard(ticket)}>丢弃票据</button></td></tr>)}</tbody></table></div>}
  </section>;
}
