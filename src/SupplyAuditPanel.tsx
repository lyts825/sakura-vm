/** 供应审查的材料、门槛、人工审阅、报告与交接流程。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Request } from './feature-shared';
import type * as S from '../shared/contracts/suite-common';
import * as A from '../shared/contracts/supply-audit';
import { supplyHttpSchemas, type SupplyDomain } from '../shared/contracts/supply-http';
import {
  useSuiteClient,
  suiteReference as ref,
  suiteReferenceKey as key,
  suiteBase64,
  suiteDigest,
} from './suite-client';
import './suite-workbench.css';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
const names: Record<SupplyDomain, string> = {
  sources: '材料与许可',
  inventory: '依赖清单',
  advisories: '公告匹配',
  licenses: '许可证',
  provenance: '来源信任',
  policies: '审查门槛',
  reviews: '人工审阅',
  reports: '审查报告',
  exchange: '离线交接',
  workbench: '步骤记录',
};
const tabs = ['开始', '材料', '审查', '审阅与报告', '离线交接', '历史与清理', '领域操作'] as const;
type Example = { workspace: S.SuiteWorkspace; example: S.SuiteRecord };
type Invoke = ReturnType<typeof useSuiteClient>;
type Rows = Partial<Record<SupplyDomain, S.SuitePage>>;
const bytesLabel = (n: number) => (n / 1024 ** 2).toFixed(1) + ' MiB';
export function SupplyAuditPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: string;
  authorized?: boolean;
}) {
  const epoch = useMemo(() => crypto.randomUUID(), [request, accessEpoch]);
  return authorized ? <SupplySpaces key={epoch} request={request} /> : <p>请解锁会话后查看供应审查。</p>;
}
function SupplySpaces({ request }: { request: Request }) {
  const invoke = useSuiteClient(request, 'supply', supplyHttpSchemas);
  const [spaces, setSpaces] = useState<S.SuiteWorkspace[]>([]),
    [id, setId] = useState(''),
    [name, setName] = useState(''),
    [template, setTemplate] = useState('empty'),
    [example, setExample] = useState<Example>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void invoke<S.SuiteWorkspace[]>('sources', 'listWorkspaces')
      .then(setSpaces)
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
  }, []);
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      if (template === 'empty') {
        const space = await invoke<S.SuiteWorkspace>('sources', 'createWorkspace', { name });
        setSpaces(await invoke('sources', 'listWorkspaces'));
        setId(space.id);
        setExample(undefined);
      } else {
        const result = await invoke<Example>('workbench', 'createExample', { name, template });
        setSpaces(await invoke('sources', 'listWorkspaces'));
        setExample(result);
        setId(result.workspace.id);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="suite-workbench">
      <header>
        <div>
          <small>SUPPLY AUDIT</small>
          <h1>软件供应审查</h1>
          <p>从固定依赖到人工决定，保留每一步的来源和修订。</p>
        </div>
        <span className="suite-chip">离线材料 · 10 个领域</span>
      </header>
      <section className="suite-space">
        <label>
          审查空间
          <select
            aria-label="审查空间"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setExample(undefined);
            }}
          >
            <option value="">选择空间</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id} disabled={s.revoked}>
                {s.name}
                {s.revoked ? '（已撤销）' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          新空间名称
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </label>
        <label>
          起点
          <select aria-label="起点" value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="empty">空白空间</option>
            <option value="npm-lock">前端锁文件样例</option>
            <option value="python-lock">Python 固定依赖样例</option>
            <option value="advisory-update">公告更新比较样例</option>
          </select>
        </label>
        <button disabled={busy || !name.trim()} onClick={() => void create()}>
          创建空间
        </button>
      </section>
      {error && (
        <p role="alert" className="suite-error">
          {error}
        </p>
      )}
      {id ? (
        <SupplyWorkspace
          key={id}
          request={request}
          workspaceId={id}
          example={example?.workspace.id === id ? example.example : undefined}
          onWorkspacesChanged={async () => setSpaces(await invoke('sources', 'listWorkspaces'))}
        />
      ) : (
        <section className="suite-empty">
          <h2>选择一个审查起点</h2>
          <p>
            上传锁文件和公告快照，或显式创建一个合成样例。创建样例只保存虚构材料；点击“运行审查”才会生成检查结果。
          </p>
        </section>
      )}
    </main>
  );
}
function RecordSelect({
  title,
  rows = [],
  value,
  onChange,
}: {
  title: string;
  rows?: S.SuiteRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {title}
      <select aria-label={title} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">选择固定修订</option>
        {rows
          .filter((r) => r.state === 'sealed')
          .map((r) => (
            <option value={key(r)} key={key(r)}>
              {r.name} · {r.revision.slice(0, 8)}
              {r.origin === 'imported' ? ' · 导入参考' : ''}
            </option>
          ))}
      </select>
    </label>
  );
}
function SupplyWorkspace({
  request,
  workspaceId,
  example,
  onWorkspacesChanged,
}: {
  request: Request;
  workspaceId: string;
  example?: S.SuiteRecord;
  onWorkspacesChanged: () => Promise<void>;
}) {
  const invoke: Invoke = useSuiteClient(request, 'supply', supplyHttpSchemas),
    s = { workspaceId };
  const [tab, setTab] = useState<(typeof tabs)[number]>('开始'),
    [rows, setRows] = useState<Rows>({}),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false),
    alive = useRef(true),
    previewSequence = useRef(0);
  const [source, setSource] = useState(''),
    [advisory, setAdvisory] = useState(''),
    [policy, setPolicy] = useState(''),
    [reviewId, setReviewId] = useState(''),
    [result, setResult] = useState<S.SuiteRecord>();
  const [uploadName, setUploadName] = useState(''),
    [text, setText] = useState(''),
    [allowExport, setAllowExport] = useState(false),
    [file, setFile] = useState<File>();
  const [blockAt, setBlockAt] = useState('high'),
    [ageDays, setAgeDays] = useState(30),
    [licenses, setLicenses] = useState('MIT, Apache-2.0'),
    [requireTrust, setRequireTrust] = useState(false);
  const [note, setNote] = useState(''),
    [exceptions, setExceptions] = useState<string[]>([]),
    [expires, setExpires] = useState('');
  const [domain, setDomain] = useState<SupplyDomain>('sources'),
    [method, setMethod] = useState('list'),
    [input, setInput] = useState('{}');
  const [plan, setPlan] = useState<{ value: S.SuitePlan; domain: SupplyDomain; method: string }>();
  const [capacity, setCapacity] = useState<{ used: number; reserved: number; limit: number }>();
  const [transfers, setTransfers] = useState<S.SuiteUpload[]>([]);
  const list = (d: SupplyDomain) => rows[d]?.items ?? [];
  const find = (d: SupplyDomain, value: string) => list(d).find((r) => key(r) === value);
  const refresh = async () => {
    const entries = await Promise.all(
      (Object.keys(names) as SupplyDomain[]).map(
        async (d) =>
          [
            d,
            await invoke<S.SuitePage>(d, 'list', { ...s, limit: 50, history: true, archived: true }),
          ] as const,
      ),
    );
    setRows(Object.fromEntries(entries));
    setCapacity(await invoke('sources', 'capacity', s));
    setTransfers(await invoke('exchange', 'transfers', s));
  };
  useEffect(() => {
    alive.current = true;
    void refresh()
      .then(() => {
        if (
          example &&
          example.content &&
          typeof example.content === 'object' &&
          !Array.isArray(example.content)
        ) {
          const c = example.content as Record<string, S.SuiteJson>;
          for (const [field, setter] of [
            ['source', setSource],
            ['advisorySource', setAdvisory],
            ['policy', setPolicy],
          ] as const) {
            const value = c[field];
            if (
              value &&
              typeof value === 'object' &&
              !Array.isArray(value) &&
              typeof value.id === 'string' &&
              typeof value.revision === 'string'
            )
              setter(key(value as S.SuiteRef));
          }
        }
      })
      .catch((e) => {
        if (alive.current && e.name !== 'AbortError') setError(e.message);
      });
    return () => {
      alive.current = false;
    };
  }, []);
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
    } catch (e) {
      if (alive.current && (e as Error).name !== 'AbortError') {
        setError((e as Error).message);
        if (/401|403|许可|撤销|认证/.test((e as Error).message)) {
          setRows({});
          setResult(undefined);
          setPlan(undefined);
        }
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const preview = async (d: SupplyDomain, action: string, payload: unknown, apply: string) => {
    const value = await invoke<S.SuitePlan>(d, action, payload);
    previewSequence.current++;
    setPlan({ value, domain: d, method: apply });
  };
  const upload = async () => {
    if (!file)
      return invoke<S.SuiteRecord>('sources', 'upload', {
        ...s,
        name: uploadName,
        text,
        format: text.trim().startsWith('{') ? 'json' : 'text',
        allowExport,
      });
    if (file.size > 64 * 1024 ** 2) throw new Error('单个材料最多 64 MiB');
    const bytes = new Uint8Array(await file.arrayBuffer()),
      digest = await suiteDigest(bytes);
    const ticket = await invoke<S.SuiteUpload>('sources', 'beginUpload', {
      ...s,
      name: uploadName || file.name,
      bytes: bytes.length,
      digest,
      format: file.name.endsWith('.json') ? 'json' : 'text',
      allowExport,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await invoke('sources', 'appendUpload', {
        ...s,
        id: ticket.id,
        offset,
        data: suiteBase64(bytes.subarray(offset, offset + 512 * 1024)),
      });
    return invoke<S.SuiteRecord>('sources', 'finishUpload', { ...s, id: ticket.id });
  };
  const selectedReview = find('reviews', reviewId),
    review = selectedReview ? A.supplyReview.safeParse(selectedReview.content) : undefined;
  const evaluation = review?.success
    ? list('policies').find(
        (r) => r.id === review.data.evaluation.id && r.revision === review.data.evaluation.revision,
      )
    : undefined;
  const evaluationValue = evaluation ? A.supplyEvaluation.safeParse(evaluation.content) : undefined;
  const take = (d: SupplyDomain, value: string) => {
    const row = find(d, value);
    if (!row) throw new Error('请选择固定修订');
    return ref(row);
  };
  const chooseDomain = (d: SupplyDomain) => {
    setDomain(d);
    setMethod('list');
    setInput('{}');
  };
  return (
    <>
      <nav aria-label="供应审查步骤">
        {tabs.map((t) => (
          <button className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="suite-toolbar">
        <span>
          {capacity
            ? `已用 ${bytesLabel(capacity.used)} · 预留 ${bytesLabel(capacity.reserved)} · 总额 ${bytesLabel(capacity.limit)}`
            : '正在核对容量'}
        </span>
        <button disabled={busy} onClick={() => void run(refresh, '已刷新')}>
          刷新
        </button>
      </div>
      {error && (
        <p className="suite-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">正在处理，请稍候…</p>}
      <fieldset disabled={busy} className="suite-body">
        {tab === '开始' && (
          <section className="suite-empty">
            <h2>完成一次有边界的审查</h2>
            <ol>
              <li>在“材料”上传锁文件及离线公告快照，明确是否允许导出。</li>
              <li>在“审查”选择固定材料及门槛，运行依赖、公告、许可和来源检查。</li>
              <li>在“审阅与报告”逐项决定；每条例外都必须注明理由和绝对到期时间。</li>
              <li>封存报告，预览交接范围后导出。导入材料需隔离核对后显式接收。</li>
            </ol>
            <p>
              未知规则、缺少哈希或来源证明会如实显示。报告只覆盖导入的依赖材料；许可证声明检查保留人工法律判断。
            </p>
            <button onClick={() => setTab('材料')}>准备材料</button>
            {example && <button onClick={() => setTab('审查')}>使用合成样例开始审查</button>}
          </section>
        )}
        {tab === '材料' && (
          <div className="suite-grid">
            <article>
              <h2>导入固定材料</h2>
              <label>
                材料名称
                <input value={uploadName} onChange={(e) => setUploadName(e.target.value)} />
              </label>
              <label>
                文件
                <input type="file" onChange={(e) => setFile(e.target.files?.[0])} />
              </label>
              <label>
                或粘贴文本（最多 1 MiB）
                <textarea value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <label className="suite-check">
                <input
                  type="checkbox"
                  checked={allowExport}
                  onChange={(e) => setAllowExport(e.target.checked)}
                />
                允许将原始材料放入交接包
              </label>
              <button disabled={!file && (!text || !uploadName)} onClick={() => void run(upload)}>
                保存固定材料
              </button>
              <p>
                npm lock 2/3、带 SHA-256 的 Python 精确依赖清单，以及本包组件 JSON。公告使用
                sakura-advisories/1。
              </p>
            </article>
            <article>
              <h2>材料与当前许可</h2>
              {list('sources')
                .filter((r) => r.kind === 'source')
                .map((r) => (
                  <div className="suite-card" key={key(r)}>
                    <strong>{r.name}</strong>
                    <code>{r.revision}</code>
                    <p>
                      {r.state === 'archived' ? '已归档' : '固定材料'} · 修订 {r.sequence}
                    </p>
                    <button onClick={() => setResult(r)}>查看记录</button>
                    <button
                      onClick={() =>
                        void run(async () => {
                          const p = await invoke<{
                            allowRead: boolean;
                            allowExport: boolean;
                            revision: number;
                          }>('sources', 'policy', { ...s, id: r.id, revision: r.revision });
                          await preview(
                            'sources',
                            'planPolicy',
                            {
                              ...s,
                              id: r.id,
                              revision: r.revision,
                              expectedPolicyRevision: p.revision,
                              allowRead: !p.allowRead,
                              allowExport: false,
                            },
                            'applyPolicy',
                          );
                        }, '请核对许可变更计划')
                      }
                    >
                      撤销／恢复读取许可
                    </button>
                    <button
                      onClick={() =>
                        void run(async () => {
                          const p = await invoke<{
                            allowRead: boolean;
                            allowExport: boolean;
                            revision: number;
                          }>('sources', 'policy', { ...s, id: r.id, revision: r.revision });
                          await preview(
                            'sources',
                            'planPolicy',
                            {
                              ...s,
                              id: r.id,
                              revision: r.revision,
                              expectedPolicyRevision: p.revision,
                              allowRead: p.allowRead,
                              allowExport: !p.allowExport,
                            },
                            'applyPolicy',
                          );
                        }, '请核对导出许可变更')
                      }
                    >
                      切换导出许可
                    </button>
                  </div>
                ))}
            </article>
          </div>
        )}
        {tab === '审查' && (
          <div className="suite-grid">
            <article>
              <h2>固定本次输入</h2>
              <RecordSelect title="依赖材料" rows={list('sources')} value={source} onChange={setSource} />
              <RecordSelect
                title="公告原始快照"
                rows={list('sources')}
                value={advisory}
                onChange={setAdvisory}
              />
              <RecordSelect
                title="封存门槛"
                rows={list('policies').filter((r) => r.kind === 'definition')}
                value={policy}
                onChange={setPolicy}
              />
              <button
                disabled={!source || !advisory || !policy}
                onClick={() =>
                  void run(async () => {
                    const value = await invoke<{
                      run: S.SuiteRecord;
                      evaluation: S.SuiteRecord;
                      review: S.SuiteRecord;
                    }>('workbench', 'runChecks', {
                      ...s,
                      source: take('sources', source),
                      advisorySource: take('sources', advisory),
                      policy: take('policies', policy),
                    });
                    setReviewId(key(value.review));
                    setTab('审阅与报告');
                    return value.evaluation;
                  }, '审查已执行，等待人工审阅')
                }
              >
                运行审查
              </button>
              <p>此流程保留未提供来源证明的结果。已登记公钥的签名核验和证据重评可在“领域操作”完成。</p>
            </article>
            <article>
              <h2>创建审查门槛</h2>
              <label>
                阻断严重度
                <select aria-label="阻断严重度" value={blockAt} onChange={(e) => setBlockAt(e.target.value)}>
                  {['critical', 'high', 'medium', 'low'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label>
                公告最长时效（天）
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={ageDays}
                  onChange={(e) => setAgeDays(Number(e.target.value))}
                />
              </label>
              <label>
                允许的许可证声明
                <input value={licenses} onChange={(e) => setLicenses(e.target.value)} />
              </label>
              <label className="suite-check">
                <input
                  type="checkbox"
                  checked={requireTrust}
                  onChange={(e) => setRequireTrust(e.target.checked)}
                />
                要求已信任的来源签名
              </label>
              <button
                onClick={() =>
                  void run(async () => {
                    const record = await invoke<S.SuiteRecord>('policies', 'save', {
                      ...s,
                      name: '审查门槛',
                      references: [],
                      content: {
                        name: '工作空间门槛',
                        blockAt,
                        maxAgeDays: ageDays,
                        unknown: 'block',
                        allowedLicenses: licenses
                          .split(',')
                          .map((x) => x.trim())
                          .filter(Boolean),
                        requireTrustedProvenance: requireTrust,
                      },
                    });
                    await invoke('policies', 'seal', { ...s, id: record.id, revision: record.revision });
                    setPolicy(key(record));
                    return record;
                  })
                }
              >
                保存并封存门槛
              </button>
            </article>
          </div>
        )}
        {tab === '审阅与报告' && (
          <section>
            <h2>逐项审阅</h2>
            <RecordSelect
              title="待审阅记录"
              rows={list('reviews')}
              value={reviewId}
              onChange={(value) => {
                setReviewId(value);
                setExceptions([]);
              }}
            />
            {review?.success && (
              <>
                <p>状态：{review.data.status} · 所有者分阶段审阅</p>
                {evaluationValue?.success ? (
                  <>
                    <p>
                      评估：{evaluationValue.data.result} · {evaluationValue.data.findings.length} 个问题
                    </p>
                    {evaluationValue.data.findings.map((f) => (
                      <div className="suite-card" key={f.id}>
                        <strong>{f.message}</strong>
                        <p>
                          {f.severity} · {f.category}
                        </p>
                        <code>{f.component}</code>
                        <label className="suite-check">
                          <input
                            type="checkbox"
                            checked={exceptions.includes(f.id)}
                            onChange={(e) =>
                              setExceptions(
                                e.target.checked
                                  ? [...exceptions, f.id]
                                  : exceptions.filter((x) => x !== f.id),
                              )
                            }
                          />
                          为本问题申请限时用途例外
                        </label>
                      </div>
                    ))}
                  </>
                ) : (
                  <p>请在“领域操作”读取对应的固定评估修订。</p>
                )}
                <label>
                  决定与例外理由
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
                <label>
                  例外到期时间（本地时间，最多 30 天）
                  <input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
                </label>
                <button
                  disabled={!note || (exceptions.length > 0 && !expires)}
                  onClick={() =>
                    void run(async () => {
                      const row = await invoke<S.SuiteRecord>('reviews', 'decide', {
                        ...s,
                        review: take('reviews', reviewId),
                        decision: 'accept',
                        note,
                        exceptions: exceptions.map((findingId) => ({
                          findingId,
                          reason: note,
                          expiresAt: new Date(expires).toISOString(),
                        })),
                      });
                      setReviewId(key(row));
                      return row;
                    }, '已记录本次用途决定')
                  }
                >
                  接受此次用途
                </button>
                <button
                  disabled={!note}
                  onClick={() =>
                    void run(async () => {
                      const row = await invoke<S.SuiteRecord>('reviews', 'decide', {
                        ...s,
                        review: take('reviews', reviewId),
                        decision: 'reject',
                        note,
                        exceptions: [],
                      });
                      setReviewId(key(row));
                      return row;
                    })
                  }
                >
                  拒绝
                </button>
                <button
                  onClick={() =>
                    void run(async () => {
                      const status = await invoke<{ valid: boolean; expired: string[] }>(
                        'reviews',
                        'recheck',
                        { ...s, review: take('reviews', reviewId) },
                      );
                      setNotice(JSON.stringify(status));
                    }, '已重新核对当前例外')
                  }
                >
                  核对到期状态
                </button>
                <button
                  disabled={review.data.status !== 'accepted'}
                  onClick={() =>
                    void run(
                      () =>
                        invoke('reports', 'seal', {
                          ...s,
                          evaluation: review.data.evaluation,
                          review: take('reviews', reviewId),
                        }),
                      '报告已封存；当前有效性仍需核对来源及例外',
                    )
                  }
                >
                  封存审查报告
                </button>
              </>
            )}
          </section>
        )}
        {tab === '离线交接' && (
          <SuiteExchangePanel
            invoke={invoke}
            workspaceId={workspaceId}
            domains={names}
            records={Object.fromEntries((Object.keys(names) as SupplyDomain[]).map((d) => [d, list(d)]))}
            transfers={transfers}
            busy={busy}
            run={run}
            preview={(d, action, input, apply) => preview(d as SupplyDomain, action, input, apply)}
            onAccepted={onWorkspacesChanged}
            downloadName="supply-audit.zip"
          />
        )}
        {tab === '历史与清理' && (
          <section>
            <h2>固定历史与原资源清理</h2>
            <SuitePublicationRecoveryPanel
              key={domain}
              domain={domain}
              workspaceId={workspaceId}
              invoke={invoke}
              run={(work, message) => run(work, message, false)}
              preview={(d, action, input, apply) => preview(d as SupplyDomain, action, input, apply)}
            />
            <label>
              领域
              <select
                aria-label="领域"
                value={domain}
                onChange={(e) => chooseDomain(e.target.value as SupplyDomain)}
              >
                {Object.entries(names).map(([d, n]) => (
                  <option key={d} value={d}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <p>清理需先归档，并核对保护引用。失败或中断的清理保留原计划，可用同一批准继续核销。</p>
            {list(domain).map((r) => (
              <div className="suite-card" key={key(r)}>
                <strong>{r.name}</strong>
                <p>
                  {r.state} · {r.kind} · 修订 {r.sequence}
                </p>
                <code>
                  {r.id} / {r.revision}
                </code>
                <button onClick={() => setResult(r)}>查看</button>
                <button
                  onClick={() =>
                    void run(async () => {
                      const value = await invoke<{ holders: string[] }>(domain, 'references', {
                        ...s,
                        id: r.id,
                        revision: r.revision,
                      });
                      setNotice(value.holders.length ? value.holders.join('，') : '无保护引用');
                    }, '引用核对完成')
                  }
                >
                  保护引用
                </button>
                {r.state === 'archived' ? (
                  <button
                    onClick={() =>
                      void run(
                        () => preview(domain, 'previewCleanup', { ...s, references: [ref(r)] }, 'cleanup'),
                        '请核对原资源清理计划',
                      )
                    }
                  >
                    预览清理
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      void run(() => invoke(domain, 'archive', { ...s, id: r.id, revision: r.revision }))
                    }
                  >
                    归档
                  </button>
                )}
              </div>
            ))}
            {rows[domain]?.next !== null && rows[domain]?.next !== undefined && (
              <button
                onClick={() =>
                  void run(
                    async () => {
                      const next = await invoke<S.SuitePage>(domain, 'list', {
                        ...s,
                        history: true,
                        archived: true,
                        limit: 50,
                        cursor: rows[domain]!.next,
                      });
                      setRows((previous) => ({
                        ...previous,
                        [domain]: {
                          items: [...(previous[domain]?.items ?? []), ...next.items],
                          next: next.next,
                        },
                      }));
                    },
                    '已加载下一页',
                    false,
                  )
                }
              >
                加载更多历史
              </button>
            )}
          </section>
        )}
        {tab === '领域操作' && (
          <section>
            <h2>精确领域操作</h2>
            <p>
              用于公钥登记、固定签名核验、两版比较和已有任务恢复。选择已登记的业务动作，工作空间由当前选择固定。
            </p>
            <div className="suite-space">
              <label>
                领域
                <select
                  aria-label="领域"
                  value={domain}
                  onChange={(e) => chooseDomain(e.target.value as SupplyDomain)}
                >
                  {Object.entries(names).map(([d, n]) => (
                    <option key={d} value={d}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                动作
                <select aria-label="动作" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {Object.keys(supplyHttpSchemas[domain]).map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              业务参数 JSON
              <textarea
                className="suite-code"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
              />
            </label>
            <button
              onClick={() =>
                void run(async () => {
                  const payload = JSON.parse(input);
                  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                    throw new Error('参数须为 JSON 对象');
                  const value = await invoke<unknown>(domain, method, { ...payload, ...s });
                  setNotice(JSON.stringify(value, null, 2));
                  if (value && typeof value === 'object' && 'revision' in value) return value;
                }, '业务动作已返回')
              }
            >
              执行所选动作
            </button>
            <details>
              <summary>当前动作输入格式</summary>
              <p>
                可通过 CLI 的 help 查看固定命令。引用格式为 {`{domain,id,revision}`}，更新定义同时提供 id 和
                expectedRevision。
              </p>
            </details>
          </section>
        )}
      </fieldset>
      {result && (
        <details open className="suite-result">
          <summary>最近固定结果 · {result.name}</summary>
          <p>
            {result.domain} · {result.origin === 'imported' ? '导入参考' : '本地记录'}
          </p>
          <code>
            {result.id} / {result.revision}
          </code>
          <pre>{JSON.stringify(result.content, null, 2)}</pre>
        </details>
      )}
      {plan && (
        <SuitePlanDialog
          value={plan.value}
          busy={busy}
          onCancel={() => setPlan(undefined)}
          onApprove={() =>
            void run(async () => {
              const value = await invoke<S.SuiteRecord>(plan.domain, plan.method, {
                ...s,
                planId: plan.value.id,
                digest: plan.value.digest,
              });
              if (['acceptImport', 'recoverImport'].includes(plan.method)) await onWorkspacesChanged();
              setPlan(undefined);
              return value;
            }, '原计划已执行，结果已保存')
          }
        />
      )}
    </>
  );
}
