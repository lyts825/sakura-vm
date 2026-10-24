/** 固定目录、逐键编辑、检查预览、审阅与本机语言交付。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Request } from './feature-shared';
import type * as S from '../shared/contracts/suite-common';
import * as L from '../shared/contracts/locale-studio';
import { localeHttpSchemas, type LocaleDomain } from '../shared/contracts/locale-http';
import {
  useSuiteClient,
  suiteReference as ref,
  suiteReferenceKey as key,
  suiteDigest,
  suiteBase64,
  suiteDownload,
} from './suite-client';
import { SuiteRecordSelect } from './SuiteRecordSelect';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import './suite-workbench.css';
const domains: Record<LocaleDomain, string> = {
  catalogs: '语言目录',
  contexts: '上下文',
  terminology: '术语',
  translations: '译文',
  checks: '质量检查',
  previews: '组件预览',
  reviews: '文案审阅',
  releases: '语言版本',
  exchange: '离线交接',
  workbench: '步骤记录',
};
const tabs = [
  '开始',
  '目录',
  '上下文与术语',
  '译文',
  '检查与预览',
  '审阅与版本',
  '离线交接',
  '历史与清理',
  '领域操作',
] as const;
const format = (row?: S.SuiteRecord) =>
  row?.content && typeof row.content === 'object' && !Array.isArray(row.content)
    ? String(row.content.format ?? '')
    : '';
type Example = { workspace: S.SuiteWorkspace; example: S.SuiteRecord };
export function LocaleStudioPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: string;
  authorized?: boolean;
}) {
  const epoch = useMemo(() => crypto.randomUUID(), [request, accessEpoch]);
  return authorized ? <LocaleSpaces key={epoch} request={request} /> : <p>请解锁会话后查看本地化材料。</p>;
}
function LocaleSpaces({ request }: { request: Request }) {
  const invoke = useSuiteClient(request, 'locale', localeHttpSchemas);
  const [spaces, setSpaces] = useState<S.SuiteWorkspace[]>([]),
    [id, setId] = useState(''),
    [name, setName] = useState(''),
    [template, setTemplate] = useState('app-text'),
    [example, setExample] = useState<Example>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const reload = async () => setSpaces(await invoke('catalogs', 'listWorkspaces'));
  useEffect(() => {
    void reload().catch((error) => {
      if (error.name !== 'AbortError') setError(error.message);
    });
  }, []);
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      if (template === 'empty') {
        const space = await invoke<S.SuiteWorkspace>('catalogs', 'createWorkspace', { name });
        setExample(undefined);
        setId(space.id);
      } else {
        const result = await invoke<Example>('workbench', 'createExample', { name, template });
        setExample(result);
        setId(result.workspace.id);
      }
      await reload();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="suite-workbench">
      <header>
        <div>
          <small>LOCALIZATION STUDIO</small>
          <h1>本地化交付</h1>
          <p>整理源文、编辑译文，在固定修订上检查、审阅并交付语言文件。</p>
        </div>
        <span className="suite-chip">人工编辑 · 10 个领域</span>
      </header>
      <section className="suite-space">
        <label>
          本地化空间
          <select
            aria-label="本地化空间"
            value={id}
            onChange={(event) => {
              setId(event.target.value);
              setExample(undefined);
            }}
          >
            <option value="">选择空间</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id} disabled={space.revoked}>
                {space.name}
                {space.revoked ? '（许可已撤销）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          新空间名称
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
        </label>
        <label>
          起点
          <select aria-label="起点" value={template} onChange={(event) => setTemplate(event.target.value)}>
            <option value="empty">空白空间</option>
            <option value="app-text">应用文案</option>
            <option value="error-messages">错误消息</option>
            <option value="source-update">源文更新</option>
          </select>
        </label>
        <button disabled={busy || !name.trim()} onClick={() => void create()}>
          创建空间
        </button>
      </section>
      {spaces
        .filter((space) => space.revoked)
        .map((space) => (
          <p key={space.id}>
            {space.name}
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await invoke('catalogs', 'revokeWorkspace', {
                    workspaceId: space.id,
                    expectedRevision: space.policyRevision,
                    revoked: false,
                  });
                  await reload();
                } catch (error) {
                  setError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              恢复空间许可
            </button>
          </p>
        ))}
      {error && (
        <p role="alert" className="suite-error">
          {error}
        </p>
      )}
      {id ? (
        <LocaleWorkspace
          key={id}
          request={request}
          workspaceId={id}
          example={example?.workspace.id === id ? example.example : undefined}
          onSpacesChanged={reload}
        />
      ) : (
        <section className="suite-empty">
          <h2>从固定文案开始</h2>
          <p>
            支持 UTF-8 JSON 字符串映射和简单占位符。创建样例只保存合成材料，运行检查与发布版本均由你显式提交。
          </p>
        </section>
      )}
    </main>
  );
}
function LocaleWorkspace({
  request,
  workspaceId,
  example,
  onSpacesChanged,
}: {
  request: Request;
  workspaceId: string;
  example?: S.SuiteRecord;
  onSpacesChanged: () => Promise<void>;
}) {
  const invoke = useSuiteClient(request, 'locale', localeHttpSchemas),
    s = { workspaceId };
  const [tab, setTab] = useState<(typeof tabs)[number]>('开始'),
    [pages, setPages] = useState<Partial<Record<LocaleDomain, S.SuitePage>>>({}),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [uploads, setUploads] = useState<S.SuiteUpload[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [result, setResult] = useState<S.SuiteRecord>();
  const alive = useRef(true),
    pending = useRef(false),
    previewSequence = useRef(0);
  const [plan, setPlan] = useState<{ value: S.SuitePlan; domain: string; action: string }>();
  const [capacity, setCapacity] = useState<{ used: number; reserved: number; limit: number }>();
  const [catalogId, setCatalogId] = useState(''),
    [translationId, setTranslationId] = useState(''),
    [termId, setTermId] = useState(''),
    [contextId, setContextId] = useState(''),
    [reviewId, setReviewId] = useState(''),
    [releaseId, setReleaseId] = useState('');
  const [language, setLanguage] = useState('en'),
    [role, setRole] = useState<'source' | 'target'>('source'),
    [file, setFile] = useState<File>(),
    [text, setText] = useState(''),
    [allowExport, setAllowExport] = useState(false),
    [uploadName, setUploadName] = useState('catalog.json');
  const [targetLanguage, setTargetLanguage] = useState('zh-CN'),
    [note, setNote] = useState(''),
    [acknowledged, setAcknowledged] = useState<string[]>([]),
    [fallback, setFallback] = useState<'reject' | 'source'>('reject');
  const [width, setWidth] = useState<'320' | '768' | '1280'>('320'),
    [pseudo, setPseudo] = useState(false),
    [before, setBefore] = useState('');
  const [domain, setDomain] = useState<LocaleDomain>('catalogs'),
    [method, setMethod] = useState('list'),
    [parameters, setParameters] = useState('{}');
  const rows = (d: LocaleDomain) => pages[d]?.items ?? [];
  const choose = (d: LocaleDomain, selected: string) => {
    const row = rows(d).find((row) => key(row) === selected);
    if (!row) throw new Error('请选择固定修订');
    return row;
  };
  const refresh = async () => {
    const data = await Promise.all(
      (Object.keys(domains) as LocaleDomain[]).map(
        async (d) =>
          [
            d,
            await invoke<S.SuitePage>(d, 'list', { ...s, limit: 50, history: true, archived: true }),
          ] as const,
      ),
    );
    const [nextCapacity, nextTransfers, nextUploads] = await Promise.all([
      invoke<typeof capacity>('catalogs', 'capacity', s),
      invoke<S.SuiteUpload[]>('exchange', 'transfers', s),
      invoke<S.SuiteUpload[]>('catalogs', 'uploads', s),
    ]);
    if (alive.current) {
      setPages(Object.fromEntries(data));
      setCapacity(nextCapacity);
      setTransfers(nextTransfers);
      setUploads(nextUploads);
    }
  };
  const run = async (work: () => Promise<unknown>, message = '操作已保存', reload = true) => {
    if (pending.current) return;
    pending.current = true;
    const beforePreview = previewSequence.current;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await work();
      if (!alive.current) return;
      if (value && typeof value === 'object' && 'revision' in value) setResult(value as S.SuiteRecord);
      if (reload && beforePreview === previewSequence.current) await refresh();
      if (alive.current) setNotice((current) => current || message);
    } catch (error) {
      if (alive.current && (error as Error).name !== 'AbortError') {
        setError((error as Error).message);
        if (/401|403|许可|撤销|认证/.test((error as Error).message)) {
          setPages({});
          setResult(undefined);
          setPlan(undefined);
          setTransfers([]);
          setUploads([]);
        }
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const preview = async (d: string, action: string, input: unknown, apply: string) => {
    const value = await invoke<S.SuitePlan>(d, action, input);
    previewSequence.current++;
    setPlan({ domain: d, action: apply, value });
  };
  useEffect(() => {
    alive.current = true;
    setBusy(true);
    void refresh()
      .then(() => {
        if (!alive.current) return;
        if (example?.content && typeof example.content === 'object' && !Array.isArray(example.content)) {
          const content = example.content;
          for (const [field, setter] of [
            ['catalog', setCatalogId],
            ['translation', setTranslationId],
            ['terminology', setTermId],
            ['contexts', setContextId],
          ] as const) {
            const value = Sref(content[field]);
            if (value) setter(key(value));
          }
        }
        setNotice('已打开本地化空间');
      })
      .catch((error) => {
        if (alive.current && error.name !== 'AbortError') setError(error.message);
      })
      .finally(() => {
        if (alive.current) setBusy(false);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const catalogRows = rows('catalogs').filter((row) => format(row) === 'sakura-locale-catalog/1');
  const sourceRows = catalogRows.filter(
    (row) => (row.content as Record<string, S.SuiteJson>).role === 'source',
  );
  const translationRows = rows('translations').filter(
    (row) => format(row) === 'sakura-locale-translations/1',
  );
  const releaseRows = rows('releases').filter((row) => format(row) === 'sakura-locale-release/1');
  const selectedCatalog = sourceRows.find((row) => key(row) === catalogId),
    selectedTranslation = translationRows.find((row) => key(row) === translationId),
    selectedReview = rows('reviews').find((row) => key(row) === reviewId);
  const catalog = useMemo(() => L.localeCatalog.safeParse(selectedCatalog?.content), [selectedCatalog]);
  const translation = useMemo(
    () => L.localeTranslation.safeParse(selectedTranslation?.content),
    [selectedTranslation],
  );
  const review = useMemo(() => L.localeReview.safeParse(selectedReview?.content), [selectedReview]);
  const checkRow = review.success
    ? rows('checks').find(
        (row) => row.id === review.data.check.id && row.revision === review.data.check.revision,
      )
    : undefined;
  const check = useMemo(() => L.localeCheck.safeParse(checkRow?.content), [checkRow]);
  const previewRow = [...rows('previews')].find((row) => format(row) === 'sakura-locale-preview/1');
  const previewValue = useMemo(() => L.localePreview.safeParse(previewRow?.content), [previewRow]);
  const uploadBytes = async (
    bytes: Uint8Array,
    name: string,
    format: 'json' | 'png' | 'jpeg',
    mayExport: boolean,
  ) => {
    if (bytes.length > 32 * 1024 ** 2) throw new Error('单个目录最多 32 MiB');
    const upload = await invoke<S.SuiteUpload>('catalogs', 'beginUpload', {
      ...s,
      name,
      format,
      bytes: bytes.length,
      digest: await suiteDigest(bytes),
      allowExport: mayExport,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await invoke('catalogs', 'appendUpload', {
        ...s,
        id: upload.id,
        offset,
        data: suiteBase64(bytes.subarray(offset, offset + 512 * 1024)),
      });
    return invoke<S.SuiteRecord>('catalogs', 'finishUpload', { ...s, id: upload.id });
  };
  const performChecks = async () => {
    const value = await invoke<{
      run: S.SuiteRecord;
      check: S.SuiteRecord;
      preview: S.SuiteRecord;
      review: S.SuiteRecord;
    }>('workbench', 'runChecks', {
      ...s,
      catalog: ref(choose('catalogs', catalogId)),
      translation: ref(choose('translations', translationId)),
      width,
      pseudo,
    });
    setResult(value.check);
    setReviewId(key(value.review));
    setAcknowledged([]);
    setTab('检查与预览');
  };
  return (
    <>
      <nav aria-label="本地化步骤">
        {tabs.map((label) => (
          <button key={label} className={tab === label ? 'active' : ''} onClick={() => setTab(label)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="suite-toolbar">
        <span>
          {capacity
            ? `已用 ${(capacity.used / 1024 ** 2).toFixed(1)} MiB · 预留 ${(capacity.reserved / 1024 ** 2).toFixed(1)} MiB · 总额 ${(capacity.limit / 1024 ** 2).toFixed(0)} MiB`
            : '正在核对容量'}
        </span>
        <button disabled={busy} onClick={() => void run(refresh, '已刷新', false)}>
          刷新
        </button>
      </div>
      {error && (
        <p role="alert" className="suite-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">正在处理，请稍候…</p>}
      <fieldset disabled={busy} className="suite-body">
        {tab === '开始' && (
          <section className="suite-empty">
            <h2>检查一组固定文案</h2>
            <p>选择源语言目录和目标译文。质量结果、组件预览和人工决定分别保存。</p>
            <SuiteRecordSelect title="源文目录" rows={sourceRows} value={catalogId} onChange={setCatalogId} />
            <SuiteRecordSelect
              title="目标译文"
              rows={translationRows}
              value={translationId}
              onChange={setTranslationId}
            />
            <button
              disabled={!catalogId || !translationId}
              onClick={() => void run(performChecks, '文案检查完成，等待人工审阅')}
            >
              运行文案检查
            </button>
            <button onClick={() => setTab('目录')}>导入自己的目录</button>
          </section>
        )}
        {tab === '目录' && (
          <div className="suite-columns">
            <article>
              <h2>导入 JSON 字符串映射</h2>
              <p>键可使用点分层级。占位符为 {'{name}'}，不接受复数表达式、HTML 或可执行模板。</p>
              <label>
                语言
                <input value={language} onChange={(event) => setLanguage(event.target.value)} />
              </label>
              <label>
                用途
                <select
                  aria-label="目录用途"
                  value={role}
                  onChange={(event) => setRole(event.target.value as 'source' | 'target')}
                >
                  <option value="source">源文</option>
                  <option value="target">已有目标语言</option>
                </select>
              </label>
              <label>
                材料名称
                <input value={uploadName} onChange={(event) => setUploadName(event.target.value)} />
              </label>
              <label>
                目录文件
                <input type="file" accept=".json" onChange={(event) => setFile(event.target.files?.[0])} />
              </label>
              <label>
                或粘贴 JSON
                <textarea
                  aria-label="目录 JSON"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={1024 * 1024}
                />
              </label>
              <label className="suite-check">
                <input
                  type="checkbox"
                  checked={allowExport}
                  onChange={(event) => setAllowExport(event.target.checked)}
                />
                允许原文随交接包导出
              </label>
              <button
                disabled={!file && !text.trim()}
                onClick={() =>
                  void run(async () => {
                    if (file && file.size > 32 * 1024 ** 2) throw new Error('单目录最多 32 MiB');
                    const bytes = file
                        ? new Uint8Array(await file.arrayBuffer())
                        : new TextEncoder().encode(text),
                      source = await uploadBytes(
                        bytes,
                        uploadName || file?.name || 'catalog.json',
                        'json',
                        allowExport,
                      );
                    const catalog = await invoke<S.SuiteRecord>('catalogs', 'importJson', {
                      ...s,
                      source: ref(source),
                      language,
                      role,
                    });
                    if (role === 'source') setCatalogId(key(catalog));
                    return catalog;
                  }, '目录已固定')
                }
              >
                上传并固定目录
              </button>
            </article>
            <article>
              <h2>目录与源文差异</h2>
              <SuiteRecordSelect
                title="源文目录"
                rows={sourceRows}
                value={catalogId}
                onChange={setCatalogId}
              />
              <SuiteRecordSelect title="比较原目录" rows={sourceRows} value={before} onChange={setBefore} />
              <button
                disabled={!before || !catalogId}
                onClick={() =>
                  void run(() =>
                    invoke('catalogs', 'compare', {
                      ...s,
                      before: ref(choose('catalogs', before)),
                      after: ref(choose('catalogs', catalogId)),
                    }),
                  )
                }
              >
                比较固定源文
              </button>
              {catalog.success && (
                <p>
                  {catalog.data.language} · {catalog.data.entries.length} 个键 · 原文摘要{' '}
                  {catalog.data.sourceDigest.slice(0, 12)}
                </p>
              )}
              <p>键重命名只生成候选，不自动合并或改写原目录。</p>
            </article>
          </div>
        )}
        {tab === '上下文与术语' && (
          <LocaleContextTerms
            invoke={invoke}
            workspaceId={workspaceId}
            catalog={selectedCatalog}
            rows={Object.fromEntries((Object.keys(domains) as LocaleDomain[]).map((d) => [d, rows(d)]))}
            termId={termId}
            contextId={contextId}
            setTermId={setTermId}
            setContextId={setContextId}
            run={run}
            uploadBytes={uploadBytes}
          />
        )}
        {tab === '译文' && (
          <section>
            <h2>编辑对应当前源文的译文</h2>
            <div className="suite-space">
              <SuiteRecordSelect
                title="源文目录"
                rows={sourceRows}
                value={catalogId}
                onChange={setCatalogId}
              />
              <SuiteRecordSelect
                title="目标译文"
                rows={translationRows}
                value={translationId}
                onChange={setTranslationId}
              />
              <SuiteRecordSelect
                title="术语修订"
                rows={rows('terminology')}
                value={termId}
                onChange={setTermId}
              />
              <SuiteRecordSelect
                title="上下文修订"
                rows={rows('contexts')}
                value={contextId}
                onChange={setContextId}
              />
              <label>
                目标语言
                <input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} />
              </label>
            </div>
            {catalog.success ? (
              <LocaleEditor
                key={catalogId + ':' + translationId}
                catalog={catalog.data}
                translation={translation.success ? translation.data : undefined}
                onSave={(items) =>
                  run(async () => {
                    const value = await invoke<S.SuiteRecord>('translations', 'revise', {
                      ...s,
                      ...(selectedTranslation
                        ? { id: selectedTranslation.id, expectedRevision: selectedTranslation.revision }
                        : {}),
                      name: `${targetLanguage} 译文`,
                      catalog: ref(selectedCatalog!),
                      language: targetLanguage,
                      terminology: ref(choose('terminology', termId)),
                      contexts: contextId ? ref(choose('contexts', contextId)) : null,
                      items,
                    });
                    setTranslationId(key(value));
                    return value;
                  }, '译文已对应当前源文保存')
                }
              />
            ) : (
              <p>先选择源文目录。</p>
            )}
            <button
              disabled={!selectedTranslation || !selectedCatalog}
              onClick={() =>
                void run(async () => {
                  const value = await invoke<S.SuiteRecord>('translations', 'markStale', {
                    ...s,
                    translation: ref(selectedTranslation!),
                    catalog: ref(selectedCatalog!),
                  });
                  setTranslationId(key(value));
                  return value;
                }, '已核对源文变化，过期项需重新编辑')
              }
            >
              核对源文变化
            </button>
            <button
              disabled={!catalogId || !termId}
              onClick={() =>
                void run(async () => {
                  const value = await invoke<{ candidates: unknown[] }>('translations', 'suggestFromMemory', {
                    ...s,
                    catalog: ref(choose('catalogs', catalogId)),
                    terminology: ref(choose('terminology', termId)),
                    language: targetLanguage,
                    keys: catalog.success ? catalog.data.entries.slice(0, 100).map((entry) => entry.key) : [],
                  });
                  setNotice(JSON.stringify(value, null, 2));
                }, '已查找记忆候选')
              }
            >
              查找前 100 个键的记忆
            </button>
            <p>记忆候选不会自动写入或成为已接受译文。</p>
            <LocaleTargetImport
              invoke={invoke}
              workspaceId={workspaceId}
              catalog={selectedCatalog}
              targetRows={catalogRows.filter(
                (row) => (row.content as Record<string, S.SuiteJson>).role === 'target',
              )}
              terms={rows('terminology')}
              termId={termId}
              context={contextId ? rows('contexts').find((row) => key(row) === contextId) : undefined}
              run={run}
              onTranslation={setTranslationId}
            />
          </section>
        )}
        {tab === '检查与预览' && (
          <section>
            <h2>固定输入与组件预览</h2>
            <div className="suite-space">
              <SuiteRecordSelect
                title="源文目录"
                rows={sourceRows}
                value={catalogId}
                onChange={setCatalogId}
              />
              <SuiteRecordSelect
                title="目标译文"
                rows={translationRows}
                value={translationId}
                onChange={setTranslationId}
              />
              <label>
                预览宽度
                <select
                  aria-label="预览宽度"
                  value={width}
                  onChange={(event) => setWidth(event.target.value as typeof width)}
                >
                  <option value="320">320 px</option>
                  <option value="768">768 px</option>
                  <option value="1280">1,280 px</option>
                </select>
              </label>
              <label className="suite-check">
                <input
                  type="checkbox"
                  checked={pseudo}
                  onChange={(event) => setPseudo(event.target.checked)}
                />
                伪本地化源文
              </label>
            </div>
            <button
              disabled={!catalogId || !translationId}
              onClick={() => void run(performChecks, '文案检查完成，等待人工审阅')}
            >
              运行文案检查
            </button>
            {check.success && (
              <>
                <p>
                  {check.data.translated} / {check.data.total} 个键有译文 · {check.data.findings.length}{' '}
                  项问题 · {check.data.result}
                </p>
                {check.data.findings.slice(0, 100).map((finding) => (
                  <p key={finding.id} className={finding.severity === 'error' ? 'suite-error' : ''}>
                    {finding.key} · {finding.message}
                  </p>
                ))}
                {check.data.findings.length > 100 && <p>显示前 100 项，完整结果见固定结果或领域查询。</p>}
              </>
            )}
            {previewValue.success && (
              <>
                <p>
                  固定窗口 {previewValue.data.offset}～
                  {previewValue.data.offset + previewValue.data.items.length} / {previewValue.data.total}
                  。行数为估计；此布局需要在目标应用另行验收。
                </p>
                <div
                  className="locale-fixed-preview"
                  dir={previewValue.data.direction}
                  style={{ maxWidth: Number(previewValue.data.width) }}
                >
                  {previewValue.data.items.map((item) => (
                    <article key={item.key}>
                      <small>{item.key}</small>
                      <p>{item.text}</p>
                      <small>
                        {item.graphemes} 个用户感知字符 · 估计 {item.estimatedLines} 行
                      </small>
                    </article>
                  ))}
                </div>
                {previewValue.data.offset + previewValue.data.items.length < previewValue.data.total && (
                  <button
                    onClick={() =>
                      void run(
                        () =>
                          invoke('previews', 'render', {
                            ...s,
                            check: previewValue.data.check,
                            width: previewValue.data.width,
                            pseudo: previewValue.data.pseudo,
                            offset: previewValue.data.offset + previewValue.data.items.length,
                            limit: 100,
                          }),
                        '已生成下一段预览',
                      )
                    }
                  >
                    预览后 100 个键
                  </button>
                )}
              </>
            )}
          </section>
        )}
        {tab === '审阅与版本' && (
          <div className="suite-columns">
            <article>
              <h2>人工审阅</h2>
              <SuiteRecordSelect
                title="文案审阅"
                rows={rows('reviews')}
                value={reviewId}
                onChange={(value) => {
                  setReviewId(value);
                  setAcknowledged([]);
                }}
              />
              {check.success &&
                check.data.findings.map((finding) => (
                  <label className="suite-check" key={finding.id}>
                    <input
                      type="checkbox"
                      checked={acknowledged.includes(finding.id)}
                      onChange={(event) =>
                        setAcknowledged((previous) =>
                          event.target.checked
                            ? [...previous, finding.id]
                            : previous.filter((id) => id !== finding.id),
                        )
                      }
                    />
                    {finding.key} · {finding.message}
                  </label>
                ))}
              <label>
                审阅理由
                <textarea
                  aria-label="审阅理由"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={4000}
                />
              </label>
              <button
                disabled={!reviewId || !note.trim()}
                onClick={() =>
                  void run(async () => {
                    const value = await invoke<S.SuiteRecord>('reviews', 'decide', {
                      ...s,
                      review: ref(choose('reviews', reviewId)),
                      decision: 'accept',
                      note,
                      acknowledged,
                    });
                    setReviewId(key(value));
                    return value;
                  }, '已记录本次用途接受')
                }
              >
                接受此次用途
              </button>
              <button
                disabled={!reviewId || !note.trim()}
                onClick={() =>
                  void run(
                    () =>
                      invoke('reviews', 'decide', {
                        ...s,
                        review: ref(choose('reviews', reviewId)),
                        decision: 'reject',
                        note,
                        acknowledged,
                      }),
                    '已记录拒绝决定',
                  )
                }
              >
                拒绝此次用途
              </button>
              <p>单人分阶段审阅。过期译文、占位符、术语及禁用词错误必须先修复。</p>
            </article>
            <article>
              <h2>本机语言版本</h2>
              <p>此入口发布当前选择的一种目标语言。领域操作支持一次发布最多 19 种目标语言。</p>
              <label>
                缺项规则
                <select
                  aria-label="缺项规则"
                  value={fallback}
                  onChange={(event) => setFallback(event.target.value as typeof fallback)}
                >
                  <option value="reject">拒绝缺失译文</option>
                  <option value="source">明确回退源文</option>
                </select>
              </label>
              <button
                disabled={!catalogId || !translationId || !reviewId}
                onClick={() =>
                  void run(
                    () =>
                      preview(
                        'releases',
                        'preview',
                        {
                          ...s,
                          catalog: ref(choose('catalogs', catalogId)),
                          translations: [ref(choose('translations', translationId))],
                          reviews: [ref(choose('reviews', reviewId))],
                          fallback,
                        },
                        'publishLocal',
                      ),
                    '请核对语言版本计划',
                  )
                }
              >
                预览本机版本
              </button>
              <SuiteRecordSelect
                title="语言版本"
                rows={releaseRows}
                value={releaseId}
                onChange={setReleaseId}
              />
              <button
                disabled={!releaseId}
                onClick={() =>
                  void run(
                    () =>
                      invoke('releases', 'makePatch', { ...s, release: ref(choose('releases', releaseId)) }),
                    '待应用补丁已生成',
                  )
                }
              >
                生成待应用补丁
              </button>
              <button
                disabled={!releaseId}
                onClick={() =>
                  void run(
                    () =>
                      preview(
                        'releases',
                        'previewRollback',
                        { ...s, release: ref(choose('releases', releaseId)) },
                        'rollback',
                      ),
                    '请核对回退的原版本',
                  )
                }
              >
                预览回退
              </button>
              {releaseId && (
                <LocaleReleaseFiles
                  record={releaseRows.find((row) => key(row) === releaseId)}
                  run={run}
                  invoke={invoke}
                  workspaceId={workspaceId}
                />
              )}
            </article>
          </div>
        )}
        {tab === '离线交接' && (
          <SuiteExchangePanel
            invoke={invoke}
            workspaceId={workspaceId}
            domains={domains}
            records={Object.fromEntries((Object.keys(domains) as LocaleDomain[]).map((d) => [d, rows(d)]))}
            transfers={transfers}
            busy={busy}
            run={run}
            preview={preview}
            onAccepted={onSpacesChanged}
            downloadName="localization-studio.zip"
          />
        )}
        {tab === '历史与清理' && (
          <section>
            <h2>历史、许可与原对象清理</h2>
            <SuitePublicationRecoveryPanel
              key={domain}
              domain={domain}
              workspaceId={workspaceId}
              invoke={invoke}
              run={(work, message) => run(work, message, false)}
              preview={preview}
            />
            <label>
              领域
              <select
                aria-label="历史领域"
                value={domain}
                onChange={(event) => setDomain(event.target.value as LocaleDomain)}
              >
                {Object.entries(domains).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {rows(domain).map((row) => (
              <div className="suite-card" key={key(row)}>
                <strong>{row.name}</strong>
                <p>
                  {row.kind} · {row.state} · 修订 {row.sequence}
                </p>
                <code>
                  {row.id} / {row.revision}
                </code>
                <button onClick={() => setResult(row)}>查看</button>
                <button
                  onClick={() =>
                    void run(
                      async () => {
                        const holders = await invoke<{ holders: string[] }>(domain, 'references', {
                          ...s,
                          id: row.id,
                          revision: row.revision,
                        });
                        setNotice(holders.holders.join('，') || '无保护引用');
                      },
                      '引用已核对',
                      false,
                    )
                  }
                >
                  保护引用
                </button>
                {row.state === 'archived' ? (
                  <button
                    onClick={() =>
                      void run(
                        () => preview(domain, 'previewCleanup', { ...s, references: [ref(row)] }, 'cleanup'),
                        '请核对原对象清理计划',
                      )
                    }
                  >
                    预览清理
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      void run(() => invoke(domain, 'archive', { ...s, id: row.id, revision: row.revision }))
                    }
                  >
                    归档
                  </button>
                )}
                {domain === 'catalogs' && row.kind === 'source' && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        const policy = await invoke<{ revision: number }>('catalogs', 'policy', {
                          ...s,
                          id: row.id,
                          revision: row.revision,
                        });
                        await preview(
                          'catalogs',
                          'planPolicy',
                          {
                            ...s,
                            id: row.id,
                            revision: row.revision,
                            expectedPolicyRevision: policy.revision,
                            allowRead: true,
                            allowExport: false,
                          },
                          'applyPolicy',
                        );
                      }, '请核对撤销原文导出的计划')
                    }
                  >
                    预览禁止导出
                  </button>
                )}
              </div>
            ))}
            {pages[domain]?.next !== null && pages[domain]?.next !== undefined && (
              <button
                onClick={() =>
                  void run(
                    async () => {
                      const next = await invoke<S.SuitePage>(domain, 'list', {
                        ...s,
                        cursor: pages[domain]!.next,
                        limit: 50,
                        history: true,
                        archived: true,
                      });
                      setPages((previous) => ({
                        ...previous,
                        [domain]: {
                          items: [...(previous[domain]?.items ?? []), ...next.items],
                          next: next.next,
                        },
                      }));
                    },
                    '已加载后续历史',
                    false,
                  )
                }
              >
                加载更多历史
              </button>
            )}
            <h3>材料暂存</h3>
            {uploads
              .slice(-50)
              .reverse()
              .map((upload) => (
                <div className="suite-card" key={upload.id}>
                  <strong>{upload.name}</strong>
                  <p>
                    {upload.state} · {upload.offset} / {upload.bytes} 字节
                  </p>
                  {upload.state !== 'discarded' && !upload.source && (
                    <button
                      onClick={() =>
                        void run(
                          () => invoke('catalogs', 'discardUpload', { ...s, id: upload.id }),
                          '材料上传已取消',
                        )
                      }
                    >
                      取消材料暂存
                    </button>
                  )}
                </div>
              ))}
          </section>
        )}
        {tab === '领域操作' && (
          <section>
            <h2>精确领域操作</h2>
            <p>用于多语言版本、固定捕获、许可与原计划恢复。可用动作只来自本包登记的严格契约。</p>
            <label>
              领域
              <select
                aria-label="操作领域"
                value={domain}
                onChange={(event) => {
                  setDomain(event.target.value as LocaleDomain);
                  setMethod('list');
                }}
              >
                {Object.entries(domains).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              动作
              <select
                aria-label="操作动作"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                {Object.keys(localeHttpSchemas[domain]).map((action) => (
                  <option key={action}>{action}</option>
                ))}
              </select>
            </label>
            <label>
              参数 JSON
              <textarea
                className="suite-code"
                value={parameters}
                onChange={(event) => setParameters(event.target.value)}
              />
            </label>
            <button
              onClick={() =>
                void run(async () => {
                  const input = JSON.parse(parameters);
                  if (!input || typeof input !== 'object' || Array.isArray(input))
                    throw new Error('参数须为对象');
                  const value = await invoke<unknown>(domain, method, { ...input, ...s });
                  setNotice(JSON.stringify(value, null, 2));
                  if (value && typeof value === 'object' && 'revision' in value) return value;
                })
              }
            >
              执行所选动作
            </button>
          </section>
        )}
      </fieldset>
      {result && (
        <details open className="suite-result">
          <summary>最近固定结果 · {result.name}</summary>
          <code>
            {result.id} / {result.revision}
          </code>
          <pre>{JSON.stringify(result.content, null, 2)}</pre>
          {format(result) === 'sakura-locale-patch/1' && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const current = await invoke<S.SuiteRecord>('releases', 'get', {
                    ...s,
                    id: result.id,
                    revision: result.revision,
                  });
                  suiteDownload(
                    new TextEncoder().encode(JSON.stringify(current.content, null, 2) + '\n'),
                    'locale-patch.json',
                    'application/json',
                  );
                }, '补丁已按当前许可读取')
              }
            >
              下载待应用补丁
            </button>
          )}
        </details>
      )}
      {plan && (
        <SuitePlanDialog
          value={plan.value}
          busy={busy}
          onCancel={() => setPlan(undefined)}
          onApprove={() =>
            void run(async () => {
              const value = await invoke<S.SuiteRecord>(plan.domain, plan.action, {
                ...s,
                planId: plan.value.id,
                digest: plan.value.digest,
              });
              if (plan.action === 'publishLocal' || plan.action === 'rollback') setReleaseId(key(value));
              if (['acceptImport', 'recoverImport'].includes(plan.action)) await onSpacesChanged();
              setPlan(undefined);
              return value;
            }, '原计划已执行，结果已保存')
          }
        />
      )}
    </>
  );
}
function Sref(value: unknown): S.SuiteRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const ref = value as S.SuiteRef;
  return typeof ref.id === 'string' && typeof ref.revision === 'string' && typeof ref.domain === 'string'
    ? ref
    : null;
}
type Invoke = ReturnType<typeof useSuiteClient>;
type Run = (work: () => Promise<unknown>, message?: string) => Promise<void>;
function LocaleEditor({
  catalog,
  translation,
  onSave,
}: {
  catalog: LCatalog;
  translation?: LTranslation;
  onSave: (items: { key: string; text: string }[]) => Promise<void>;
}) {
  const [edits, setEdits] = useState(
      () => new Map(translation?.items.map((item) => [item.key, item.text]) ?? []),
    ),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState('');
  const entries = catalog.entries.filter(
    (entry) => !search || entry.key.includes(search) || entry.text.includes(search),
  );
  return (
    <>
      <p>{entries.length} 个键，每页 50 个。保存会生成对应当前源文的新修订。</p>
      <label>
        查找文案
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
      </label>
      <div className="locale-editor">
        {entries.slice(offset, offset + 50).map((entry) => (
          <article key={entry.key}>
            <strong>{entry.key}</strong>
            <p>{entry.text}</p>
            <textarea
              aria-label={`译文 ${entry.key}`}
              value={edits.get(entry.key) ?? ''}
              onChange={(event) =>
                setEdits((previous) => new Map(previous).set(entry.key, event.target.value))
              }
              maxLength={16384}
            />
            {translation?.items.find((item) => item.key === entry.key)?.stale && (
              <small className="suite-error">原译文已过期，请核对新的源文。</small>
            )}
          </article>
        ))}
      </div>
      <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
        上一页译文
      </button>
      <button disabled={offset + 50 >= entries.length} onClick={() => setOffset(offset + 50)}>
        下一页译文
      </button>
      <button
        onClick={() =>
          void onSave(
            catalog.entries
              .filter((entry) => edits.has(entry.key))
              .map((entry) => ({ key: entry.key, text: edits.get(entry.key)! })),
          )
        }
      >
        保存当前源文的新译文
      </button>
    </>
  );
}
type LCatalog = import('zod').infer<typeof L.localeCatalog>;
type LTranslation = import('zod').infer<typeof L.localeTranslation>;
function LocaleContextTerms({
  invoke,
  workspaceId,
  catalog,
  rows,
  termId,
  contextId,
  setTermId,
  setContextId,
  run,
  uploadBytes,
}: {
  invoke: Invoke;
  workspaceId: string;
  catalog?: S.SuiteRecord;
  rows: Record<string, S.SuiteRecord[]>;
  termId: string;
  contextId: string;
  setTermId: (id: string) => void;
  setContextId: (id: string) => void;
  run: Run;
  uploadBytes: (
    bytes: Uint8Array,
    name: string,
    format: 'json' | 'png' | 'jpeg',
    allowExport: boolean,
  ) => Promise<S.SuiteRecord>;
}) {
  const [language, setLanguage] = useState('zh-CN'),
    [domain, setDomain] = useState('application'),
    [source, setSource] = useState(''),
    [target, setTarget] = useState(''),
    [forbidden, setForbidden] = useState(''),
    [termItems, setTermItems] = useState<{ source: string; target: string; forbidden: string[] }[]>([]);
  const [contextKey, setContextKey] = useState(''),
    [description, setDescription] = useState(''),
    [location, setLocation] = useState(''),
    [maximum, setMaximum] = useState(''),
    [image, setImage] = useState<File>();
  const content = L.localeCatalog.safeParse(catalog?.content),
    s = { workspaceId };
  return (
    <div className="suite-columns">
      <article>
        <h2>语言与领域术语</h2>
        <SuiteRecordSelect title="术语修订" rows={rows.terminology} value={termId} onChange={setTermId} />
        <label>
          目标语言
          <input value={language} onChange={(event) => setLanguage(event.target.value)} />
        </label>
        <label>
          术语领域
          <input value={domain} onChange={(event) => setDomain(event.target.value)} />
        </label>
        <label>
          源术语
          <input value={source} onChange={(event) => setSource(event.target.value)} />
        </label>
        <label>
          建议译法
          <input value={target} onChange={(event) => setTarget(event.target.value)} />
        </label>
        <label>
          禁用译法，用逗号分隔
          <input value={forbidden} onChange={(event) => setForbidden(event.target.value)} />
        </label>
        <button
          disabled={!source.trim() || !target.trim()}
          onClick={() => {
            setTermItems((previous) => [
              ...previous,
              {
                source: source.trim(),
                target: target.trim(),
                forbidden: forbidden
                  .split(/[,，]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              },
            ]);
            setSource('');
            setTarget('');
            setForbidden('');
          }}
        >
          加入术语
        </button>
        {termItems.map((term, index) => (
          <p key={index}>
            {term.source} → {term.target}
            <button onClick={() => setTermItems((previous) => previous.filter((_item, i) => i !== index))}>
              移除此术语
            </button>
          </p>
        ))}
        <button
          disabled={!catalog}
          onClick={() =>
            void run(async () => {
              const row = await invoke<S.SuiteRecord>('terminology', 'save', {
                ...s,
                name: `${language} ${domain} 术语`,
                content: { language, domain, terms: termItems },
                references: [ref(catalog!)],
              });
              await invoke('terminology', 'seal', { ...s, id: row.id, revision: row.revision });
              setTermId(key(row));
              return row;
            }, '术语已核对并封存')
          }
        >
          保存并封存术语
        </button>
      </article>
      <article>
        <h2>文案上下文与截图</h2>
        <SuiteRecordSelect
          title="上下文修订"
          rows={rows.contexts}
          value={contextId}
          onChange={setContextId}
        />
        <label>
          文案键
          <select
            aria-label="上下文文案键"
            value={contextKey}
            onChange={(event) => setContextKey(event.target.value)}
          >
            <option value="">选择键</option>
            {content.success &&
              content.data.entries.map((entry) => <option key={entry.key}>{entry.key}</option>)}
          </select>
        </label>
        <label>
          使用说明
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
          />
        </label>
        <label>
          使用位置
          <input value={location} onChange={(event) => setLocation(event.target.value)} />
        </label>
        <label>
          建议最大用户感知字符数
          <input
            type="number"
            min={1}
            max={100000}
            value={maximum}
            onChange={(event) => setMaximum(event.target.value)}
          />
        </label>
        <label>
          参考截图，可选 PNG/JPEG
          <input
            type="file"
            accept=".png,.jpg,.jpeg"
            onChange={(event) => setImage(event.target.files?.[0])}
          />
        </label>
        <button
          disabled={!catalog || !contextKey}
          onClick={() =>
            void run(async () => {
              let screenshot: S.SuiteRef | null = null;
              if (image) {
                if (image.size > 8 * 1024 ** 2 || !/\.(png|jpe?g)$/i.test(image.name))
                  throw new Error('截图须为最多 8 MiB 的 PNG/JPEG');
                screenshot = ref(
                  await uploadBytes(
                    new Uint8Array(await image.arrayBuffer()),
                    image.name,
                    /\.png$/i.test(image.name) ? 'png' : 'jpeg',
                    false,
                  ),
                );
              }
              const prior = L.localeContexts.safeParse(
                  rows.contexts.find((row) => key(row) === contextId)?.content,
                ),
                item = {
                  key: contextKey,
                  description,
                  location,
                  maxGraphemes: maximum ? Number(maximum) : null,
                  screenshot,
                },
                items =
                  prior.success && catalog && key(prior.data.catalog) === key(catalog)
                    ? [...prior.data.items.filter((item) => item.key !== contextKey), item]
                    : [item];
              const row = await invoke<S.SuiteRecord>('contexts', 'attach', {
                ...s,
                catalog: ref(catalog!),
                items,
              });
              setContextId(key(row));
              return row;
            }, '上下文已固定')
          }
        >
          保存上下文
        </button>
        <p>截图保持本地参考，默认禁止导出。预览只渲染固定文本，不运行项目界面。</p>
      </article>
    </div>
  );
}
function LocaleTargetImport({
  invoke,
  workspaceId,
  catalog,
  targetRows,
  terms,
  termId,
  context,
  run,
  onTranslation,
}: {
  invoke: Invoke;
  workspaceId: string;
  catalog?: S.SuiteRecord;
  targetRows: S.SuiteRecord[];
  terms: S.SuiteRecord[];
  termId: string;
  context?: S.SuiteRecord;
  run: Run;
  onTranslation: (id: string) => void;
}) {
  const [targetId, setTargetId] = useState('');
  return (
    <details>
      <summary>使用已导入的目标语言</summary>
      <SuiteRecordSelect title="已有目标目录" rows={targetRows} value={targetId} onChange={setTargetId} />
      <button
        disabled={!catalog || !targetId || !termId}
        onClick={() =>
          void run(async () => {
            const target = targetRows.find((row) => key(row) === targetId)!,
              content = L.localeCatalog.parse(target.content),
              terminology = terms.find((row) => key(row) === termId);
            if (!terminology) throw new Error('请选择术语修订');
            const row = await invoke<S.SuiteRecord>('translations', 'revise', {
              workspaceId,
              name: content.language + ' 导入译文',
              catalog: ref(catalog!),
              language: content.language,
              terminology: ref(terminology),
              contexts: context ? ref(context) : null,
              targetCatalog: ref(target),
              items: [],
            });
            onTranslation(key(row));
            return row;
          })
        }
      >
        从目标目录创建译文
      </button>
    </details>
  );
}
function LocaleReleaseFiles({
  record,
  invoke,
  workspaceId,
  run,
}: {
  record?: S.SuiteRecord;
  invoke: Invoke;
  workspaceId: string;
  run: Run;
}) {
  const release = L.localeRelease.safeParse(record?.content);
  if (!release.success || !record) return null;
  return (
    <div>
      {release.data.files.map((file) => (
        <div className="suite-card" key={file.path}>
          <strong>{file.path}</strong>
          <p>
            {file.bytes} 字节 · {file.fallbackKeys.length} 个回退键
          </p>
          <button
            onClick={() =>
              void run(async () => {
                const current = await invoke<S.SuiteRecord>('releases', 'get', {
                  workspaceId,
                  id: record.id,
                  revision: record.revision,
                });
                if (current.origin !== 'local' || current.state !== 'sealed')
                  throw new Error('请选择本机封存版本');
                const data = L.localeRelease
                  .parse(current.content)
                  .files.find((item) => item.path === file.path)!;
                const bytes = new TextEncoder().encode(data.text);
                if ((await suiteDigest(bytes)) !== data.digest) throw new Error('语言文件摘要不同');
                suiteDownload(bytes, data.path, 'application/json');
              }, '语言文件已核对摘要')
            }
          >
            下载 {file.language} 语言文件
          </button>
        </div>
      ))}
    </div>
  );
}
