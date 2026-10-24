/** 零 VM 首用、固定审批和可核销运行界面。 Zero-VM onboarding, fixed approvals and accountable runs. */
import { useEffect, useState } from 'react';
import type { PluginPageProps } from './plugin-client';
import {
  resilienceResponses,
  resilienceTemplates,
  type ResiliencePlan,
  type ResilienceScenario,
  type ResilienceCleanup,
  type ResilienceImport,
} from '../shared/contracts/resilience-lab';
import type { ImageAsset } from '../shared/contracts/image-assets';
import type { z } from 'zod';
import './resilience-lab.css';
import './plugin-fonts.css';
type View = z.infer<typeof resilienceResponses.workbench.view>;
export function ResilienceLabPanel({ request }: PluginPageProps) {
  const [workspace, setWorkspace] = useState('local'),
    [tab, setTab] = useState('来源与样本'),
    [view, setView] = useState<View>(),
    [images, setImages] = useState<ImageAsset[]>([]),
    [scenarios, setScenarios] = useState<ResilienceScenario[]>([]),
    [image, setImage] = useState(''),
    [target, setTarget] = useState(''),
    [scenario, setScenario] = useState(''),
    [template, setTemplate] = useState(''),
    [name, setName] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [plan, setPlan] = useState<ResiliencePlan>(),
    [cleanup, setCleanup] = useState<ResilienceCleanup>(),
    [imported, setImported] = useState<Omit<ResilienceImport, 'report'>>(),
    [imports, setImports] = useState<Omit<ResilienceImport, 'report'>[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [detail, setDetail] = useState<unknown>(),
    [left, setLeft] = useState(''),
    [right, setRight] = useState('');
  const [retention, setRetention] = useState<z.infer<typeof resilienceResponses.reports.retention>>([]);
  const scope = { workspaceId: workspace };
  const [imageFile, setImageFile] = useState<File>(),
    [imageDigest, setImageDigest] = useState(''),
    [imageDistro, setImageDistro] = useState<'alpine' | 'debian' | 'ubuntu'>('alpine'),
    [uploadProgress, setUploadProgress] = useState('');
  const [duration, setDuration] = useState(10),
    [delayMs, setDelayMs] = useState(100),
    [jitterMs, setJitterMs] = useState(10),
    [lossPercent, setLossPercent] = useState(0),
    [cpuPercent, setCpuPercent] = useState(30),
    [minimumSamples, setMinimumSamples] = useState(10),
    [maxErrors, setMaxErrors] = useState(0),
    [maxP95Ms, setMaxP95Ms] = useState(3000);
  const read = async (domain: string, method = 'view', query = '') =>
    request(`/resilience-${domain}/${method}?workspaceId=${encodeURIComponent(workspace)}${query}`);
  const post = async (domain: string, method: string, input: object = {}) =>
    request(`/resilience-${domain}/${method}`, 'POST', { scope, ...input });
  async function refresh() {
    const [v, i, s, policies, importedHistory] = await Promise.all([
      read('workbench'),
      read('fixtures', 'sources'),
      read('scenarios'),
      read('reports', 'retention'),
      read('reports', 'imports'),
    ]);
    setView(resilienceResponses.workbench.view.parse(v));
    setImages(resilienceResponses.fixtures.sources.parse(i));
    setScenarios(resilienceResponses.scenarios.view.parse(s));
    setRetention(resilienceResponses.reports.retention.parse(policies));
    setImports(resilienceResponses.reports.imports.parse(importedHistory));
  }
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      const value = await work();
      if (value !== undefined) setDetail(value);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setView(undefined);
    setImage('');
    setTarget('');
    setScenario('');
    setPlan(undefined);
    setCleanup(undefined);
    setImported(undefined);
    setImports([]);
    setDetail(undefined);
    setLeft('');
    setRight('');
    void act(refresh);
  }, [workspace, request]);
  const chosenTarget = view?.targets.find((t) => t.id === target),
    chosenTemplate = resilienceTemplates.find((t) => t.id === template),
    chosenScenario = scenarios.find((s) => s.id === scenario);
  const download = (value: unknown, id: string) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' })),
      a = document.createElement('a');
    a.href = url;
    a.download = 'resilience-' + id + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  async function uploadImage() {
    if (!imageFile) throw new Error('请选择本地 qcow2 文件');
    let upload = resilienceResponses.fixtures.beginImport.parse(
      await post('fixtures', 'beginImport', {
        input: {
          digest: imageDigest,
          bytes: imageFile.size,
          distro: imageDistro,
          architecture: 'x86_64',
          source: imageFile.name,
        },
      }),
    );
    for (let offset = 0; offset < imageFile.size;) {
      const bytes = new Uint8Array(await imageFile.slice(offset, offset + 512 * 1024).arrayBuffer());
      let binary = '';
      for (let n = 0; n < bytes.length; n += 8192)
        binary += String.fromCharCode(...bytes.subarray(n, n + 8192));
      upload = resilienceResponses.fixtures.appendImport.parse(
        await post('fixtures', 'appendImport', { id: upload.id, offset, data: btoa(binary) }),
      );
      offset = upload.offset;
      setUploadProgress(`${offset} / ${imageFile.size} 字节`);
    }
    const result = await post('fixtures', 'finishImport', { id: upload.id });
    setUploadProgress('已校验完整镜像摘要');
    return result;
  }
  return (
    <section className="resilience-lab">
      <header>
        <div>
          <h2>可靠性演练</h2>
          <p>固定来源 → 正常基线 → 有期限故障 → 恢复验证 → 证据与清理</p>
        </div>
        <label>
          档案范围
          <input value={workspace} onChange={(e) => setWorkspace(e.target.value)} disabled={busy} />
        </label>
        <button disabled={busy} onClick={() => void act(refresh)}>
          刷新
        </button>
      </header>
      <p className={view?.capabilities.available ? 'resilience-ready' : 'resilience-gap'}>
        {view?.capabilities.available ? '双层监管就绪' : '故障执行尚未就绪'}
        {view?.capabilities.gaps.length ? '：' + view.capabilities.gaps.join('；') : ''}
      </p>
      <nav aria-label="可靠性演练分区">
        {['来源与样本', '场景', '运行', '报告', '待处理资源'].map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="resilience-error">
          {error}
        </p>
      )}
      {tab === '来源与样本' && (
        <article>
          <h3>准备来源</h3>
          <p>
            本地上传按 512 KiB 分块，服务端校验完整
            SHA-256。内置基础镜像可能需要下载，工具准备仍是单独步骤；演练运行阶段不会联网安装工具。
          </p>
          <div className="resilience-form">
            <label>
              本地 qcow2
              <input type="file" accept=".qcow2" onChange={(e) => setImageFile(e.target.files?.[0])} />
            </label>
            <label>
              SHA-256
              <input
                value={imageDigest}
                onChange={(e) => setImageDigest(e.target.value.trim())}
                placeholder="64 位摘要"
              />
            </label>
            <label>
              发行版
              <select
                value={imageDistro}
                onChange={(e) => setImageDistro(e.target.value as typeof imageDistro)}
              >
                <option value="alpine">Alpine</option>
                <option value="debian" disabled>
                  Debian（尚未支持）
                </option>
                <option value="ubuntu" disabled>
                  Ubuntu（尚未支持）
                </option>
              </select>
            </label>
            <button
              disabled={busy || !imageFile || !/^[a-f0-9]{64}$/.test(imageDigest)}
              onClick={() => void act(uploadImage)}
            >
              上传并固定镜像
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(() =>
                  post('fixtures', 'prepareBuiltin', { distro: imageDistro, architecture: 'x86_64' }),
                )
              }
            >
              显式准备内置基础镜像
            </button>
          </div>
          <p>{uploadProgress}</p>
          {view?.targets.map((t) => (
            <div key={t.id}>
              <span>
                {t.name}：创建 1 台 {t.memoryMiB} MiB / {t.cpus} vCPU 隔离副本，核验固定工具与双层监管。
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    post('fixtures', 'prepare', {
                      target: { id: t.id, revision: t.revision },
                      runId: crypto.randomUUID(),
                    }),
                  )
                }
              >
                显式预备与监管自检
              </button>
            </div>
          ))}
          <p>自检结束后，到“待处理资源”核销预备副本，再执行正式场景。</p>
        </article>
      )}
      {tab === '来源与样本' && (
        <>
          <p>
            选择已登记的本地固定镜像。合成样本包含 20 个带摘要的业务条目。镜像须具备 Python
            3、iproute2、netem、cgroup v2 和 tmpfs。登记来源不会创建实例。
          </p>
          <div className="resilience-form">
            <label>
              名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              固定镜像
              <select value={image} onChange={(e) => setImage(e.target.value)}>
                <option value="">请选择镜像</option>
                {images.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.distro} · {i.digest.slice(0, 16)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              我已审阅来源和隔离范围
            </label>
            <button
              disabled={busy || !image || !name || !reviewed}
              onClick={() =>
                void act(async () => {
                  const a = images.find((i) => i.id === image)!;
                  return post('targets', 'register', {
                    input: {
                      name,
                      image: { assetId: a.id, digest: a.digest },
                      source: 'local',
                      reviewed: true,
                      sampleCount: 20,
                      memoryMiB: 1024,
                      cpus: 1,
                    },
                  });
                })
              }
            >
              登记固定来源
            </button>
          </div>
          <ul>
            {view?.targets.map((t) => (
              <li key={t.id}>
                {t.name} · {t.sampleCount} 个合成条目 · {t.revision.slice(0, 16)}
              </li>
            ))}
          </ul>
        </>
      )}
      {tab === '场景' && (
        <>
          <div className="resilience-form">
            <label>
              固定来源
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">请选择来源</option>
                {view?.targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模板
              <select
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value);
                  const selected = resilienceTemplates.find((t) => t.id === e.target.value);
                  if (selected) {
                    setDuration(selected.fault.durationSeconds);
                    setDelayMs(selected.fault.delayMs);
                    setJitterMs(selected.fault.jitterMs);
                    setLossPercent(selected.fault.lossPercent);
                    setCpuPercent(selected.fault.cpuPercent);
                  }
                  setPlan(undefined);
                }}
              >
                <option value="">请选择模板</option>
                {resilienceTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              故障时长上限（秒）
              <input
                type="number"
                min={1}
                max={120}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </label>
            {chosenTemplate?.fault.fault === 'network' && (
              <>
                <label>
                  延迟（毫秒）
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={delayMs}
                    onChange={(e) => setDelayMs(Number(e.target.value))}
                  />
                </label>
                <label>
                  抖动（毫秒）
                  <input
                    type="number"
                    min={0}
                    max={Math.min(100, delayMs)}
                    value={jitterMs}
                    onChange={(e) => setJitterMs(Number(e.target.value))}
                  />
                </label>
                <label>
                  丢包率（%）
                  <input
                    type="number"
                    min={0}
                    max={10}
                    step={0.1}
                    value={lossPercent}
                    onChange={(e) => setLossPercent(Number(e.target.value))}
                  />
                </label>
              </>
            )}
            {chosenTemplate?.fault.fault === 'cpu' && (
              <label>
                CPU 配额（%）
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={cpuPercent}
                  onChange={(e) => setCpuPercent(Number(e.target.value))}
                />
              </label>
            )}
            <label>
              最少健康样本
              <input
                type="number"
                min={1}
                max={20000}
                value={minimumSamples}
                onChange={(e) => setMinimumSamples(Number(e.target.value))}
              />
            </label>
            <label>
              健康窗口允许错误
              <input
                type="number"
                min={0}
                value={maxErrors}
                onChange={(e) => setMaxErrors(Number(e.target.value))}
              />
            </label>
            <label>
              P95 上限（毫秒）
              <input
                type="number"
                min={1}
                value={maxP95Ms}
                onChange={(e) => setMaxP95Ms(Number(e.target.value))}
              />
            </label>
            <button
              disabled={busy || !chosenTarget || !chosenTemplate}
              onClick={() =>
                void act(() =>
                  post('scenarios', 'save', {
                    input: {
                      name: chosenTemplate!.name,
                      target: { id: chosenTarget!.id, revision: chosenTarget!.revision },
                      template: chosenTemplate!.id,
                      parameters: {
                        ...chosenTemplate!.fault,
                        durationSeconds: duration,
                        delayMs,
                        jitterMs,
                        lossPercent,
                        cpuPercent,
                      },
                      maxErrors,
                      minimumSamples,
                      maxP95Ms,
                    },
                  }),
                )
              }
            >
              保存新场景修订
            </button>
          </div>
          <p>正常基线和恢复稳定窗口各 60 秒。每次修改场景都需要新的预览和批准。</p>
          <label>
            执行场景
            <select
              value={scenario}
              onChange={(e) => {
                setScenario(e.target.value);
                setPlan(undefined);
              }}
            >
              <option value="">请选择场景</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.revision.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !chosenScenario}
            onClick={() =>
              void act(async () => {
                const p = resilienceResponses.runs.preview.parse(
                  await post('runs', 'preview', {
                    scenario: { id: chosenScenario!.id, revision: chosenScenario!.revision },
                  }),
                );
                setPlan(p);
                return p;
              })
            }
          >
            预览资源与故障计划
          </button>
          {plan && (
            <article>
              <h3>计划审阅</h3>
              <p>
                新建专用副本；最多同时 2 台，每台 {plan.target.memoryMiB} MiB / {plan.target.cpus}{' '}
                vCPU。故障上限 {plan.scenario.parameters.durationSeconds} 秒。计划摘要：
                <code>{plan.digest}</code>
              </p>
              <p>{plan.gaps.join('；')}</p>
              <button
                disabled={busy || plan.state !== 'previewed' || !!plan.gaps.length}
                onClick={() =>
                  void act(async () => {
                    const p = resilienceResponses.runs.approve.parse(
                      await post('runs', 'approve', { id: plan.id, digest: plan.digest }),
                    );
                    setPlan(p);
                    return p;
                  })
                }
              >
                批准此固定计划
              </button>
              <button
                disabled={busy || plan.state !== 'approved'}
                onClick={() =>
                  void act(async () => {
                    const result = await post('runs', 'start', { id: plan.id });
                    setPlan(undefined);
                    setTab('运行');
                    return result;
                  })
                }
              >
                执行已批准计划
              </button>
            </article>
          )}
        </>
      )}
      {tab === '运行' && (
        <>
          {!view?.runs.length && <p>尚无运行。保存、预览并批准场景后才创建副本。</p>}
          {view?.runs.map((r) => (
            <article key={r.id}>
              <h3>{r.plan.scenario.name}</h3>
              <p>
                阶段：{r.state} · 结果：{r.outcome} · 安全收尾：{r.containment} · 清理：{r.cleanup}
              </p>
              <code>{r.id}</code>
              {r.error && <p>{r.error}</p>}
              <div className="resilience-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => ({ run: r, probes: await read('probes', 'view', '&runId=' + r.id) }))
                  }
                >
                  查看证据
                </button>
                <button
                  disabled={busy || r.state === 'completed'}
                  onClick={() => void act(() => post('runs', 'cancel', { id: r.id }))}
                >
                  取消并收尾
                </button>
                <button
                  disabled={busy || r.state !== 'reconcile-required'}
                  onClick={() => void act(() => post('runs', 'reconcile', { id: r.id }))}
                >
                  核销原身份
                </button>
                <button
                  disabled={busy}
                  onClick={() => void act(() => post('reports', 'seal', { runId: r.id }))}
                >
                  封存当前证据
                </button>
              </div>
            </article>
          ))}
        </>
      )}
      {tab === '报告' && (
        <>
          <p>
            报告区分通过、未通过和不完整。导出摘要只证明文件一致性。外部报告作为参考，不获得本机执行权限。
          </p>
          <label>
            导入离线证据
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void act(async () => {
                    if (file.size > 200 * 1024 * 1024) throw new Error('证据包超过 200 MiB');
                    const result = resilienceResponses.reports.import.parse(
                      await post('reports', 'import', { bundle: JSON.parse(await file.text()) }),
                    );
                    setImported(result);
                    return result;
                  });
              }}
            />
          </label>
          <label>
            隔离导入历史
            <select
              value={imported?.id || ''}
              onChange={(event) => setImported(imports.find((item) => item.id === event.target.value))}
            >
              <option value="">请选择原导入记录</option>
              {imports.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.createdAt} · {item.state} · {item.digest.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
          {imported && (
            <article>
              <p>
                隔离状态：{imported.state} · 完整性：{imported.integrity} · 来源未认证
              </p>
              <p>{imported.findings.join('；')}</p>
              <button
                disabled={busy || imported.state === 'accepted'}
                onClick={() =>
                  void act(async () => {
                    const result = resilienceResponses.reports.accept.parse(
                      await post('reports', 'accept', { id: imported.id }),
                    );
                    setImported(result);
                    return result;
                  })
                }
              >
                接受为外部参考
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await post('reports', 'discardImport', { id: imported.id });
                    setImported(undefined);
                    return result;
                  })
                }
              >
                清理导入原包
              </button>
              <p>清理后释放导入额度，已接受的外部报告仍独立保留。</p>
            </article>
          )}
          {view?.reports.map((r) => (
            <article key={r.id}>
              <h3>
                {r.run.plan.scenario.name} · {r.classification}
              </h3>
              <p>
                {r.external ? '外部参考，来源未认证' : '本机证据'} · {r.createdAt}
              </p>
              <button onClick={() => setDetail(r)}>查看报告</button>
              <p>
                保留期限：{retention.find((p) => p.id === r.id)?.expiresAt} ·{' '}
                {retention.find((p) => p.id === r.id)?.pinned ? '已固定' : '未固定'}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    post('reports', 'pin', {
                      id: r.id,
                      pinned: !retention.find((p) => p.id === r.id)?.pinned,
                    }),
                  )
                }
              >
                {retention.find((p) => p.id === r.id)?.pinned ? '解除固定' : '固定报告'}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    download(await post('reports', 'export', { id: r.id }), r.id);
                  })
                }
              >
                导出离线包
              </button>
              <button
                disabled={busy || retention.find((p) => p.id === r.id)?.pinned}
                onClick={() => void act(() => post('reports', 'archive', { id: r.id }))}
              >
                归档并释放引用
              </button>
            </article>
          ))}
          <div className="resilience-form">
            {[
              ['左报告', left, setLeft],
              ['右报告', right, setRight],
            ].map(([label, value, set]) => (
              <label key={String(label)}>
                {String(label)}
                <select value={String(value)} onChange={(e) => (set as (v: string) => void)(e.target.value)}>
                  <option value="">请选择报告</option>
                  {view?.reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button
              disabled={busy || !left || !right}
              onClick={() => void act(() => post('reports', 'compare', { left, right }))}
            >
              比较来源与结果
            </button>
          </div>
        </>
      )}
      {tab === '待处理资源' && (
        <>
          {view?.replicas
            .filter((r) => r.cleanup !== 'confirmed')
            .map((r) => (
              <article key={r.id}>
                <h3>专用副本 {r.id.slice(0, 8)}</h3>
                <p>
                  {r.state} · 清理：{r.cleanup}
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const p = resilienceResponses.fixtures.cleanupPreview.parse(
                        await post('fixtures', 'cleanupPreview', { id: r.id }),
                      );
                      setCleanup(p);
                      return p;
                    })
                  }
                >
                  预览精确清理对象
                </button>
              </article>
            ))}
          {cleanup && (
            <article>
              <p>仅清理：{cleanup.resources.join('、')}</p>
              <code>{cleanup.digest}</code>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await post('fixtures', 'cleanup', { plan: cleanup });
                    setCleanup(undefined);
                    return result;
                  })
                }
              >
                执行此清理计划
              </button>
            </article>
          )}
        </>
      )}
      {detail !== undefined && (
        <details open>
          <summary>结构化证据</summary>
          <pre>{JSON.stringify(detail, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
