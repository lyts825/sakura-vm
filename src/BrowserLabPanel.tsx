/** 浏览器验收从固定站点到报告；运行和交接使用原计划确认。 */
import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import type { Request } from './feature-shared';
import type * as S from '../shared/contracts/suite-common';
import type { ImageAsset } from '../shared/contracts/image-assets';
import type { SuiteHostCapacity } from '../shared/contracts/suite-capacity';
import * as B from '../shared/contracts/browser-lab';
import { browserHttpSchemas, browserTemplate } from '../shared/contracts/browser-http';
import {
  useSuiteClient,
  suiteReference as ref,
  suiteReferenceKey as key,
  suiteUnbase64,
  suiteDigest,
  suiteDownload,
} from './suite-client';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteRecordSelect } from './SuiteRecordSelect';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import { SuiteHostCapacityStatus } from './SuiteHostCapacityStatus';
import './suite-workbench.css';
const labels = {
  targets: '站点和目标',
  fixtures: '合成数据',
  journeys: '操作旅程',
  runners: '真实运行',
  assertions: '固定断言',
  visual: '视觉基线',
  accessibility: '可访问性',
  reports: '验收报告',
  exchange: '离线交接',
};
const tabs = ['开始与目标', '场景编辑', '运行与证据', '基线与审阅', '报告与交接', '历史与恢复'];
type Invoke = <T>(domain: string, method: string, input?: unknown) => Promise<T>;
type View = {
  workspace: S.SuiteWorkspace | null;
  domains: { id: string; records: S.SuiteRecord[]; next: number | null }[];
};
const format = (row: S.SuiteRecord) =>
  row.content && typeof row.content === 'object' && !Array.isArray(row.content)
    ? String(row.content.format ?? '')
    : '';
