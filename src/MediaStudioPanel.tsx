/** 媒体任务必须显式批准；显示实际输出和各项核验结果。 */
import { useEffect, useRef, useState } from 'react';
import type { Request } from './feature-shared';
import type { z } from 'zod';
import * as S from '../shared/contracts/suite-common';
import * as M from '../shared/contracts/media-studio';
import { mediaHttpSchemas } from '../shared/contracts/media-http';
import {
  useSuiteClient,
  suiteReference as ref,
  suiteReferenceKey as key,
  suiteBase64,
  suiteDigest,
} from './suite-client';
import { SuiteRecordSelect } from './SuiteRecordSelect';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import { SuiteHostCapacityStatus } from './SuiteHostCapacityStatus';
import type { SuiteHostCapacity } from '../shared/contracts/suite-capacity';
import './suite-workbench.css';
const titles = {
  sources: '来源材料',
  inspect: '探测记录',
  recipes: '固定配方',
  workers: '处理任务',
  captions: '手工字幕',
  collections: '资源集合',
  reviews: '人工审核',
  exchange: '交接记录',
};
type Domain = keyof typeof titles;
const tabs = ['材料与探测', '配方与处理', '字幕与集合', '审核与交接', '历史与清理'];
const body = (r?: S.SuiteRecord) =>
  r?.content && typeof r.content === 'object' && !Array.isArray(r.content) ? r.content : null;
