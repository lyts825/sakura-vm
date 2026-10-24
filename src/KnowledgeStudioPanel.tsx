/** 知识流程工作台：显式选择、固定预览和人工审阅。 Explicit selections, pinned previews and human decisions. */
import { useEffect, useRef, useState } from 'react';
import './plugin-fonts.css';
import type { Request } from './feature-shared';
import * as K from '../shared/contracts/knowledge-studio';
import { knowledgeHttpSchemas, type KnowledgeDomain } from '../shared/contracts/knowledge-http';
import './knowledge-studio.css';
const pin = (v: K.Ref) => ({ id: v.id, revision: v.revision });
const key = (v: K.Ref) => `${v.id}:${v.revision}`;
const pages = ['材料', '检索与引用', '条目', '文稿', '审阅', '本机阅读', '离线交接', '任务与清理'] as const;
type View = {
  space: K.Space;
  sources: K.Source[];
  entries: K.Entry[];
  documents: K.Document[];
  reviews: K.Review[];
  jobs: K.Job[];
  capacity: { used: number; reserved: number; totalLimit: number; recoveryReserve: number };
};
export function KnowledgeStudioPanel({
  request,
  authorized = true,
  accessEpoch,
}: {
  request: Request;
  authorized?: boolean;
  accessEpoch?: string;
}) {
  const [spaces, setSpaces] = useState<K.Space[]>([]),
    [spaceId, setSpace] = useState(''),
    [view, setView] = useState<View>(),
    [page, setPage] = useState<(typeof pages)[number]>('材料'),
    [name, setName] = useState(''),
    [template, setTemplate] = useState<K.Document['template']>('handover'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>([]),
    [extractions, setExtractions] = useState<K.Extraction[]>([]),
    [selectedExtracts, setSelectedExtracts] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState<K.Search>(),
    [citations, setCitations] = useState<K.Citation[]>([]),
    [selectedCites, setSelectedCites] = useState<string[]>([]),
    [conflicts, setConflicts] = useState<string[]>([]);
  const [entryTitle, setEntryTitle] = useState(''),
    [assertion, setAssertion] = useState(''),
    [kind, setKind] = useState<K.Entry['assertions'][number]['kind']>('unverified'),
    [conditions, setConditions] = useState(''),
    [resolution, setResolution] = useState(''),
    [verification, setVerification] = useState(''),
    [editingEntry, setEditingEntry] = useState<K.Entry>();
  const [docTitle, setDocTitle] = useState(''),
    [scope, setScope] = useState(''),
    [sectionText, setSectionText] = useState<Record<string, string>>({}),
    [selectedEntries, setSelectedEntries] = useState<string[]>([]),
    [document, setDocument] = useState<K.Document>(),
    [review, setReview] = useState<K.Review>(),
    [checks, setChecks] = useState<string[]>([]),
    [reviewNote, setReviewNote] = useState('');
  const [publication, setPublication] = useState<K.Publication>(),
    [history, setHistory] = useState<
      { id: string; revision: number; document: K.Ref; withdrawn: boolean; active: boolean }[]
    >([]),
    [quarantine, setQuarantine] = useState<K.Quarantine>(),
    [importHistory, setImportHistory] = useState<K.Quarantine[]>([]),
    [mode, setMode] = useState<'reading' | 'handover'>('handover'),
    [exportAllowed, setExportAllowed] = useState(false);
  const [vmId, setVm] = useState(''),
    [projectId, setProject] = useState(''),
    [configRevision, setConfig] = useState(''),
    [paths, setPaths] = useState(''),
    [redactRange, setRedactRange] = useState('');
  const [refreshCapture, setRefreshCapture] = useState(false);
  const [migrationTarget, setMigrationTarget] = useState(''),
    [migration, setMigration] = useState<{
      target: K.Ref;
      candidates: { start: number; end: number; locator: string }[];
      ambiguous: boolean;
    }>();
  const [plan, setPlan] = useState<{ value: K.Plan; domain: KnowledgeDomain; method: string }>();
  const controller = useRef(new AbortController());
  const invoke = async <T,>(domain: KnowledgeDomain, method: string, input: unknown): Promise<T> => {
    const schema = (
      knowledgeHttpSchemas[domain] as Record<
        string,
        { request: import('zod').z.ZodType; response: import('zod').z.ZodType }
      >
    )[method];
    const signal = controller.current.signal;
    const result = await request(
      `/knowledge-${domain}/${method}`,
      'POST',
      schema.request.parse(input),
      signal,
    );
    signal.throwIfAborted();
    return schema.response.parse(result) as T;
  };
  const clearContent = () => {
    setView(undefined);
    setSearch(undefined);
    setPublication(undefined);
    setReview(undefined);
    setDocument(undefined);
    setCitations([]);
    setExtractions([]);
    setSelectedSources([]);
    setSelectedExtracts([]);
    setSelectedCites([]);
    setSelectedEntries([]);
    setPlan(undefined);
    setEntryTitle('');
    setAssertion('');
    setConditions('');
    setResolution('');
    setVerification('');
    setEditingEntry(undefined);
    setDocTitle('');
    setScope('');
    setSectionText({});
    setConflicts([]);
    setChecks([]);
    setReviewNote('');
    setQuarantine(undefined);
    setImportHistory([]);
    setMigration(undefined);
    setHistory([]);
    setNotice('');
  };
  useEffect(() => {
    controller.current.abort();
    controller.current = new AbortController();
    clearContent();
    const signal = controller.current.signal;
    if (authorized) {
      void (async () => {
        setSpaces(await invoke('sources', 'listSpaces', {}));
        if (spaceId) setView(await invoke('workbench', 'view', { spaceId }));
      })().catch((error) => {
        if (!signal.aborted) setError(error instanceof Error ? error.message : String(error));
      });
    } else setSpaces([]);
    return () => controller.current.abort();
  }, [spaceId, request, authorized, accessEpoch]);
  const refresh = async () => {
    setSpaces(await invoke('sources', 'listSpaces', {}));
    if (spaceId) setView(await invoke('workbench', 'view', { spaceId }));
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSearch(undefined);
      setPublication(undefined);
      if (/401|403|锁|许可|撤销/.test(String(e))) clearContent();
    } finally {
      setBusy(false);
    }
  };
  const preview = async (domain: KnowledgeDomain, method: string, input: unknown, apply: string) => {
    const value = await invoke<K.Plan>(domain, method, input);
    setPlan({ value, domain, method: apply });
  };
  const toggle = (values: string[], value: string, set: (v: string[]) => void) =>
    set(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  const pick = (value: string, items: K.Ref[]) => items.find((v) => key(v) === value);
  const loadDocuments = async () => {
    setView(await invoke('workbench', 'view', { spaceId }));
  };
  const download = (filename: string, value: unknown) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/octet-stream' }));
    const a = globalThis.document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (file: File) => {
    if (file.size > 8 * 1024 ** 2) throw new Error('文本上限 8 MiB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const ext = file.name.split('.').at(-1)?.toLowerCase();
    if (['pdf', 'docx', 'xlsx', 'zip', 'png', 'svg'].includes(ext || ''))
      throw new Error('首版只接受 UTF-8 文本、Markdown、JSON、CSV 和静态 HTML');
    const format =
      ext === 'md'
        ? 'markdown'
        : ext === 'json'
          ? 'json'
          : ext === 'csv'
            ? 'csv'
            : ext === 'html' || ext === 'htm'
              ? 'html'
              : 'text';
    await invoke('sources', 'upload', {
      spaceId,
      name: file.name,
      format,
      data: btoa(binary),
      policy: { ...K.defaultPolicy, export: exportAllowed },
    });
    await refresh();
  };
  if (!authorized)
    return (
      <section className="knowledge-studio" aria-label="知识工作台已锁定">
        会话已锁定，知识内容已清空。
      </section>
    );
  return (
    <section className="knowledge-studio" aria-label="知识工作台">
      <header>
        <div>
          <p className="knowledge-eyebrow">KNOWLEDGE STUDIO</p>
          <h1>项目知识与文档</h1>
          <p>材料固定版本 · 引用可复核 · 单人分阶段审阅</p>
        </div>
        <button disabled={busy} onClick={() => run(refresh)}>
          刷新空间
        </button>
      </header>
      <div className="knowledge-space">
        <label>
          知识空间
          <select value={spaceId} onChange={(e) => setSpace(e.target.value)}>
            <option value="">请选择空间</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.revoked ? '（已撤销）' : ''}
              </option>
            ))}
          </select>
        </label>
        {spaces.find((s) => s.id === spaceId)?.revoked && (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const current = spaces.find((s) => s.id === spaceId)!;
                await invoke('sources', 'revokeSpace', {
                  spaceId,
                  expectedRevision: current.revision,
                  revoked: false,
                });
                await refresh();
              })
            }
          >
            恢复此空间访问
          </button>
        )}
        <input
          aria-label="新空间名称"
          placeholder="新空间名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={!name || busy}
          onClick={() =>
            run(async () => {
              const s = await invoke<K.Space>('sources', 'createSpace', { name });
              setSpaces(await invoke('sources', 'listSpaces', {}));
              setSpace(s.id);
            })
          }
        >
          创建空间
        </button>
        <select
          aria-label="模板"
          value={template}
          onChange={(e) => setTemplate(e.target.value as K.Document['template'])}
        >
          {Object.keys(K.knowledgeTemplates).map((t) => (
            <option value={t} key={t}>
              {
                {
                  handover: '项目交接手册',
                  operations: '运维操作手册',
                  decision: '决策记录',
                  glossary: '术语与问答',
                }[t]
              }
            </option>
          ))}
        </select>
        <button
          disabled={!name || busy}
          onClick={() =>
            run(async () => {
              const r = await invoke<{ space: K.Space }>('workbench', 'example', { name, template });
              setSpaces(await invoke('sources', 'listSpaces', {}));
              setSpace(r.space.id);
              setNotice('示例已导入；含冲突材料和更新来源。请显式选择材料后解析。');
            })
          }
        >
          导入虚构示例
        </button>
      </div>
      {!spaceId && (
        <div className="knowledge-empty">
          <h2>从固定材料开始</h2>
          <p>创建知识空间，或在“离线交接”中选择知识包。启用插件不会扫描文件、调用模型或执行材料。</p>
          <button onClick={() => setPage('离线交接')}>导入知识包</button>
        </div>
      )}
      <nav aria-label="知识流程">
        {pages.map((p) => (
          <button
            className={p === page ? 'active' : ''}
            key={p}
            onClick={() => {
              setPage(p);
              setPublication(undefined);
            }}
          >
            {p}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="knowledge-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && (
        <p role="status">
          正在执行并复核许可……{' '}
          <button
            onClick={() => {
              controller.current.abort();
              controller.current = new AbortController();
            }}
          >
            取消当前请求
          </button>
        </p>
      )}
      {spaceId && !view && <button onClick={() => run(refresh)}>读取空间状态</button>}
      {spaceId && page === '材料' && (
        <div className="knowledge-grid">
          <article>
            <h2>上传与许可</h2>
            <label>
              <input
                type="checkbox"
                checked={exportAllowed}
                onChange={(e) => setExportAllowed(e.target.checked)}
              />
              允许新上传材料离线导出
            </label>
            <input
              aria-label="上传材料"
              type="file"
              multiple
              disabled={busy}
              onChange={(e) => {
                const files = [...(e.target.files || [])];
                void run(async () => {
                  for (const f of files) await upload(f);
                });
                e.target.value = '';
              }}
            />
            <p>UTF-8 文本上限 8 MiB。内容不会执行；敏感提示不能发现所有秘密。</p>
            {view?.sources.map((s) => (
              <div className="knowledge-card" key={key(s)}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(key(s))}
                    onChange={() => toggle(selectedSources, key(s), setSelectedSources)}
                  />
                  {s.name} · 修订 {s.revision} · {s.bytes} B {s.revoked ? '已撤销' : ''}
                </label>
                <code>{s.digest}</code>
                {s.sensitive.map((v) => (
                  <p className="knowledge-error" key={v}>
                    {v}
                  </p>
                ))}
                <button
                  onClick={() =>
                    run(() =>
                      preview(
                        'sources',
                        'planPolicy',
                        {
                          spaceId,
                          id: s.id,
                          expectedRevision: s.policyRevision,
                          policy: { ...s.policy, export: !s.policy.export },
                          revoked: s.revoked,
                        },
                        'applyPolicy',
                      ),
                    )
                  }
                >
                  {s.policy.export ? '禁止导出' : '允许导出'}预览
                </button>
                <button
                  onClick={() =>
                    run(() =>
                      preview(
                        'sources',
                        'planPolicy',
                        {
                          spaceId,
                          id: s.id,
                          expectedRevision: s.policyRevision,
                          policy: s.policy,
                          revoked: !s.revoked,
                        },
                        'applyPolicy',
                      ),
                    )
                  }
                >
                  {s.revoked ? '恢复许可' : '撤销许可'}预览
                </button>
                <button
                  onClick={() =>
                    run(async () => {
                      const result = await invoke<{ digest: string }>('sources', 'verify', {
                        spaceId,
                        ...pin(s),
                        purpose: 'read',
                      });
                      setNotice('原字节通过 SHA-256 校验：' + result.digest);
                    })
                  }
                >
                  验证原字节
                </button>
              </div>
            ))}
            <button
              disabled={!selectedSources.length || busy}
              onClick={() =>
                run(() =>
                  preview(
                    'extract',
                    'plan',
                    { spaceId, sources: selectedSources.map((v) => pin(pick(v, view?.sources || [])!)) },
                    'run',
                  ),
                )
              }
            >
              预览解析选中版本
            </button>
            <label>
              脱敏字节区间（起点:终点）
              <input value={redactRange} onChange={(e) => setRedactRange(e.target.value)} />
            </label>
            <button
              disabled={selectedSources.length !== 1}
              onClick={() =>
                run(async () => {
                  const s = pick(selectedSources[0], view?.sources || [])!;
                  const [start, end] = redactRange.split(':').map(Number);
                  await invoke('sources', 'redact', {
                    spaceId,
                    ...pin(s),
                    purpose: 'read',
                    ranges: [{ start, end }],
                    name: '脱敏副本.txt',
                    policy: { ...K.defaultPolicy, export: exportAllowed },
                  });
                  await refresh();
                })
              }
            >
              创建独立脱敏副本
            </button>
          </article>
          <article>
            <h2>固定项目捕获</h2>
            <p>只复制显式路径，预览票据绑定原 VM、boot 和配置。要求已有项目身份及 python3。</p>
            {[
              [vmId, setVm, 'VM ID'],
              [projectId, setProject, '项目 ID'],
              [configRevision, setConfig, '配置 SHA-256'],
            ].map(([value, setter, label]) => (
              <label key={label as string}>
                {label as string}
                <input
                  value={value as string}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                />
              </label>
            ))}
            <label>
              相对路径，每行一项
              <textarea value={paths} onChange={(e) => setPaths(e.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={refreshCapture}
                onChange={(e) => setRefreshCapture(e.target.checked)}
              />
              刷新左侧选中来源（按唯一文件名匹配，创建新修订）
            </label>
            <button
              disabled={!vmId || !projectId || !configRevision || !paths || busy}
              onClick={() =>
                run(() =>
                  preview(
                    'sources',
                    'planCapture',
                    {
                      spaceId,
                      request: {
                        vmId,
                        projectId,
                        configRevision,
                        relativePaths: paths.split('\n').filter(Boolean),
                        maxBytes: 64 * 1024 ** 2,
                      },
                      policy: { ...K.defaultPolicy, export: exportAllowed },
                      ...(refreshCapture
                        ? {
                            refresh: selectedSources.map((value) => {
                              const source = view!.sources.find((s) => key(s) === value)!;
                              const matches = paths
                                .split('\n')
                                .filter((path) => path.split('/').at(-1) === source.name);
                              if (matches.length !== 1)
                                throw new Error('刷新路径必须与所选来源的文件名唯一匹配');
                              return {
                                path: matches[0],
                                sourceId: source.id,
                                expectedRevision: source.revision,
                              };
                            }),
                          }
                        : {}),
                    },
                    'capture',
                  ),
                )
              }
            >
              预览固定捕获
            </button>
            <h2>解析结果</h2>
            <button
              onClick={() => run(async () => setExtractions(await invoke('extract', 'list', { spaceId })))}
            >
              读取解析版本
            </button>
            {extractions.map((e) => (
              <details key={e.id}>
                <summary>
                  <input
                    aria-label="选择解析版本"
                    type="checkbox"
                    checked={selectedExtracts.includes(key(e))}
                    onChange={() => toggle(selectedExtracts, key(e), setSelectedExtracts)}
                  />
                  {e.source.id}@{e.source.revision} · {e.blocks.length} 块
                </summary>
                {e.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
                {e.blocks.map((b, i) => (
                  <p key={i}>
                    {b.locator} [{b.start},{b.end})<br />
                    {b.text}
                  </p>
                ))}
              </details>
            ))}
            <button
              disabled={!selectedExtracts.length || busy}
              onClick={() =>
                run(() =>
                  preview(
                    'index',
                    'plan',
                    { spaceId, extractions: selectedExtracts.map((v) => pin(pick(v, extractions)!)) },
                    'build',
                  ),
                )
              }
            >
              预览固定索引
            </button>
          </article>
        </div>
      )}
      {spaceId && page === '检索与引用' && (
        <article>
          <h2>中文检索</h2>
          <div className="knowledge-line">
            <input
              aria-label="检索词"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例如：备份恢复"
            />
            <button
              disabled={!query || busy}
              onClick={() =>
                run(async () => setSearch(await invoke('index', 'search', { spaceId, query, limit: 50 })))
              }
            >
              搜索固定版本
            </button>
          </div>
          {search && (
            <p>
              索引修订 {search.generation.revision}；覆盖 {search.coverage.indexed} 个来源，遗漏{' '}
              {search.coverage.omitted} 个；{search.coverage.stale ? '需要重建' : '当前集合完整'}
            </p>
          )}
          {search?.hits.map((h, i) => (
            <div className="knowledge-card" key={i}>
              <p>{h.block.text}</p>
              <small>
                {h.source.id}@{h.source.revision} · {h.block.locator} · {h.block.start}–{h.block.end}
              </small>
              <button
                onClick={() =>
                  run(async () => {
                    const c = await invoke<K.Citation>('evidence', 'create', {
                      spaceId,
                      extraction: h.extraction,
                      start: h.block.start,
                      end: h.block.end,
                    });
                    setCitations(await invoke('evidence', 'list', { spaceId }));
                    setNotice('已建立固定引用 ' + c.id);
                  })
                }
              >
                建立引用
              </button>
            </div>
          ))}
          {search && !search.hits.length && <p>没有获准材料命中。请检查过滤条件、遗漏材料和固定索引日期。</p>}
          <button
            onClick={() => run(async () => setCitations(await invoke('evidence', 'list', { spaceId })))}
          >
            读取引用
          </button>
          <button
            onClick={() => run(async () => setExtractions(await invoke('extract', 'list', { spaceId })))}
          >
            读取引用迁移目标
          </button>
          <select
            aria-label="引用迁移目标解析"
            value={migrationTarget}
            onChange={(e) => setMigrationTarget(e.target.value)}
          >
            <option value="">请选择新解析版本</option>
            {extractions.map((e) => (
              <option key={key(e)} value={key(e)}>
                {e.source.id}@{e.source.revision}
              </option>
            ))}
          </select>
          {citations.map((c) => (
            <div className="knowledge-card" key={key(c)}>
              <blockquote>{c.quote}</blockquote>
              <small>{c.locator}</small>
              <button
                onClick={() =>
                  run(async () => {
                    const r = await invoke<K.EvidenceCheck>('evidence', 'check', {
                      spaceId,
                      ...pin(c),
                      purpose: 'read',
                    });
                    setNotice(
                      `完整性 ${r.integrity}；许可 ${r.permission}；更新 ${r.currency}；身份 ${r.authenticity}`,
                    );
                  })
                }
              >
                校验四维状态
              </button>
              <button
                disabled={!migrationTarget}
                onClick={() =>
                  run(async () => {
                    const target = pin(pick(migrationTarget, extractions)!);
                    const result = await invoke<{
                      candidates: { start: number; end: number; locator: string }[];
                      ambiguous: boolean;
                    }>('evidence', 'migrate', { spaceId, ...pin(c), purpose: 'cite', target });
                    setMigration({ target, ...result });
                  })
                }
              >
                预览迁移候选
              </button>
            </div>
          ))}
          {migration && (
            <div className="knowledge-card">
              <p>
                {migration.ambiguous
                  ? '位置有歧义或没有相同引文，请逐项核对。'
                  : '找到一个相同引文；仍需人工确认。'}
              </p>
              {migration.candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() =>
                    run(async () => {
                      await invoke('evidence', 'create', {
                        spaceId,
                        extraction: migration.target,
                        start: c.start,
                        end: c.end,
                      });
                      setCitations(await invoke('evidence', 'list', { spaceId }));
                      setMigration(undefined);
                      setNotice('新引用已创建；原条目和文稿保持固定修订，请显式修订。');
                    })
                  }
                >
                  确认 {c.locator} [{c.start},{c.end})
                </button>
              ))}
            </div>
          )}
        </article>
      )}
      {spaceId && page === '条目' && (
        <article>
          <h2>{editingEntry ? '修订条目' : '新知识条目'}</h2>
          <label>
            标题
            <input value={entryTitle} onChange={(e) => setEntryTitle(e.target.value)} />
          </label>
          <label>
            陈述类别
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {['fact', 'judgment', 'procedure', 'unverified'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            陈述
            <textarea value={assertion} onChange={(e) => setAssertion(e.target.value)} />
          </label>
          <label>
            适用条件
            <input value={conditions} onChange={(e) => setConditions(e.target.value)} />
          </label>
          <button
            onClick={() => run(async () => setCitations(await invoke('evidence', 'list', { spaceId })))}
          >
            选择固定引用
          </button>
          {citations.map((c) => (
            <div key={key(c)}>
              <label>
                <input
                  type="checkbox"
                  checked={selectedCites.includes(key(c))}
                  onChange={() => toggle(selectedCites, key(c), setSelectedCites)}
                />
                支持：{c.quote.slice(0, 100)}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={conflicts.includes(key(c))}
                  onChange={() => toggle(conflicts, key(c), setConflicts)}
                />
                相反依据
              </label>
            </div>
          ))}
          <label>
            人工判断与冲突处理
            <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </label>
          <label>
            人工验证说明
            <textarea value={verification} onChange={(e) => setVerification(e.target.value)} />
          </label>
          <button
            disabled={!entryTitle || !assertion || !conditions || busy}
            onClick={() =>
              run(async () => {
                await invoke('entries', editingEntry ? 'revise' : 'create', {
                  spaceId,
                  title: entryTitle,
                  assertions: [
                    {
                      text: assertion,
                      kind,
                      applicability: conditions,
                      supports: selectedCites.map((v) => pin(pick(v, citations)!)),
                      conflicts: conflicts.map((v) => pin(pick(v, citations)!)),
                      resolution,
                      verification,
                    },
                  ],
                  ...(editingEntry ? { id: editingEntry.id, expectedRevision: editingEntry.revision } : {}),
                });
                setEditingEntry(undefined);
                await refresh();
              })
            }
          >
            保存固定修订
          </button>
          {view?.entries.map((e) => (
            <div className="knowledge-card" key={key(e)}>
              <h3>
                {e.title} · 修订 {e.revision}
              </h3>
              <button
                onClick={() => {
                  const a = e.assertions[0];
                  setEditingEntry(e);
                  setEntryTitle(e.title);
                  setAssertion(a.text);
                  setKind(a.kind);
                  setConditions(a.applicability);
                  setResolution(a.resolution);
                  setVerification(a.verification);
                  setSelectedCites(a.supports.map(key));
                  setConflicts(a.conflicts.map(key));
                }}
              >
                编辑此修订
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    await invoke('entries', 'archive', { spaceId, id: e.id, expectedRevision: e.revision });
                    await refresh();
                  })
                }
              >
                归档
              </button>
            </div>
          ))}
        </article>
      )}
      {spaceId && page === '文稿' && (
        <article>
          <h2>固定模板文稿</h2>
          <label>
            标题
            <input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
          </label>
          <label>
            适用版本与范围
            <input value={scope} onChange={(e) => setScope(e.target.value)} />
          </label>
          <p>模板由页首选择。选择的条目固定加入首章，其余章节可补充人工说明。</p>
          {view?.entries
            .filter((e) => !e.archived)
            .map((e) => (
              <label key={key(e)}>
                <input
                  type="checkbox"
                  checked={selectedEntries.includes(key(e))}
                  onChange={() => toggle(selectedEntries, key(e), setSelectedEntries)}
                />
                {e.title}@{e.revision}
              </label>
            ))}
          {K.knowledgeTemplates[template].map((h) => (
            <label key={h}>
              {h}
              <textarea
                value={sectionText[h] || ''}
                onChange={(e) => setSectionText({ ...sectionText, [h]: e.target.value })}
              />
            </label>
          ))}
          <button
            disabled={!docTitle || !scope || busy}
            onClick={() =>
              run(async () => {
                const d = await invoke<K.Document>('documents', document ? 'revise' : 'create', {
                  spaceId,
                  title: docTitle,
                  template,
                  applicability: scope,
                  sections: K.knowledgeTemplates[template].map((heading, i) => ({
                    heading,
                    text: sectionText[heading] || '',
                    entries: i === 0 ? selectedEntries.map((v) => pin(pick(v, view?.entries || [])!)) : [],
                    citations: [],
                  })),
                  ...(document ? { id: document.id, expectedRevision: document.revision } : {}),
                });
                setDocument(d);
                await refresh();
              })
            }
          >
            保存文稿修订
          </button>
          <button onClick={() => setDocument(undefined)}>新建文稿</button>
          {view?.documents.map((d) => (
            <div className="knowledge-card" key={key(d)}>
              <h3>
                {d.title}@{d.revision}
              </h3>
              <button
                onClick={() => {
                  setDocument(d);
                  setDocTitle(d.title);
                  setScope(d.applicability);
                  setTemplate(d.template);
                  setSectionText(Object.fromEntries(d.sections.map((s) => [s.heading, s.text])));
                  setSelectedEntries(d.sections.flatMap((s) => s.entries.map(key)));
                }}
              >
                选择并编辑
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    setReview(await invoke('reviews', 'open', { spaceId, document: pin(d) }));
                    setChecks([]);
                    setPage('审阅');
                  })
                }
              >
                生成审阅清单
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    await invoke('documents', 'archive', { spaceId, id: d.id, expectedRevision: d.revision });
                    await refresh();
                  })
                }
              >
                归档
              </button>
            </div>
          ))}
        </article>
      )}
      {spaceId && page === '审阅' && (
        <article>
          <h2>单人分阶段审阅</h2>
          <select
            aria-label="固定审阅"
            value={review ? key(review) : ''}
            onChange={(e) => {
              setReview(view?.reviews.find((r) => key(r) === e.target.value));
              setChecks([]);
            }}
          >
            <option value="">选择审阅</option>
            {view?.reviews.map((r) => (
              <option key={key(r)} value={key(r)}>
                {r.id}@{r.revision} · {r.decision}
              </option>
            ))}
          </select>
          {review?.issues.map((i) => (
            <label key={i.id} className="knowledge-card">
              <input
                type="checkbox"
                disabled={i.blocking}
                checked={checks.includes(i.id)}
                onChange={() => toggle(checks, i.id, setChecks)}
              />
              {i.blocking ? '必须修订：' : '人工确认：'}
              {i.message}
            </label>
          ))}
          <label>
            审阅说明
            <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
          </label>
          {(['accepted', 'changes-requested', 'revoked'] as const).map((decision) => (
            <button
              key={decision}
              disabled={!review || !reviewNote || busy}
              onClick={() =>
                run(async () => {
                  const r = await invoke<K.Review>('reviews', 'decide', {
                    spaceId,
                    id: review!.id,
                    expectedRevision: review!.revision,
                    decision,
                    acknowledgements: checks,
                    note: reviewNote,
                  });
                  setReview(r);
                  await refresh();
                })
              }
            >
              {{ accepted: '接受此用途', 'changes-requested': '要求修订', revoked: '撤销审阅' }[decision]}
            </button>
          ))}
          {review?.decision === 'accepted' && (
            <button
              onClick={() =>
                run(() =>
                  preview(
                    'publish',
                    'plan',
                    { spaceId, document: review.document, review: pin(review) },
                    'apply',
                  ),
                )
              }
            >
              预览本机发布
            </button>
          )}
        </article>
      )}
      {spaceId && page === '本机阅读' && (
        <article>
          <h2>本机认证阅读</h2>
          <button
            onClick={() =>
              run(async () => {
                setPublication(await invoke('publish', 'read', { spaceId }));
                setHistory(await invoke('publish', 'list', { spaceId }));
              })
            }
          >
            复核许可并阅读活跃版本
          </button>
          {publication && (
            <>
              <h3>{publication.output.title}</h3>
              <pre className="knowledge-reader">{publication.output.markdown}</pre>
              <button
                onClick={() =>
                  run(async () => {
                    await invoke('publish', 'withdraw', {
                      spaceId,
                      id: publication.id,
                      reason: '所有者主动撤回',
                    });
                    setPublication(undefined);
                  })
                }
              >
                撤回本机阅读
              </button>
            </>
          )}
          {history.map((p) => (
            <div className="knowledge-card" key={p.id}>
              {p.id} {p.active ? '当前' : ''} {p.withdrawn ? '已撤回' : ''}
              <button
                disabled={p.withdrawn}
                onClick={() => run(() => preview('publish', 'rollback', { spaceId, id: p.id }, 'apply'))}
              >
                预览回退到此版本
              </button>
            </div>
          ))}
        </article>
      )}
      {page === '离线交接' && (
        <div className="knowledge-grid">
          <article>
            <h2>导出固定文稿</h2>
            <p>导出需要已接受的审阅。阅读包不含完整原材料；交接包保留可复核证据。已下载文件不能远程收回。</p>
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="handover">可复核交接包</option>
              <option value="reading">阅读包</option>
            </select>
            <select
              aria-label="导出审阅"
              value={review ? key(review) : ''}
              onChange={(e) => setReview(view?.reviews.find((r) => key(r) === e.target.value))}
            >
              <option value="">请选择已接受审阅</option>
              {view?.reviews
                .filter((r) => r.decision === 'accepted')
                .map((r) => (
                  <option key={key(r)} value={key(r)}>
                    {r.id}@{r.revision}
                  </option>
                ))}
            </select>
            <button
              disabled={!spaceId || !review || busy}
              onClick={() =>
                run(() =>
                  preview(
                    'exchange',
                    'planExport',
                    { spaceId, document: review!.document, review: pin(review!), mode },
                    'export',
                  ),
                )
              }
            >
              预览导出清单
            </button>
          </article>
          <article>
            <h2>隔离导入</h2>
            <button
              disabled={busy}
              onClick={() => run(async () => setImportHistory(await invoke('exchange', 'imports', {})))}
            >
              查看隔离记录与中断恢复
            </button>
            {importHistory.length > 0 && (
              <select
                aria-label="隔离接收记录"
                value={quarantine?.id ?? ''}
                onChange={(e) => setQuarantine(importHistory.find((q) => q.id === e.target.value))}
              >
                <option value="">请选择隔离记录</option>
                {importHistory.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.createdAt} · {q.state} · {q.id}
                  </option>
                ))}
              </select>
            )}
            <input
              type="file"
              accept=".json,.knowledge"
              aria-label="选择离线包"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void run(async () => {
                    if (file.size > 24 * 1024 ** 2) throw new Error('包超过 24 MiB');
                    setQuarantine(
                      await invoke('exchange', 'inspectImport', { bundle: JSON.parse(await file.text()) }),
                    );
                  });
                e.target.value = '';
              }}
            />
            {quarantine && (
              <>
                <p>状态：{quarantine.state}。来源身份未认证。</p>
                {quarantine.issues.map((i, n) => (
                  <p key={n}>{i}</p>
                ))}
                <label>
                  接收空间名称
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <button
                  disabled={quarantine.state !== 'checked' || !name || busy}
                  onClick={() =>
                    run(async () => {
                      const q = await invoke<K.Quarantine>('exchange', 'acceptImport', {
                        id: quarantine.id,
                        name,
                        acceptUnverified: true,
                      });
                      setQuarantine(q);
                      setSpaces(await invoke('sources', 'listSpaces', {}));
                      setNotice('已创建新 ID 映射。请在接收空间重新审阅；未自动建立索引或发布。');
                    })
                  }
                >
                  接受未认证来源并创建新空间
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () =>
                      setQuarantine(await invoke('exchange', 'discardImport', { id: quarantine.id })),
                    )
                  }
                >
                  删除隔离包字节，保留回执
                </button>
              </>
            )}
          </article>
        </div>
      )}
      {spaceId && page === '任务与清理' && (
        <article>
          <h2>任务与容量</h2>
          <button onClick={() => run(refresh)}>复核状态</button>
          <p>
            占用 {view?.capacity.used ?? 0} B；未结算预留 {view?.capacity.reserved ?? 0}{' '}
            B。停用插件会保留材料。
          </p>
          {view?.jobs.map((j) => (
            <div key={j.id} className="knowledge-card">
              {j.kind}：{j.state}
              <p>{j.error}</p>
              {j.state === 'running' && (
                <button
                  onClick={() =>
                    run(async () => {
                      await invoke(j.kind === 'index' ? 'index' : 'extract', 'cancel', { spaceId, id: j.id });
                      await refresh();
                    })
                  }
                >
                  取消并等待核销
                </button>
              )}
            </div>
          ))}
          <button onClick={() => run(() => preview('sources', 'planCleanup', { spaceId }, 'cleanup'))}>
            预览未引用字节清理
          </button>
          {view && (
            <button
              onClick={() =>
                run(async () => {
                  await invoke('sources', 'revokeSpace', {
                    spaceId,
                    expectedRevision: view.space.revision,
                    revoked: true,
                  });
                  clearContent();
                })
              }
            >
              撤销整个空间的新读取
            </button>
          )}
        </article>
      )}
      {plan && (
        <div className="knowledge-plan" role="dialog" aria-modal="true" aria-label="固定计划确认">
          <h2>确认固定计划</h2>
          <p>有效期至 {plan.value.expiresAt}</p>
          <code>{plan.value.digest}</code>
          <ul>
            {plan.value.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const pending = plan;
                setPlan(undefined);
                const result = await invoke<unknown>(pending.domain, pending.method, {
                  spaceId: pending.value.spaceId,
                  token: pending.value.token,
                });
                if (pending.domain === 'exchange' && pending.method === 'export') {
                  const out = result as { id: string };
                  download(
                    'knowledge-' + out.id + '.knowledge',
                    await invoke('exchange', 'download', { spaceId: pending.value.spaceId, id: out.id }),
                  );
                } else if (pending.domain === 'extract') {
                  setExtractions(result as K.Extraction[]);
                } else if (pending.domain === 'publish') {
                  setPublication(result as K.Publication);
                  setPage('本机阅读');
                }
                setNotice('操作已完成并通过返回契约验证。');
                await refresh();
              })
            }
          >
            确认执行
          </button>
          <button disabled={busy} onClick={() => setPlan(undefined)}>
            取消计划
          </button>
        </div>
      )}
    </section>
  );
}
