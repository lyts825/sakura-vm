/** 固定评测流程；发送和判分都通过原计划模态确认。 */
import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import type { Request } from './feature-shared';
import type * as S from '../shared/contracts/suite-common';
import * as E from '../shared/contracts/evaluation-studio';
import { evaluationHttpSchemas } from '../shared/contracts/evaluation-http';
import { useSuiteClient, suiteReference as ref, suiteReferenceKey as key } from './suite-client';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import './suite-workbench.css';
type Summary = z.infer<typeof E.evaluationSummary>;
const labels = {
  datasets: '样例集合',
  prompts: '提示词',
  endpoints: '本机端点',
  runners: '运行',
  scorers: '评分',
  comparisons: '配对比较',
  reviews: '人工审阅',
  reports: '评测报告',
  exchange: '隔离交换',
};
type Domain = keyof typeof labels;
const sample =
  '[\n  {"id":"sample-1","input":"今天的服务很好","reference":"正面","label":"分类","tags":[]}\n]';
export function EvaluationStudioPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: string;
  authorized?: boolean;
}) {
  const epoch = useMemo(() => crypto.randomUUID(), [request, accessEpoch]);
  return authorized ? <EvaluationSpaces key={epoch} request={request} /> : <p>请解锁会话后查看评测材料。</p>;
}
function EvaluationSpaces({ request }: { request: Request }) {
  const invoke = useSuiteClient(request, 'evaluation', evaluationHttpSchemas),
    [spaces, setSpaces] = useState<S.SuiteWorkspace[]>([]),
    [workspaceId, setWorkspaceId] = useState(''),
    [name, setName] = useState('模型评测'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const reload = async () => setSpaces(await invoke('datasets', 'listWorkspaces'));
  useEffect(() => {
    void reload().catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
  }, []);
  return (
    <main className="suite-workbench">
      <header>
        <div>
          <small>MODEL EVALUATION</small>
          <h1>模型评测工作台</h1>
          <p>固定样例与量表，逐样例比较文本结果，保留来源和适用限制。</p>
        </div>
        <span className="suite-chip">10 个领域 · 单账户审阅</span>
      </header>
      <section className="suite-space">
        <label>
          评测空间
          <select aria-label="评测空间" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
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
        <button
          disabled={busy || !name.trim()}
          onClick={() => {
            setBusy(true);
            void invoke<S.SuiteWorkspace>('datasets', 'createWorkspace', { name })
              .then(async (s) => {
                await reload();
                setWorkspaceId(s.id);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          创建空间
        </button>
      </section>
      {error && <p role="alert">{error}</p>}
      {workspaceId && (
        <EvaluationWorkspace
          key={workspaceId}
          workspaceId={workspaceId}
          request={request}
          onAccepted={reload}
        />
      )}
    </main>
  );
}
function EvaluationWorkspace({
  workspaceId,
  request,
  onAccepted,
}: {
  workspaceId: string;
  request: Request;
  onAccepted: () => Promise<void>;
}) {
  const invoke = useSuiteClient(request, 'evaluation', evaluationHttpSchemas),
    s = { workspaceId };
  const [tab, setTab] = useState<Domain>('datasets'),
    [rows, setRows] = useState<Record<string, Summary[]>>({}),
    [cursor, setCursor] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [details, setDetails] = useState<S.SuiteRecord>(),
    [history, setHistory] = useState<Summary[]>([]),
    [historyKey, setHistoryKey] = useState(''),
    [historyNext, setHistoryNext] = useState<number | null>(null),
    [plan, setPlan] = useState<{ value: S.SuitePlan; domain: string; apply: string }>(),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [exchangeRows, setExchangeRows] = useState<Record<string, S.SuiteRecord[]>>({});
  const [name, setName] = useState('固定评测材料'),
    [text, setText] = useState(sample),
    [reviewed, setReviewed] = useState(false),
    [allowSend, setAllowSend] = useState(false),
    [allowExport, setAllowExport] = useState(false),
    [role, setRole] = useState<'evaluation' | 'tuning'>('evaluation'),
    [ids, setIds] = useState('sample-1'),
    [reason, setReason] = useState(''),
    [template, setTemplate] = useState('把文本分类为正面或负面，仅输出分类：{{input}}'),
    [system, setSystem] = useState('仅回答提供的文本。没有工具或外部访问能力。'),
    [temperature, setTemperature] = useState(0),
    [maxTokens, setMaxTokens] = useState(512),
    [seed, setSeed] = useState(0),
    [url, setUrl] = useState('http://127.0.0.1:11434'),
    [model, setModel] = useState(''),
    [secretVm, setSecretVm] = useState(''),
    [secretName, setSecretName] = useState(''),
    [repeats, setRepeats] = useState(1),
    [outputs, setOutputs] = useState('[{"sampleId":"sample-1","text":"正面"}]'),
    [rule, setRule] = useState('{"kind":"exact","trim":true,"caseSensitive":true}'),
    [rubric, setRubric] = useState('根据固定参考答案评估准确性，0 表示不符合，1 表示符合。'),
    [human, setHuman] = useState('[{"sampleId":"sample-1","repeat":0,"value":1,"reason":"与固定答案一致"}]'),
    [blind, setBlind] = useState(true),
    [decision, setDecision] = useState<'accepted' | 'rejected'>('accepted'),
    [disagreements, setDisagreements] = useState(''),
    [summary, setSummary] = useState(''),
    [limitations, setLimitations] = useState('样例数量有限，结论仅适用于固定材料。'),
    [rendered, setRendered] = useState<{
      total: number;
      items: { sampleId: string; prompt: string; digest: string }[];
      next: number | null;
    }>(),
    [templates, setTemplates] = useState<z.infer<typeof E.evaluationTemplate>[]>([]);
  const reload = async (append = false, at = 0) => {
    const v = await invoke<z.infer<typeof E.evaluationWorkbenchView>>('workbench', 'view', {
      workspaceId,
      cursor: at,
      limit: 20,
    });
    setRows((prev) =>
      Object.fromEntries(
        v.domains.map((d) => [
          d.id.replace('evaluation-', ''),
          append
            ? [...(prev[d.id.replace('evaluation-', '')] ?? []), ...d.records].filter(
                (r, i, a) => a.findIndex((x) => key(x) === key(r)) === i,
              )
            : d.records,
        ]),
      ),
    );
    setCursor(at);
    setHasMore(v.domains.some((d) => d.next !== null));
  };
  useEffect(() => {
    void reload().catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    void invoke<z.infer<typeof E.evaluationTemplate>[]>('workbench', 'templates')
      .then(setTemplates)
      .catch(() => {});
  }, []);
  const remember = (row: S.SuiteRecord) => {
    setDetails(row);
    const domain = row.domain.replace('evaluation-', '');
    setSelected((prev) => ({ ...prev, [domain]: key(row) }));
  };
  const run = async (work: () => Promise<unknown>, message = '已保存固定记录', refresh = true) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const value = await work();
      if (value && typeof value === 'object' && 'domain' in value && 'revision' in value)
        remember(value as S.SuiteRecord);
      if (refresh) await reload();
      setNotice(message);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pick = (domain: string, slot = domain) => {
    const r = (rows[domain] ?? []).find((r) => key(r) === selected[slot]);
    if (!r) throw new Error('请选择' + labels[domain as Domain] + '的固定修订');
    return ref(r as S.SuiteRecord);
  };
  const choose = (domain: Domain, slot: string = domain, title = labels[domain]) => (
    <label>
      {title}
      <select
        aria-label={title}
        value={selected[slot] ?? ''}
        onChange={(e) => setSelected((prev) => ({ ...prev, [slot]: e.target.value }))}
      >
        <option value="">选择固定修订</option>
        {(rows[domain] ?? [])
          .filter((r) => r.state === 'sealed')
          .map((r) => (
            <option key={key(r)} value={key(r)}>
              {r.name} · {r.revision.slice(0, 8)}
              {r.origin === 'imported' ? ' · 导入参考' : ''}
              {r.kind === 'source' ? ' · 原始字节' : ''}
            </option>
          ))}
      </select>
    </label>
  );
  const preview = async (domain: string, action: string, input: unknown, apply: string) => {
    setPlan({ domain, apply, value: await invoke(domain, action, input) });
  };
  const inspect = () =>
    run(async () => {
      const r = pick(tab);
      const value = await invoke<S.SuiteRecord>(tab, 'get', { ...s, id: r.id, revision: r.revision });
      setDetails(value);
      return value;
    }, '已读取固定修订');
  const loadExchange = async () => {
    const reports = await invoke<S.SuitePage>('reports', 'list', { ...s, cursor: 0, limit: 100 }),
      exchange = await invoke<S.SuitePage>('exchange', 'list', { ...s, cursor: 0, limit: 100 });
    setExchangeRows({ reports: reports.items, exchange: exchange.items });
    setTransfers(await invoke('exchange', 'transfers', s));
  };
  return (
    <>
      <nav aria-label="评测步骤">
        {Object.entries(labels).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            disabled={busy}
            onClick={() => {
              setTab(id as Domain);
              setDetails(undefined);
              setHistory([]);
              setHistoryKey('');
              setHistoryNext(null);
              if (id === 'exchange') void run(loadExchange, '已读取交换记录');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <p>导入输出评估与真实模型运行分别标注。启用插件或打开页面不会发送样例。</p>
      <div className="suite-actions">
        <button disabled={busy} onClick={() => void run(() => reload(), '已刷新记录')}>
          刷新状态
        </button>
        <button
          disabled={busy || !hasMore}
          onClick={() => void run(() => reload(true, cursor + 20), '已加载后续记录', false)}
        >
          加载更多修订
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {tab !== 'exchange' && (
        <fieldset disabled={busy}>
          <legend>{labels[tab]}</legend>
          {choose(tab)}
          <button onClick={() => void inspect()}>查看选中材料</button>
          {tab === 'datasets' && (
            <div className="suite-columns">
              <article>
                <h2>固定已审阅样例</h2>
                <label>
                  建议模板
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const t = templates.find((t) => t.id === e.target.value);
                      if (t) {
                        setText(JSON.stringify(t.samples, null, 2));
                        setTemplate(t.template);
                        setRule(JSON.stringify(t.rule, null, 2));
                        setReviewed(false);
                      }
                    }}
                  >
                    <option value="">手工输入</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  名称
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  样例 JSON
                  <textarea
                    rows={10}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      setReviewed(false);
                    }}
                  />
                </label>
                <p>
                  每条样例有唯一 id、input、reference、label 和 tags。最多 100 条；上传固定输入最多 1 MiB。
                </p>
                <label>
                  用途
                  <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="evaluation">评估集</option>
                    <option value="tuning">调参集</option>
                  </select>
                </label>
                <label>
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                  已逐项审阅这些材料
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={allowSend}
                    onChange={(e) => setAllowSend(e.target.checked)}
                  />
                  允许在单独批准的本机模型计划中发送
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={allowExport}
                    onChange={(e) => setAllowExport(e.target.checked)}
                  />
                  允许将原始样例包含在人工审阅的报告导出中
                </label>
                <button
                  disabled={!reviewed}
                  onClick={() =>
                    void run(async () => {
                      const source = await invoke<S.SuiteRecord>('datasets', 'upload', {
                        ...s,
                        name,
                        text,
                        allowExport,
                      });
                      return invoke('datasets', 'pin', {
                        ...s,
                        source: ref(source),
                        role,
                        allowSend,
                        reviewed: true,
                      });
                    })
                  }
                >
                  上传并固定样例
                </button>
              </article>
              <article>
                <h2>子集与发送许可</h2>
                <label>
                  子集 ID（每行一个）
                  <textarea value={ids} onChange={(e) => setIds(e.target.value)} />
                </label>
                <button
                  onClick={() =>
                    void run(() =>
                      invoke('datasets', 'split', {
                        ...s,
                        dataset: pick('datasets'),
                        ids: ids.split(/\s+/).filter(Boolean),
                        role,
                      }),
                    )
                  }
                >
                  固定子集
                </button>
                <label>
                  许可变更原因
                  <input value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <button
                  disabled={!reason.trim()}
                  onClick={() =>
                    void run(() =>
                      invoke('datasets', 'allowSending', {
                        ...s,
                        dataset: pick('datasets'),
                        allowSend: false,
                        reason,
                      }),
                    )
                  }
                >
                  撤销选中修订的发送许可
                </button>
                <button
                  disabled={!reason.trim()}
                  onClick={() =>
                    void run(() =>
                      invoke('datasets', 'allowSending', {
                        ...s,
                        dataset: pick('datasets'),
                        allowSend: true,
                        reason,
                      }),
                    )
                  }
                >
                  生成允许发送的新修订
                </button>
                <p>许可变化后，旧提示词和旧计划不会自动获得新许可。</p>
              </article>
            </div>
          )}
          {tab === 'prompts' && (
            <article>
              {choose('datasets')}
              <label>
                名称
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                系统文本
                <textarea value={system} onChange={(e) => setSystem(e.target.value)} />
              </label>
              <label>
                固定模板
                <textarea rows={6} value={template} onChange={(e) => setTemplate(e.target.value)} />
              </label>
              <p>变量仅支持 {'{{input}}、{{id}}、{{label}}、{{reference}}'}；必须包含 input。</p>
              <label>
                温度
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                />
              </label>
              <label>
                输出 token 上限
                <input
                  type="number"
                  min="1"
                  max="4096"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                />
              </label>
              <label>
                种子
                <input type="number" min="0" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              </label>
              <button
                onClick={() =>
                  void run(() =>
                    invoke('prompts', 'compile', {
                      ...s,
                      dataset: pick('datasets'),
                      name,
                      system,
                      template,
                      options: { temperature, maxTokens, seed },
                    }),
                  )
                }
              >
                编译固定提示词
              </button>
              <button
                onClick={() =>
                  void run(
                    async () =>
                      setRendered(
                        await invoke('prompts', 'renderPreview', {
                          ...s,
                          prompt: pick('prompts'),
                          cursor: 0,
                          limit: 10,
                        }),
                      ),
                    '已展开提示词',
                  )
                }
              >
                预览展开文本
              </button>
              {rendered && (
                <>
                  <p>共 {rendered.total} 条样例</p>
                  <pre>{JSON.stringify(rendered.items, null, 2)}</pre>
                  {rendered.next !== null && (
                    <button
                      onClick={() =>
                        void run(
                          async () =>
                            setRendered(
                              await invoke('prompts', 'renderPreview', {
                                ...s,
                                prompt: pick('prompts'),
                                cursor: rendered.next,
                                limit: 10,
                              }),
                            ),
                          '已展开下一页',
                        )
                      }
                    >
                      下一页文本
                    </button>
                  )}
                </>
              )}
            </article>
          )}
          {tab === 'endpoints' && (
            <article>
              <p>首版使用回环 HTTP 地址、明确端口和本地 Ollama 文本协议。连接检查只读取模型元数据。</p>
              <label>
                名称
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                本机地址
                <input value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
              <label>
                模型名称
                <input value={model} onChange={(e) => setModel(e.target.value)} />
              </label>
              <label>
                私密配置所属 VM ID（可选）
                <input value={secretVm} onChange={(e) => setSecretVm(e.target.value)} />
              </label>
              <label>
                私密配置引用名称（可选）
                <input value={secretName} onChange={(e) => setSecretName(e.target.value)} />
              </label>
              <button
                onClick={() =>
                  void run(() =>
                    invoke('endpoints', 'register', {
                      ...s,
                      name,
                      url,
                      model,
                      secret: secretVm || secretName ? { vmId: secretVm, name: secretName } : null,
                    }),
                  )
                }
              >
                登记固定端点
              </button>
              <button
                onClick={() =>
                  void run(
                    () =>
                      preview(
                        'endpoints',
                        'previewConnection',
                        { ...s, endpoint: pick('endpoints') },
                        'check',
                      ),
                    '请核对连接计划',
                  )
                }
              >
                预览连接检查
              </button>
              <button
                onClick={() =>
                  void run(() => invoke('endpoints', 'revoke', { ...s, endpoint: pick('endpoints') }))
                }
              >
                撤销端点许可
              </button>
            </article>
          )}
          {tab === 'runners' && (
            <div className="suite-columns">
              <article>
                <h2>真实模型运行</h2>
                {choose('datasets')}
                {choose('prompts')}
                {choose('endpoints')}
                <label>
                  重复次数
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={repeats}
                    onChange={(e) => setRepeats(Number(e.target.value))}
                  />
                </label>
                <p>单计划最多 30 次调用；每次 60 秒。断线或取消后不会重发未知请求。</p>
                <button
                  onClick={() =>
                    void run(
                      () =>
                        preview(
                          'runners',
                          'preview',
                          {
                            ...s,
                            dataset: pick('datasets'),
                            prompt: pick('prompts'),
                            endpoint: pick('endpoints'),
                            repeats,
                          },
                          'start',
                        ),
                      '请核对完整发送材料',
                    )
                  }
                >
                  预览发送计划
                </button>
                <button
                  onClick={() =>
                    void run(
                      () => invoke('runners', 'inspect', { ...s, id: pick('runners').id }),
                      '已读取运行状态',
                    )
                  }
                >
                  查询最新状态
                </button>
                <button
                  onClick={() =>
                    void run(
                      () => invoke('runners', 'cancel', { ...s, id: pick('runners').id }),
                      '已请求取消并核对原调用',
                    )
                  }
                >
                  取消运行
                </button>
                <button
                  onClick={() =>
                    void run(
                      () => invoke('runners', 'reconcile', { ...s, id: pick('runners').id }),
                      '已核对原回执，未重发',
                    )
                  }
                >
                  恢复原回执
                </button>
              </article>
              <article>
                <h2>导入结果评估</h2>
                <label>
                  结果名称
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  固定输出 JSON
                  <textarea rows={9} value={outputs} onChange={(e) => setOutputs(e.target.value)} />
                </label>
                <p>格式为 sampleId 和 text；缺少的样例保持未发送。此操作不证明真实模型推理。</p>
                <button
                  onClick={() =>
                    void run(() =>
                      invoke('runners', 'importOutputs', {
                        ...s,
                        dataset: pick('datasets'),
                        prompt: pick('prompts'),
                        name,
                        outputs: JSON.parse(outputs),
                      }),
                    )
                  }
                >
                  固定导入结果
                </button>
              </article>
            </div>
          )}
          {tab === 'scorers' && (
            <div className="suite-columns">
              <article>
                {choose('runners')}
                <h2>规则与人工量表</h2>
                <label>
                  规则 JSON
                  <textarea value={rule} onChange={(e) => setRule(e.target.value)} />
                </label>
                <p>支持 exact、contains 和 json-fields；只使用固定字面规则。</p>
                <button
                  onClick={() =>
                    void run(() =>
                      invoke('scorers', 'evaluate', { ...s, run: pick('runners'), rule: JSON.parse(rule) }),
                    )
                  }
                >
                  计算规则评分
                </button>
                <label>
                  评分量表
                  <textarea value={rubric} onChange={(e) => setRubric(e.target.value)} />
                </label>
                <label>
                  人工评分 JSON
                  <textarea rows={7} value={human} onChange={(e) => setHuman(e.target.value)} />
                </label>
                <button
                  onClick={() =>
                    void run(() =>
                      invoke('scorers', 'scoreHuman', {
                        ...s,
                        run: pick('runners'),
                        rubric,
                        scores: JSON.parse(human),
                      }),
                    )
                  }
                >
                  保存单账户人工评分
                </button>
              </article>
              <article>
                <h2>独立模型判分</h2>
                {choose('endpoints')}
                <p>判分会另行发送样例、参考答案、回答及量表。最多 10 条；结果标记为模型意见。</p>
                <button
                  onClick={() =>
                    void run(
                      () =>
                        preview(
                          'scorers',
                          'planJudge',
                          { ...s, run: pick('runners'), endpoint: pick('endpoints'), rubric },
                          'applyJudge',
                        ),
                      '请核对独立判分发送计划',
                    )
                  }
                >
                  预览独立判分
                </button>
                <button
                  onClick={() =>
                    void run(
                      () => invoke('scorers', 'cancelJudge', { ...s, id: pick('scorers').id }),
                      '已停止判分或核对中断记录',
                    )
                  }
                >
                  取消或恢复中断判分
                </button>
              </article>
            </div>
          )}
          {tab === 'comparisons' && (
            <article>
              {choose('runners', 'left', '左侧运行')}
              {choose('runners', 'right', '右侧运行')}
              {choose('scorers', 'leftScore', '左侧评分')}
              {choose('scorers', 'rightScore', '右侧评分')}
              <button
                onClick={() =>
                  void run(() =>
                    invoke('comparisons', 'compare', {
                      ...s,
                      left: pick('runners', 'left'),
                      right: pick('runners', 'right'),
                      leftScore: pick('scorers', 'leftScore'),
                      rightScore: pick('scorers', 'rightScore'),
                    }),
                  )
                }
              >
                计算配对差异
              </button>
              <p>比较同时列出共同样例、缺失覆盖、改动输入、生成设置和评分依据。调参样例不会获得泛化结论。</p>
            </article>
          )}
          {tab === 'reviews' && (
            <article>
              {choose('comparisons')}
              <label>
                <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />以 A/B
                形式审阅（仍是当前单一账户）
              </label>
              <button
                onClick={() =>
                  void run(() => invoke('reviews', 'open', { ...s, comparison: pick('comparisons'), blind }))
                }
              >
                建立人工审阅
              </button>
              <label>
                决定
                <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
                  <option value="accepted">接受报告依据</option>
                  <option value="rejected">拒绝报告依据</option>
                </select>
              </label>
              <label>
                理由
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label>
                争议（每行一项）
                <textarea value={disagreements} onChange={(e) => setDisagreements(e.target.value)} />
              </label>
              <button
                disabled={!reason.trim()}
                onClick={() =>
                  void run(() =>
                    invoke('reviews', 'decide', {
                      ...s,
                      review: pick('reviews'),
                      decision,
                      reason,
                      disagreements: disagreements.split('\n').filter(Boolean),
                    }),
                  )
                }
              >
                保存审阅决定
              </button>
              <p>盲审是此页面的呈现方式，不隐藏账户可访问的来源，也不代表独立多人审阅。</p>
            </article>
          )}
          {tab === 'reports' && (
            <article>
              {choose('reviews')}
              <label>
                报告标题
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label>
                结论摘要
                <textarea rows={5} value={summary} onChange={(e) => setSummary(e.target.value)} />
              </label>
              <label>
                限制（每行一项）
                <textarea value={limitations} onChange={(e) => setLimitations(e.target.value)} />
              </label>
              <button
                disabled={!summary.trim()}
                onClick={() =>
                  void run(() =>
                    invoke('reports', 'sealReport', {
                      ...s,
                      review: pick('reviews'),
                      title: name,
                      summary,
                      limitations: limitations.split('\n').filter(Boolean),
                    }),
                  )
                }
              >
                封存评测报告
              </button>
              {choose('reports', 'before', '前一份报告')}
              {choose('reports', 'after', '后一份报告')}
              <button
                onClick={() =>
                  void run(() =>
                    invoke('reports', 'compare', {
                      ...s,
                      before: pick('reports', 'before'),
                      after: pick('reports', 'after'),
                    }),
                  )
                }
              >
                比较报告修订
              </button>
            </article>
          )}
        </fieldset>
      )}
      {tab === 'exchange' && (
        <SuiteExchangePanel
          invoke={invoke}
          workspaceId={workspaceId}
          domains={{ reports: '人工审阅的封存报告' }}
          records={exchangeRows}
          transfers={transfers}
          busy={busy}
          run={run}
          preview={preview}
          onAccepted={async () => {
            await loadExchange();
            await onAccepted();
          }}
          downloadName="model-evaluation.sakura"
          description="只导出当前人审仍被接受的封存报告及其固定引用。原始样例需要导出许可；密钥绑定和调用批准不会进入交接包。"
        />
      )}
      {details && (
        <article>
          <h2>{details.name}</h2>
          {details.domain === 'evaluation-comparisons' &&
            (() => {
              const c = E.evaluationComparison.safeParse(details.content);
              return c.success ? (
                <>
                  <p>
                    {c.data.comparable
                      ? '覆盖和设置满足逐样例比较条件'
                      : '仅展示差异，当前条件不足以给出统一优劣结论'}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>样例</th>
                        <th>A</th>
                        <th>B</th>
                        <th>B − A</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.data.pairs.map((p) => (
                        <tr key={p.key}>
                          <td>{p.key}</td>
                          <td>{p.left ?? '未知'}</td>
                          <td>{p.right ?? '未知'}</td>
                          <td>{p.delta ?? '不可比'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null;
            })()}
          <p>
            {details.origin === 'imported' ? '导入来源声明，不能作为本地执行或批准证明' : '本机固定修订'} ·{' '}
            {details.revision.slice(0, 12)}
          </p>
          <pre>{JSON.stringify(details.content, null, 2)}</pre>
        </article>
      )}
      <details>
        <summary>历史与引用恢复</summary>
        <p>归档保留固定历史。清理前会预览受保护引用和实际删除范围。</p>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const page = await invoke<S.SuitePage>(tab, 'list', {
                ...s,
                history: true,
                archived: true,
                cursor: 0,
                limit: 20,
              });
              setHistory(page.items);
              setHistoryNext(page.next);
            }, '已读取本领域历史')
          }
        >
          读取历史（含已归档）
        </button>
        {historyNext !== null && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const page = await invoke<S.SuitePage>(tab, 'list', {
                  ...s,
                  history: true,
                  archived: true,
                  cursor: historyNext,
                  limit: 20,
                });
                setHistory([...history, ...page.items]);
                setHistoryNext(page.next);
              }, '已读取下一页历史')
            }
          >
            更多历史
          </button>
        )}
        <label>
          历史修订
          <select aria-label="历史修订" value={historyKey} onChange={(e) => setHistoryKey(e.target.value)}>
            <option value="">选择历史修订</option>
            {history.map((row) => (
              <option key={key(row)} value={key(row)}>
                {row.name} · {row.revision.slice(0, 8)} · {row.state}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || !historyKey}
          onClick={() =>
            void run(() => {
              const row = history.find((row) => key(row) === historyKey);
              if (!row) throw new Error('请选择历史修订');
              return invoke(tab, 'archive', { ...s, id: row.id, revision: row.revision });
            })
          }
        >
          归档历史修订
        </button>
        <button
          disabled={busy || !historyKey}
          onClick={() =>
            void run(() => {
              const row = history.find((row) => key(row) === historyKey);
              if (!row) throw new Error('请选择历史修订');
              return preview(tab, 'previewCleanup', { ...s, references: [ref(row)] }, 'cleanup');
            }, '请核对原资源清理计划')
          }
        >
          预览清理历史修订
        </button>
        <SuitePublicationRecoveryPanel
          domain={tab}
          workspaceId={workspaceId}
          invoke={invoke}
          run={run}
          preview={preview}
        />
      </details>
      {plan && (
        <SuitePlanDialog
          value={plan.value}
          busy={busy}
          onCancel={() => setPlan(undefined)}
          onApprove={() =>
            void run(async () => {
              const value = await invoke(plan.domain, plan.apply, {
                ...s,
                planId: plan.value.id,
                digest: plan.value.digest,
              });
              setPlan(undefined);
              if (plan.domain === 'exchange') await loadExchange();
              return value;
            }, '已提交原计划，请查询结果状态')
          }
        />
      )}
    </>
  );
}