export function MediaStudioPanel(props: { request: Request; accessEpoch?: unknown }) {
  return <MediaSession key={String(props.accessEpoch ?? 'local')} request={props.request} />;
}
function MediaSession({ request }: { request: Request }) {
  const call = useSuiteClient(request, 'media', mediaHttpSchemas),
    [workspaces, setWorkspaces] = useState<S.SuiteWorkspace[]>([]),
    [workspaceId, setWorkspace] = useState(''),
    [name, setName] = useState('媒体制作'),
    [tab, setTab] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [rows, setRows] = useState<Record<string, S.SuiteRecord[]>>({}),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [plan, setPlan] = useState<{ value: S.SuitePlan; domain: string; apply: string } | null>(null),
    [file, setFile] = useState<File>(),
    [license, setLicense] = useState('本人制作，允许本次处理'),
    [reviewed, setReviewed] = useState(false),
    [assetId, setAsset] = useState(''),
    [digest, setDigest] = useState(''),
    [templates, setTemplates] = useState<z.infer<typeof M.mediaTemplates>>([]),
    [template, setTemplate] = useState('responsive-images'),
    [recipe, setRecipe] = useState(''),
    [item, setItem] = useState(''),
    [output, setOutput] = useState(0),
    [captionText, setCaptionText] = useState('1\n00:00:00,000 --> 00:00:01,000\n第一句手工字幕\n'),
    [language, setLanguage] = useState('zh'),
    [entries, setEntries] = useState<z.infer<typeof M.mediaCollectionEntry>[]>([]),
    [sourceQueue, setSourceQueue] = useState<{ reference: S.SuiteRef; name: string }[]>([]),
    [recipeQueue, setRecipeQueue] = useState<{ reference: S.SuiteRef; name: string }[]>([]),
    [entryName, setEntryName] = useState('output.png'),
    [observations, setObservations] = useState(''),
    [human, setHuman] = useState(false),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [history, setHistory] = useState<Domain>('sources'),
    [cursor, setCursor] = useState<Record<string, number | null>>({}),
    [capacity, setCapacity] = useState<SuiteHostCapacity>(),
    [previewMedia, setPreviewMedia] = useState<{ url: string; format: string; name: string } | null>(null);
  const epoch = useRef(0),
    mounted = useRef(true),
    blob = useRef<string | null>(null),
    scope = { workspaceId },
    image = { assetId, digest };
  const clearPreview = () => {
    if (blob.current) URL.revokeObjectURL(blob.current);
    blob.current = null;
    setPreviewMedia(null);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
      if (blob.current) URL.revokeObjectURL(blob.current);
    };
  }, []);
  const invoke = async <T,>(domain: string, method: string, input: unknown = {}): Promise<T> => {
    const now = epoch.current,
      result = await call<T>(domain, method, input);
    if (!mounted.current || now !== epoch.current) throw new DOMException('工作区已变化', 'AbortError');
    return result;
  };
  const chosen = (d: string) => rows[d]?.find((r) => key(r) === selected[d]);
  const fixed = (d: string) => {
    const row = chosen(d);
    if (!row || row.origin !== 'local') throw new Error('请选择本地固定修订');
    return ref(row);
  };
  const add = (row: S.SuiteRecord) => {
    const d = row.domain.replace('media-', '');
    setRows((old) => ({ ...old, [d]: [row, ...(old[d] ?? []).filter((x) => x.id !== row.id)].slice(0, 30) }));
    setSelected((old) => ({ ...old, [d]: key(row) }));
    return row;
  };
  const reset = () => {
    epoch.current++;
    setRows({});
    setCursor({});
    setSelected({});
    setPlan(null);
    setFile(undefined);
    setEntries([]);
    setSourceQueue([]);
    setRecipeQueue([]);
    setCaptionText('');
    setObservations('');
    setCapacity(undefined);
    setTransfers([]);
    setReviewed(false);
    setHuman(false);
    clearPreview();
  };
  const run = async (work: () => Promise<unknown>, message = '操作完成') => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    const current = epoch.current;
    try {
      await work();
      if (mounted.current && current === epoch.current) setNotice(message);
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && mounted.current) {
        setError(e instanceof Error ? e.message : '操作失败');
        const v = e as { status?: number; code?: string };
        if ([401, 403].includes(v.status ?? 0) || /REVOK|PERMISSION|DENIED/.test(v.code ?? '')) {
          reset();
          setWorkspace('');
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const act = async (d: string, m: string, p: unknown) => add(await invoke<S.SuiteRecord>(d, m, p));
  const preview = async (domain: string, method: string, input: unknown, apply: string) =>
    setPlan({ domain, apply, value: await invoke<S.SuitePlan>(domain, method, input) });
  const refresh = async () => {
    if (!workspaceId) return;
    for (const d of tab === 4 ? [history] : Object.keys(titles)) {
      const page = await invoke<S.SuitePage>(d, 'list', {
        ...scope,
        limit: 30,
        cursor: 0,
        history: tab === 4,
        archived: tab === 4,
      });
      setRows((old) => ({ ...old, [d]: page.items }));
      setCursor((old) => ({ ...old, [d]: page.next }));
    }
    setCapacity(await invoke('sources', 'hostCapacity', scope));
    if (tab === 3) setTransfers(await invoke('exchange', 'transfers', scope));
  };
  useEffect(() => {
    void run(async () => {
      setWorkspaces(await invoke('sources', 'listWorkspaces'));
      const list = await invoke<z.infer<typeof M.mediaTemplates>>('workbench', 'templates');
      setTemplates(list);
      setRecipe(JSON.stringify(list[0].recipe, null, 2));
    }, '已读取工作区与三个制作示例');
  }, []);
  useEffect(() => {
    if (workspaceId) void run(refresh, '已刷新固定修订');
  }, [workspaceId, tab, history]);
  const selector = (d: Domain, format?: string) => (
    <SuiteRecordSelect
      title={titles[d]}
      rows={(rows[d] ?? []).filter((r) => !format || body(r)?.format === format)}
      value={selected[d] ?? ''}
      onChange={(v) => {
        setSelected((old) => ({ ...old, [d]: v }));
        if (d === 'workers') {
          setOutput(0);
          clearPreview();
        }
      }}
    />
  );
  const button = (label: string, work: () => Promise<unknown>, disabled = false) => (
    <button disabled={busy || !workspaceId || disabled} onClick={() => void run(work)}>
      {label}
    </button>
  );
  const inspection = M.mediaJob.safeParse(chosen('inspect')?.content),
    job = M.mediaJob.safeParse(chosen('workers')?.content),
    published = job.success ? job.data.published : [],
    current = published[output],
    caption = M.mediaCaption.safeParse(chosen('captions')?.content);
  const upload = async () => {
    if (!file || file.size > 4 * 1024 ** 2) throw new Error('请选择不超过 4 MiB 的媒体文件');
    const extension = file.name.toLowerCase().split('.').pop(),
      format = M.mediaFacts.shape.format.parse(extension === 'jpg' ? 'jpeg' : extension),
      bytes = new Uint8Array(await file.arrayBuffer()),
      handle = await invoke<S.SuiteUpload>('sources', 'beginUpload', {
        ...scope,
        name: file.name,
        format,
        bytes: bytes.length,
        digest: await suiteDigest(bytes),
        allowExport: false,
      });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await invoke('sources', 'appendUpload', {
        ...scope,
        id: handle.id,
        offset,
        data: suiteBase64(bytes.subarray(offset, offset + 512 * 1024)),
      });
    await act('sources', 'finishUpload', { ...scope, id: handle.id });
  };
  const showOutput = async () => {
    if (!current) throw new Error('先发布并选择已验证输出');
    const lease = await invoke<S.SuiteReadLease>('sources', 'openRead', {
        ...scope,
        id: current.source.id,
        revision: current.source.revision,
      }),
      parts: Uint8Array[] = [];
    try {
      let offset = 0;
      for (;;) {
        const c = await invoke<{ data: string; offset: number; eof: boolean }>('sources', 'readLease', {
            ...scope,
            id: lease.id,
            offset,
            length: 512 * 1024,
          }),
          part = Uint8Array.from(atob(c.data), (x) => x.charCodeAt(0));
        parts.push(part);
        offset = c.offset;
        if (c.eof) break;
        if (offset > 4 * 1024 ** 2) throw new Error('输出超出预算');
      }
    } finally {
      await invoke('sources', 'closeRead', { ...scope, id: lease.id });
    }
    clearPreview();
    const mime: Record<string, string> = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        mp4: 'video/mp4',
        wav: 'audio/wav',
      },
      url = URL.createObjectURL(new Blob(parts as BlobPart[], { type: mime[current.facts.format] }));
    blob.current = url;
    setPreviewMedia({ url, format: current.facts.format, name: current.name });
  };
  const jobControls = (d: 'inspect' | 'workers') => (
    <div className="suite-actions">
      {button('读取原任务', () => act(d, 'poll', { ...scope, job: fixed(d) }))}
      {button('取消原任务', () => act(d, 'cancel', { ...scope, job: fixed(d) }))}
      {button('预览原副本核销', () =>
        preview(d, 'reconcile', { ...scope, job: fixed(d) }, 'confirmReconcile'),
      )}
    </div>
  );
  return (
    <section className="suite-workbench">
      <header>
        <h1>媒体资源制作</h1>
        <p>从明确选择的文件制作图片、视频片段、音频和手工字幕；每次处理使用独立副本。</p>
      </header>
      <div className="suite-toolbar">
        <label>
          工作区
          <select
            aria-label="媒体工作区"
            value={workspaceId}
            disabled={busy}
            onChange={(e) => {
              reset();
              setWorkspace(e.target.value);
            }}
          >
            <option value="">选择工作区</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              const w = await invoke<S.SuiteWorkspace>('sources', 'createWorkspace', { name });
              setWorkspaces((old) => [...old, w]);
              reset();
              setWorkspace(w.id);
            })
          }
        >
          新建工作区
        </button>
        {button('刷新', refresh)}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {capacity && <SuiteHostCapacityStatus value={capacity} />}
      <nav className="suite-tabs" aria-label="媒体流程">
        {tabs.map((t, i) => (
          <button
            key={t}
            aria-current={tab === i ? 'page' : undefined}
            disabled={busy}
            onClick={() => {
              setTab(i);
              clearPreview();
            }}
          >
            {t}
          </button>
        ))}
      </nav>
      {workspaceId && tab === 0 && (
        <div className="suite-grid">
          <article>
            <h2>明确上传与许可</h2>
            <input
              aria-label="媒体文件"
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.wav,.mp4"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
            {button('上传文件', upload, !file)}
            {selector('sources')}
            <label>
              来源及许可说明
              <textarea value={license} onChange={(e) => setLicense(e.target.value)} />
            </label>
            <label>
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              我已检查所选文件和本次处理许可
            </label>
            {button(
              '固定已审阅来源',
              () => act('sources', 'pin', { ...scope, source: fixed('sources'), license, reviewed: true }),
              !reviewed,
            )}
            <p>
              支持 PNG、JPEG、WebP、PCM WAV、H.264/AAC MP4。单任务输入总量最多 4 MiB；嵌入 ICC
              档案需要其他颜色处理流程。
            </p>
          </article>
          <article>
            <h2>专用副本探测</h2>
            <label>
              准备镜像资产 ID
              <input value={assetId} onChange={(e) => setAsset(e.target.value)} />
            </label>
            <label>
              镜像 SHA-256
              <input value={digest} onChange={(e) => setDigest(e.target.value)} />
            </label>
            {selector('sources', 'sakura-media-pinned/1')}
            {button(
              '加入探测批次',
              async () => {
                const reference = fixed('sources');
                if (sourceQueue.some((x) => key(x.reference) === key(reference)))
                  throw new Error('该来源已在批次中');
                setSourceQueue((old) => [...old, { reference, name: chosen('sources')!.name }]);
              },
              sourceQueue.length >= 3,
            )}
            <ul>
              {sourceQueue.map((entry, i) => (
                <li key={key(entry.reference)}>
                  {entry.name}
                  <button
                    disabled={busy}
                    onClick={() => setSourceQueue((old) => old.filter((_, j) => j !== i))}
                  >
                    移出探测批次
                  </button>
                </li>
              ))}
            </ul>
            {button('预览媒体探测', () =>
              preview(
                'inspect',
                'preview',
                {
                  ...scope,
                  name,
                  sources: sourceQueue.length ? sourceQueue.map((x) => x.reference) : [fixed('sources')],
                  image,
                },
                'inspect',
              ),
            )}
            {selector('inspect')}
            {jobControls('inspect')}
            <pre>{JSON.stringify(inspection.success ? inspection.data.result : null, null, 2)}</pre>
          </article>
        </div>
      )}
      {workspaceId && tab === 1 && (
        <div className="suite-grid">
          <article>
            <h2>固定处理配方</h2>
            {selector('inspect')}
            <label>
              探测项目
              <select aria-label="探测项目" value={item} onChange={(e) => setItem(e.target.value)}>
                <option value="">选择已通过项目</option>
                {inspection.success &&
                  inspection.data.result?.items
                    .filter((x) => x.state === 'verified')
                    .map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.facts?.format} · {x.facts?.width} × {x.facts?.height} · {x.facts?.durationMs} ms
                      </option>
                    ))}
              </select>
            </label>
            <label>
              示例
              <select
                aria-label="制作示例"
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  const v = templates.find((x) => x.id === e.target.value);
                  if (v) setRecipe(JSON.stringify(v.recipe, null, 2));
                }}
              >
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              aria-label="固定媒体配方"
              rows={15}
              value={recipe}
              onChange={(e) => setRecipe(e.target.value)}
            />
            {button('检查配方', () =>
              invoke('recipes', 'validate', {
                ...scope,
                name,
                inspection: fixed('inspect'),
                item,
                recipe: JSON.parse(recipe),
              }),
            )}
            {button('编译配方', () =>
              act('recipes', 'compile', {
                ...scope,
                name,
                inspection: fixed('inspect'),
                item,
                recipe: JSON.parse(recipe),
              }),
            )}
            <p>
              图片保留透明度并归一化方向；视频固定为 12 帧/秒；音频采用固定响度处理并输出 16 kHz 单声道 WAV。
            </p>
          </article>
          <article>
            <h2>转换与输出核验</h2>
            {selector('recipes')}
            {button(
              '加入转换批次',
              async () => {
                const reference = fixed('recipes');
                if (recipeQueue.some((x) => key(x.reference) === key(reference)))
                  throw new Error('该配方已在批次中');
                setRecipeQueue((old) => [...old, { reference, name: chosen('recipes')!.name }]);
              },
              recipeQueue.length >= 3,
            )}
            <ul>
              {recipeQueue.map((entry, i) => (
                <li key={key(entry.reference)}>
                  {entry.name}
                  <button
                    disabled={busy}
                    onClick={() => setRecipeQueue((old) => old.filter((_, j) => j !== i))}
                  >
                    移出转换批次
                  </button>
                </li>
              ))}
            </ul>
            {button('预览转换任务', () =>
              preview(
                'workers',
                'preview',
                {
                  ...scope,
                  name,
                  recipes: recipeQueue.length ? recipeQueue.map((x) => x.reference) : [fixed('recipes')],
                  image,
                },
                'start',
              ),
            )}
            {selector('workers')}
            {jobControls('workers')}
            {button('发布已验证输出', () => act('workers', 'publish', { ...scope, job: fixed('workers') }))}
            <p>发布要求工具结果完整、输出重新解码通过、原副本清理已确认。批次失败时只保留已验证项目。</p>
            <pre>
              {JSON.stringify(
                job.success
                  ? { session: job.data.session, result: job.data.result, published: job.data.published }
                  : null,
                null,
                2,
              )}
            </pre>
          </article>
        </div>
      )}
      {workspaceId && tab === 2 && (
        <>
          <article>
            <h2>查看实际输出</h2>
            {selector('workers')}
            <label>
              输出
              <select
                aria-label="已发布输出"
                value={output}
                onChange={(e) => {
                  setOutput(+e.target.value);
                  clearPreview();
                }}
              >
                {published.map((p, i) => (
                  <option key={p.key + p.name} value={i}>
                    {p.name} · {p.facts.width} × {p.facts.height} · {p.facts.durationMs} ms
                  </option>
                ))}
              </select>
            </label>
            {button('载入实际预览', showOutput, !current)}
            {previewMedia &&
              (previewMedia.format === 'mp4' ? (
                <video controls src={previewMedia.url} style={{ maxWidth: '100%' }} />
              ) : previewMedia.format === 'wav' ? (
                <audio controls src={previewMedia.url} />
              ) : (
                <img src={previewMedia.url} alt={previewMedia.name} style={{ maxWidth: '100%' }} />
              ))}
          </article>
          <div className="suite-grid">
            <article>
              <h2>手工字幕</h2>
              <label>
                语言
                <input value={language} onChange={(e) => setLanguage(e.target.value)} />
              </label>
              <textarea
                aria-label="SRT 字幕"
                rows={8}
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
              />
              {button(
                '检查字幕时间',
                () =>
                  invoke('captions', 'validateTiming', {
                    ...scope,
                    name,
                    source: current.source,
                    job: fixed('workers'),
                    durationMs: current.facts.durationMs,
                    language,
                    text: captionText,
                  }),
                !current,
              )}
              {button(
                '保存字幕',
                () =>
                  act('captions', 'importText', {
                    ...scope,
                    name,
                    source: current.source,
                    job: fixed('workers'),
                    durationMs: current.facts.durationMs,
                    language,
                    text: captionText,
                  }),
                !current,
              )}
              {selector('captions')}
              {button('生成 SRT 文件', () =>
                act('captions', 'exportText', { ...scope, caption: fixed('captions') }),
              )}
              <p>时间范围依据所选实际输出时长；重叠、越界和标签文本会被拒绝。</p>
            </article>
            <article>
              <h2>交付文件映射</h2>
              <label>
                集合内文件名
                <input value={entryName} onChange={(e) => setEntryName(e.target.value)} />
              </label>
              {button(
                '加入所选媒体',
                async () => {
                  if (!current) throw new Error('请选择输出');
                  setEntries((old) => [
                    ...old,
                    { name: entryName, source: current.source, job: fixed('workers'), caption: null },
                  ]);
                },
                !current,
              )}
              {selector('sources')}
              {button(
                '加入所选 SRT',
                async () => {
                  setEntries((old) => [
                    ...old,
                    { name: entryName, source: fixed('sources'), job: null, caption: fixed('captions') },
                  ]);
                },
                !caption.success,
              )}
              <ul>
                {entries.map((e, i) => (
                  <li key={i}>
                    {e.name}
                    <button
                      disabled={busy}
                      onClick={() => setEntries((old) => old.filter((_, j) => i !== j))}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
              {button(
                '封存资源集合',
                () => act('collections', 'assemble', { ...scope, name, entries }),
                !entries.length,
              )}
              {selector('collections')}
            </article>
          </div>
        </>
      )}
      {workspaceId && tab === 3 && (
        <>
          <article>
            <h2>人工审核与许可</h2>
            {selector('collections')}
            {button('打开集合审阅', () =>
              act('reviews', 'open', { ...scope, collection: fixed('collections') }),
            )}
            {selector('reviews')}
            <label>
              观察和问题
              <textarea value={observations} onChange={(e) => setObservations(e.target.value)} />
            </label>
            <label>
              <input type="checkbox" checked={human} onChange={(e) => setHuman(e.target.checked)} />
              我已打开实际输出，检查内容、尺寸、方向、时间和许可
            </label>
            {(['accepted', 'rejected', 'withdrawn'] as const).map((decision, i) =>
              button(
                ['接受集合', '拒绝集合', '撤回接受'][i],
                () =>
                  act('reviews', 'decide', {
                    ...scope,
                    review: fixed('reviews'),
                    decision,
                    observations,
                    humanPreviewed: true,
                  }),
                !human || !observations.trim(),
              ),
            )}
            {selector('sources')}
            {button('预览允许所选材料导出', async () => {
              const r = fixed('sources'),
                p = await invoke<{ revision: number }>('sources', 'policy', {
                  ...scope,
                  id: r.id,
                  revision: r.revision,
                });
              await preview(
                'sources',
                'planPolicy',
                {
                  ...scope,
                  id: r.id,
                  revision: r.revision,
                  expectedPolicyRevision: p.revision,
                  allowRead: true,
                  allowExport: true,
                },
                'applyPolicy',
              );
            })}
            <p>导出必须同时获得原始材料和派生文件的许可。已撤回或被后续修订替代的审核不能导出。</p>
          </article>
          <SuiteExchangePanel
            invoke={invoke}
            workspaceId={workspaceId}
            domains={{ reviews: '已接受审核' }}
            records={rows}
            transfers={transfers}
            busy={busy}
            run={run}
            preview={preview}
            onAccepted={refresh}
            downloadName="media-studio.sakura"
            description="交接包含固定材料、配方、字幕、核验和人工审核记录。来源声明不携带本机执行权限，离线核验不代替实际解码。"
          />
        </>
      )}
      {workspaceId && tab === 4 && (
        <article>
          <h2>修订、归档与清理</h2>
          <label>
            领域
            <select value={history} onChange={(e) => setHistory(e.target.value as Domain)}>
              {Object.entries(titles).map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          {selector(history)}
          {button(
            '读取下一页',
            async () => {
              const existing = rows[history] ?? [],
                page = await invoke<S.SuitePage>(history, 'list', {
                  ...scope,
                  limit: 30,
                  cursor: cursor[history],
                  history: true,
                  archived: true,
                });
              setRows((old) => ({ ...old, [history]: [...existing, ...page.items] }));
              setCursor((old) => ({ ...old, [history]: page.next }));
            },
            cursor[history] == null,
          )}
          {button('归档所选修订', () => {
            const r = fixed(history);
            return act(history, 'archive', { ...scope, id: r.id, revision: r.revision });
          })}
          {button('预览清理所选修订', () =>
            preview(history, 'previewCleanup', { ...scope, references: [fixed(history)] }, 'cleanup'),
          )}
          <SuitePublicationRecoveryPanel
            domain={history}
            workspaceId={workspaceId}
            invoke={invoke}
            run={run}
            preview={preview}
          />
          <pre>{JSON.stringify(chosen(history)?.content ?? null, null, 2)}</pre>
        </article>
      )}
      {plan && (
        <SuitePlanDialog
          value={plan.value}
          busy={busy}
          onCancel={() => {
            const p = plan;
            setPlan(null);
            if (['media-inspect', 'media-transform'].includes(p.value.action))
              void run(
                () =>
                  invoke(p.domain, 'discardPreview', {
                    workspaceId: p.value.workspaceId,
                    planId: p.value.id,
                    digest: p.value.digest,
                  }),
                '已撤销预览并释放输入额度',
              );
          }}
          onApprove={() =>
            void run(async () => {
              const p = plan;
              await act(p.domain, p.apply, {
                workspaceId: p.value.workspaceId,
                planId: p.value.id,
                digest: p.value.digest,
              });
              setPlan(null);
            })
          }
        />
      )}
    </section>
  );
}