export function BrowserLabPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: string;
  authorized?: boolean;
}) {
  const epoch = useMemo(() => crypto.randomUUID(), [request, accessEpoch]);
  return authorized ? (
    <BrowserSpaces key={epoch} request={request} />
  ) : (
    <p>请解锁会话后查看浏览器验收材料。</p>
  );
}
function BrowserSpaces({ request }: { request: Request }) {
  const invoke = useSuiteClient(request, 'browser', browserHttpSchemas),
    [spaces, setSpaces] = useState<S.SuiteWorkspace[]>([]),
    [images, setImages] = useState<ImageAsset[]>([]),
    [templates, setTemplates] = useState<z.infer<typeof browserTemplate>[]>([]),
    [workspaceId, setWorkspaceId] = useState(''),
    [name, setName] = useState('浏览器验收'),
    [template, setTemplate] = useState(''),
    [image, setImage] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const reload = async () => {
    setSpaces(await invoke('targets', 'listWorkspaces'));
    setImages(await invoke('targets', 'images'));
    setTemplates(await invoke('workbench', 'templates'));
  };
  useEffect(() => {
    void reload().catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
  }, []);
  return (
    <main className="suite-workbench">
      <header>
        <div>
          <small>BROWSER LAB</small>
          <h1>浏览器验收工作台</h1>
          <p>固定样站与操作步骤，查看真实浏览器的逐步证据和人工审阅。</p>
        </div>
        <span className="suite-chip">10 个领域 · 隔离样站</span>
      </header>
      <section className="suite-space">
        <label>
          验收空间
          <select aria-label="验收空间" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            <option value="">选择空间</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id} disabled={s.revoked}>
                {s.name}
                {s.quarantined ? ' · 隔离中' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          新空间名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          初始模板
          <select aria-label="初始模板" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">空白空间</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          已准备的镜像
          <select aria-label="已准备的镜像" value={image} onChange={(e) => setImage(e.target.value)}>
            <option value="">选择含 Chromium、Python 和字体的镜像</option>
            {images.map((i) => (
              <option key={i.id} value={i.id}>
                {i.distro} · {i.digest.slice(0, 12)}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !name.trim() || (!!template && !image)}
          onClick={() => {
            setBusy(true);
            setError('');
            void (async () => {
              const result = template
                ? await invoke<{ workspace: S.SuiteWorkspace }>('workbench', 'createExample', {
                    name,
                    template,
                    image: { assetId: image, digest: image },
                  })
                : { workspace: await invoke<S.SuiteWorkspace>('targets', 'createWorkspace', { name }) };
              await reload();
              setWorkspaceId(result.workspace.id);
            })()
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          创建验收空间
        </button>
      </section>
      {error && <p role="alert">{error}</p>}
      {workspaceId && (
        <BrowserWorkspace
          key={workspaceId}
          request={request}
          workspaceId={workspaceId}
          images={images}
          templates={templates}
          onAccepted={reload}
        />
      )}
    </main>
  );
}
function BrowserWorkspace({
  request,
  workspaceId,
  images,
  templates,
  onAccepted,
}: {
  request: Request;
  workspaceId: string;
  images: ImageAsset[];
  templates: z.infer<typeof browserTemplate>[];
  onAccepted: () => Promise<void>;
}) {
  const invoke = useSuiteClient(request, 'browser', browserHttpSchemas),
    scope = { workspaceId };
  const [records, setRecords] = useState<Record<string, S.SuiteRecord[]>>({}),
    [view, setView] = useState<View>(),
    [capacity, setCapacity] = useState<SuiteHostCapacity>(),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [tab, setTab] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [result, setResult] = useState<unknown>(),
    [pending, setPending] = useState<{ domain: string; apply: string; plan: S.SuitePlan }>();
  const [target, setTarget] = useState(''),
    [fixture, setFixture] = useState(''),
    [journey, setJourney] = useState(''),
    [runId, setRunId] = useState(''),
    [baseline, setBaseline] = useState(''),
    [image, setImage] = useState(''),
    [source, setSource] = useState(''),
    [name, setName] = useState('新验收对象'),
    [siteFile, setSiteFile] = useState<File>(),
    [exportable, setExportable] = useState(false);
  const [fixtureText, setFixtureText] = useState(
      JSON.stringify({ seed: 'example-1', fields: {}, localStorage: {}, cookies: [] }, null, 2),
    ),
    [definition, setDefinition] = useState(JSON.stringify(templates[0]?.journey ?? {}, null, 2)),
    [note, setNote] = useState(''),
    [manualChecks, setManualChecks] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [currentBaseline, setCurrentBaseline] = useState<S.SuiteRecord | null>(),
    [baselineChecked, setBaselineChecked] = useState(false),
    [previewImage, setPreviewImage] = useState(''),
    [domain, setDomain] = useState('runners'),
    [cursor, setCursor] = useState(0);
  const rows = (d: string, f?: string) => (records[d] ?? []).filter((r) => !f || format(r) === f),
    selected = (d: string, k: string) => rows(d).find((r) => key(r) === k),
    selectedRef = (d: string, k: string) => {
      const row = selected(d, k);
      if (!row) throw new Error('请先选择固定修订');
      return ref(row);
    };
  const reload = async () => {
    const next = await invoke<View>('workbench', 'view', { ...scope, cursor, limit: 20, history: false });
    setView(next);
    setRecords(Object.fromEntries(next.domains.map((d) => [d.id.slice(8), d.records])));
    setCapacity(await invoke('targets', 'hostCapacity', scope));
    setTransfers(await invoke('exchange', 'transfers', scope));
  };
  useEffect(() => {
    void reload().catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
  }, [cursor]);
  const run = async (work: () => Promise<unknown>, message = '操作已完成') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await work();
      if (value !== undefined) setResult(value);
      await reload();
      setNotice(message);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const preview = async (d: string, action: string, input: unknown, apply: string) => {
    await run(async () => {
      const plan = await invoke<S.SuitePlan>(d, action, input);
      setPending({ domain: d, apply, plan });
    }, '请核对固定计划');
  };
  const control = (
    d: string,
    value: string,
    change: (v: string) => void,
    f?: string,
    title = labels[d as keyof typeof labels],
  ) => <SuiteRecordSelect title={title} rows={rows(d, f)} value={value} onChange={change} />;
  const inspect = () =>
    run(async () => {
      const row = await invoke<S.SuiteRecord>('runners', 'inspect', {
        ...scope,
        run: selectedRef('runners', runId),
      });
      setRunId(key(row));
      return row;
    }, '已核对原运行；查询不会重新执行');
  const downloadShot = async (shot: z.infer<typeof B.browserArtifact>, display: boolean) => {
    const lease = await invoke<S.SuiteReadLease>('targets', 'openRead', {
        ...scope,
        id: shot.source.id,
        revision: shot.source.revision,
      }),
      parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await invoke<{ data: string; offset: number; eof: boolean }>('targets', 'readLease', {
            ...scope,
            id: lease.id,
            offset: size,
            length: 512 * 1024,
          }),
          data = suiteUnbase64(chunk.data);
        size += data.length;
        if (size > 4 * 1024 ** 2 || chunk.offset !== size || (!data.length && !chunk.eof))
          throw new Error('截图读取预算或偏移错误');
        parts.push(data);
        if (chunk.eof) break;
      }
    } finally {
      await invoke('targets', 'closeRead', { ...scope, id: lease.id });
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const p of parts) {
      bytes.set(p, offset);
      offset += p.length;
    }
    if ((await suiteDigest(bytes)) !== shot.digest) throw new Error('截图摘要不一致');
    if (display) {
      let encoded = '';
      for (const p of parts)
        for (let i = 0; i < p.length; i += 16384) encoded += String.fromCharCode(...p.subarray(i, i + 16384));
      setPreviewImage('data:image/png;base64,' + btoa(encoded));
    } else suiteDownload(bytes, `browser-step-${shot.step + 1}.png`, 'image/png');
  };
  const currentRun = B.browserRun.safeParse(selected('runners', runId)?.content);
  return (
    <>
      <SuiteHostCapacityStatus value={capacity} />
      <nav className="suite-tabs" aria-label="浏览器验收步骤">
        {tabs.map((title, i) => (
          <button key={title} aria-current={tab === i ? 'page' : undefined} onClick={() => setTab(i)}>
            {title}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy || view?.workspace?.revoked} className="suite-section">
        {tab === 0 && (
          <div className="suite-columns">
            <article>
              <h2>固定站点</h2>
              <p>
                上传站点 JSON，包含入口和相对路径文件；网页脚本只在专用浏览器 VM 中运行。材料默认不允许导出。
              </p>
              <label>
                对象名称
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                站点文件
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => setSiteFile(e.target.files?.[0])}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={exportable}
                  onChange={(e) => setExportable(e.target.checked)}
                />
                允许导出本次上传的样站和后续运行截图
              </label>
              <button
                disabled={!siteFile}
                onClick={() =>
                  void run(async () => {
                    if (!siteFile || siteFile.size > 2 * 1024 ** 2)
                      throw new Error('页面上传最多 2 MiB；较大材料请使用分块 CLI');
                    return invoke('targets', 'upload', {
                      ...scope,
                      name,
                      site: B.browserSite.parse(JSON.parse(await siteFile.text())),
                      allowExport: exportable,
                    });
                  })
                }
              >
                上传样站
              </button>
            </article>
            <article>
              <h2>固定目标</h2>
              {control('targets', source, setSource, undefined, '站点材料')}
              <label>
                工具镜像
                <select aria-label="工具镜像" value={image} onChange={(e) => setImage(e.target.value)}>
                  <option value="">选择已准备镜像</option>
                  {images.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.distro} · {i.digest.slice(0, 12)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={!source || !image}
                onClick={() =>
                  void run(() =>
                    invoke('targets', 'pin', {
                      ...scope,
                      name,
                      source: selectedRef('targets', source),
                      image: { assetId: image, digest: image },
                    }),
                  )
                }
              >
                封存目标
              </button>
              <button onClick={() => void run(() => invoke('runners', 'tool'))}>检查本机执行能力</button>
              <p>至少需要 8 GiB 虚拟磁盘额度，另计镜像、输入、输出和恢复预留。运行不会自动安装依赖。</p>
            </article>
          </div>
        )}
        {tab === 1 && (
          <div className="suite-columns">
            <article>
              <h2>合成数据</h2>
              {control('targets', target, setTarget, 'sakura-browser-target/1')}
              <label>
                数据模板 JSON
                <textarea rows={12} value={fixtureText} onChange={(e) => setFixtureText(e.target.value)} />
              </label>
              <button
                disabled={!target}
                onClick={() =>
                  void run(() =>
                    invoke('fixtures', 'generate', {
                      ...scope,
                      name,
                      target: selectedRef('targets', target),
                      data: B.browserFixtureData.parse(JSON.parse(fixtureText)),
                    }),
                  )
                }
              >
                封存合成数据
              </button>
            </article>
            <article>
              <h2>声明式旅程</h2>
              {control('fixtures', fixture, setFixture, 'sakura-browser-fixture/1')}
              <label>
                填入内置步骤
                <select
                  aria-label="填入内置步骤"
                  defaultValue=""
                  onChange={(e) => {
                    const t = templates.find((t) => t.id === e.target.value);
                    if (t) setDefinition(JSON.stringify(t.journey, null, 2));
                  }}
                >
                  <option value="">选择模板</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                步骤、断言和视口 JSON
                <textarea rows={20} value={definition} onChange={(e) => setDefinition(e.target.value)} />
              </label>
              <p>
                支持 navigate、click、fill、select、wait 和
                screenshot；条件、容差、遮罩与检查规则在运行前固定。
              </p>
              <button
                disabled={!target || !fixture}
                onClick={() =>
                  void run(() =>
                    invoke('journeys', 'compile', {
                      ...scope,
                      name,
                      target: selectedRef('targets', target),
                      fixture: selectedRef('fixtures', fixture),
                      definition: B.browserJourneyDefinition.parse(JSON.parse(definition)),
                    }),
                  )
                }
              >
                校验并封存旅程
              </button>
            </article>
          </div>
        )}
        {tab === 2 && (
          <>
            <h2>运行前核对</h2>
            {control(
              'journeys',
              journey,
              (v) => {
                setJourney(v);
                setBaselineChecked(false);
              },
              'sakura-browser-journey/1',
            )}
            {control(
              'visual',
              baseline,
              setBaseline,
              'sakura-browser-baseline/1',
              '预先选定的视觉基线（首轮留空）',
            )}
            <button
              disabled={!journey}
              onClick={() =>
                void preview(
                  'runners',
                  'preview',
                  {
                    ...scope,
                    journey: selectedRef('journeys', journey),
                    baseline: baseline ? selectedRef('visual', baseline) : null,
                    exportArtifacts: exportable,
                  },
                  'start',
                )
              }
            >
              预览隔离运行
            </button>
            <h2>原运行证据</h2>
            {control(
              'runners',
              runId,
              (v) => {
                setRunId(v);
                setPreviewImage('');
              },
              'sakura-browser-run/1',
            )}
            <button disabled={!runId} onClick={() => void inspect()}>
              更新原运行
            </button>
            <button
              disabled={!runId}
              onClick={() =>
                void run(
                  () => invoke('runners', 'cancel', { ...scope, run: selectedRef('runners', runId) }),
                  '已请求停止原运行，请更新核销结果',
                )
              }
            >
              取消原运行
            </button>
            <button
              disabled={!runId}
              onClick={() =>
                void run(() =>
                  invoke('runners', 'reconcile', { ...scope, run: selectedRef('runners', runId) }),
                )
              }
            >
              核销原资源
            </button>
            {currentRun.success && (
              <>
                <p>
                  状态 {currentRun.data.executionState} · 结论 {currentRun.data.outcome} · 原资源清理{' '}
                  {currentRun.data.cleanup}
                </p>
                <ol>
                  {currentRun.data.observations.map((step) => (
                    <li key={step.sequence}>
                      <strong>{step.name}</strong> · {step.status} · {step.elapsedMs.toFixed(0)} ms{' '}
                      {step.error && <p>{step.error}</p>}
                      {step.assertions.map((a) => (
                        <p key={a.index}>
                          断言 {a.index + 1}：{a.passed ? '通过' : '失败'} · 实际 {a.actual}
                        </p>
                      ))}
                    </li>
                  ))}
                </ol>
                {currentRun.data.screenshots.map((shot) => (
                  <p key={shot.step}>
                    步骤 {shot.step + 1} 截图 · {shot.width} × {shot.height}
                    <button onClick={() => void run(() => downloadShot(shot, true))}>查看原截图</button>
                    <button onClick={() => void run(() => downloadShot(shot, false))}>下载截图</button>
                  </p>
                ))}
                {currentRun.data.blockedRequests.length > 0 && (
                  <details>
                    <summary>阻断的外部请求</summary>
                    <pre>{currentRun.data.blockedRequests.join('\n')}</pre>
                  </details>
                )}
              </>
            )}
            {previewImage && <img src={previewImage} alt="原运行步骤截图" style={{ maxWidth: '100%' }} />}
            <button
              disabled={!runId}
              onClick={() =>
                void run(async () => {
                  const runRef = selectedRef('runners', runId);
                  return {
                    assertions: await invoke('assertions', 'evaluate', { ...scope, run: runRef }),
                    visual: await invoke('visual', 'compare', { ...scope, run: runRef }),
                    accessibility: await invoke('accessibility', 'evaluate', { ...scope, run: runRef }),
                  };
                }, '已按运行前选定规则生成三类评估')
              }
            >
              生成固定规则评估
            </button>
          </>
        )}
        {tab === 3 && (
          <>
            <h2>人工基线与可访问性审阅</h2>
            {control('runners', runId, setRunId, 'sakura-browser-run/1')}
            <label>
              审阅说明
              <textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button
              disabled={!runId || !note.trim()}
              onClick={() =>
                void run(() =>
                  invoke('visual', 'proposeBaseline', { ...scope, run: selectedRef('runners', runId), note }),
                )
              }
            >
              提出候选基线
            </button>
            {control(
              'visual',
              baseline,
              (v) => {
                setBaseline(v);
                setBaselineChecked(false);
              },
              'sakura-browser-baseline/1',
              '待审阅基线',
            )}
            <button
              disabled={!baseline}
              onClick={() =>
                void run(async () => {
                  const b = B.browserBaseline.parse(selected('visual', baseline)?.content);
                  setCurrentBaseline(await invoke('visual', 'active', { ...scope, journey: b.journey }));
                  setBaselineChecked(true);
                }, '已读取当前基线；接受时会核对该修订')
              }
            >
              核对当前基线
            </button>
            <p>
              当前基线：
              {currentBaseline
                ? currentBaseline.revision.slice(0, 12)
                : baselineChecked
                  ? '尚无'
                  : '尚未核对'}
            </p>
            <label>
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              已查看原截图并完成人工审阅
            </label>
            <button
              disabled={!baseline || !baselineChecked || !reviewed || !note.trim()}
              onClick={() =>
                void run(
                  () =>
                    invoke('visual', 'acceptBaseline', {
                      ...scope,
                      baseline: selectedRef('visual', baseline),
                      expectedActive: currentBaseline ? ref(currentBaseline) : null,
                      note,
                    }),
                  '已建立新基线修订；旧报告保留原结论',
                )
              }
            >
              接受该基线
            </button>
            <label>
              人工检查项（每行一项）
              <textarea value={manualChecks} onChange={(e) => setManualChecks(e.target.value)} />
            </label>
            {rows('accessibility', 'sakura-browser-accessibility/1').map((row) => (
              <article className="suite-card" key={key(row)}>
                <strong>
                  {row.name} · {row.revision.slice(0, 8)}
                </strong>
                <pre>{JSON.stringify(row.content, null, 2)}</pre>
                <button
                  disabled={!note.trim()}
                  onClick={() =>
                    void run(() =>
                      invoke('accessibility', 'review', {
                        ...scope,
                        evaluation: ref(row),
                        note,
                        accepted: reviewed,
                        manualChecks: manualChecks
                          .split('\n')
                          .map((v) => v.trim())
                          .filter(Boolean),
                      }),
                    )
                  }
                >
                  记录此评估的人审
                </button>
              </article>
            ))}
          </>
        )}
        {tab === 4 && (
          <>
            <h2>封存验收报告</h2>
            {control('runners', runId, setRunId, 'sakura-browser-run/1')}
            <label>
              报告标题
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              范围与限制
              <textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button
              disabled={!runId || !name.trim()}
              onClick={() =>
                void run(async () => {
                  const runRef = selectedRef('runners', runId),
                    evaluations = ['assertions', 'visual', 'accessibility'].map((d) =>
                      rows(d).findLast((r) => {
                        const c = r.content as Record<string, unknown>;
                        return c && JSON.stringify(c.run) === JSON.stringify(runRef);
                      }),
                    );
                  if (evaluations.some((r) => !r)) throw new Error('请先对这一固定运行修订生成三类评估');
                  return invoke('reports', 'seal', {
                    ...scope,
                    run: runRef,
                    assertions: ref(evaluations[0]!),
                    visual: ref(evaluations[1]!),
                    accessibility: ref(evaluations[2]!),
                    title: name,
                    note,
                  });
                })
              }
            >
              封存当前评估报告
            </button>
            <SuiteExchangePanel
              invoke={invoke}
              workspaceId={workspaceId}
              domains={{ reports: labels.reports }}
              records={records}
              transfers={transfers}
              busy={busy}
              run={run}
              preview={preview}
              onAccepted={onAccepted}
              downloadName="browser-lab.zip"
              description="交接只接受封存报告及其完整引用图，原运行必须已核销，站点与截图须有导出许可。接收结果只作来源参考。"
            />
          </>
        )}
        {tab === 5 && (
          <>
            <h2>历史、材料许可与原发布恢复</h2>
            <label>
              领域
              <select aria-label="领域" value={domain} onChange={(e) => setDomain(e.target.value)}>
                {Object.entries(labels).map(([d, title]) => (
                  <option key={d} value={d}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <SuitePublicationRecoveryPanel
              domain={domain}
              workspaceId={workspaceId}
              invoke={invoke}
              run={run}
              preview={preview}
            />
            {rows(domain).map((row) => (
              <article className="suite-card" key={key(row)}>
                <strong>
                  {row.name} · {row.revision.slice(0, 10)} · {row.origin === 'local' ? '本机' : '外来参考'}
                </strong>
                <details>
                  <summary>固定记录</summary>
                  <pre>{JSON.stringify(row.content, null, 2)}</pre>
                </details>
                <button
                  onClick={() =>
                    void run(() =>
                      invoke(domain, 'archive', { ...scope, id: row.id, revision: row.revision }),
                    )
                  }
                >
                  归档此修订
                </button>
                <button
                  onClick={() =>
                    void preview(domain, 'previewCleanup', { ...scope, references: [ref(row)] }, 'cleanup')
                  }
                >
                  预览清理
                </button>
                {domain === 'targets' && row.kind === 'source' && (
                  <>
                    <button
                      onClick={() =>
                        void preview(
                          'targets',
                          'planPolicy',
                          {
                            ...scope,
                            id: row.id,
                            revision: row.revision,
                            expectedPolicyRevision: row.policyRevision,
                            allowRead: true,
                            allowExport: true,
                          },
                          'applyPolicy',
                        )
                      }
                    >
                      预览允许导出
                    </button>
                    <button
                      onClick={() =>
                        void preview(
                          'targets',
                          'planPolicy',
                          {
                            ...scope,
                            id: row.id,
                            revision: row.revision,
                            expectedPolicyRevision: row.policyRevision,
                            allowRead: false,
                            allowExport: false,
                          },
                          'applyPolicy',
                        )
                      }
                    >
                      预览撤销材料许可
                    </button>
                  </>
                )}
              </article>
            ))}
          </>
        )}
      </fieldset>
      <div className="suite-actions">
        <button disabled={busy || cursor === 0} onClick={() => setCursor(Math.max(0, cursor - 20))}>
          上一页
        </button>
        <span>记录偏移 {cursor}</span>
        <button
          disabled={busy || !view?.domains.some((d) => d.next !== null)}
          onClick={() => setCursor(cursor + 20)}
        >
          下一页
        </button>
        <button disabled={busy} onClick={() => void run(reload, '已刷新')}>
          刷新
        </button>
      </div>
      {result !== undefined && (
        <details>
          <summary>最近操作结果</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
      {pending && (
        <SuitePlanDialog
          value={pending.plan}
          busy={busy}
          onApprove={() =>
            void run(async () => {
              const row = await invoke(pending.domain, pending.apply, {
                ...scope,
                planId: pending.plan.id,
                digest: pending.plan.digest,
              });
              setPending(undefined);
              return row;
            })
          }
          onCancel={() => {
            const value = pending;
            setPending(undefined);
            if (value.domain === 'runners' && value.apply === 'start')
              void run(
                () =>
                  invoke('runners', 'discardPreview', {
                    ...scope,
                    planId: value.plan.id,
                    digest: value.plan.digest,
                  }),
                '已释放未执行的运行预览',
              );
          }}
        />
      )}
    </>
  );
}
