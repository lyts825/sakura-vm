/** 显式的阶段预览和批准；页面不会自动推进原服务动作。 */
import { useEffect, useMemo, useState, useRef } from 'react';
import type { Request } from './feature-shared';
import type * as S from '../shared/contracts/suite-common';
import * as F from '../shared/contracts/flow-studio';
import { flowHttpSchemas } from '../shared/contracts/flow-http';
import { useSuiteClient, suiteReference as ref, suiteReferenceKey as key } from './suite-client';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import './suite-workbench.css';
const labels = {
  definitions: '流程定义',
  inputs: '固定输入',
  connectors: '原服务连接',
  plans: '计划',
  approvals: '批准',
  journal: '事件链',
  runs: '运行',
  timers: '等待',
  exchange: '隔离交接',
};
type Domain = keyof typeof labels;
const initialGraph = {
  nodes: [
    { id: 'material', label: '核对材料', type: 'material', binding: 'message' },
    { id: 'review', label: '人工确认', type: 'approval', prompt: '核对固定材料并确认用途。' },
  ],
  edges: [{ from: 'material', to: 'review', on: 'success' }],
};
export function FlowStudioPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: string;
  authorized?: boolean;
}) {
  const epoch = useMemo(() => crypto.randomUUID(), [request, accessEpoch]);
  return authorized ? <FlowSpaces key={epoch} request={request} /> : <p>请解锁会话后查看流程材料。</p>;
}
function FlowSpaces({ request }: { request: Request }) {
  const invoke = useSuiteClient(request, 'flow', flowHttpSchemas),
    [spaces, setSpaces] = useState<S.SuiteWorkspace[]>([]),
    [space, setSpace] = useState(''),
    [name, setName] = useState('本机流程'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const reload = async () => setSpaces(await invoke('definitions', 'listWorkspaces'));
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  return (
    <main className="suite-workbench">
      <header>
        <div>
          <small>FLOW STUDIO</small>
          <h1>本机流程工作台</h1>
          <p>固定输入，逐阶段批准，通过原服务核对执行结果。</p>
        </div>
        <span className="suite-chip">10 个领域 · 单账户批准</span>
      </header>
      <section className="suite-space">
        <label>
          流程空间
          <select aria-label="流程空间" value={space} onChange={(e) => setSpace(e.target.value)}>
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
            void invoke<S.SuiteWorkspace>('definitions', 'createWorkspace', { name })
              .then(async (s) => {
                await reload();
                setSpace(s.id);
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          创建空间
        </button>
      </section>
      {error && <p role="alert">{error}</p>}
      {space && <FlowWorkspace key={space} workspaceId={space} request={request} onAccepted={reload} />}
    </main>
  );
}
function FlowWorkspace({
  workspaceId,
  request,
  onAccepted,
}: {
  workspaceId: string;
  request: Request;
  onAccepted: () => Promise<void>;
}) {
  const invoke = useSuiteClient(request, 'flow', flowHttpSchemas),
    s = { workspaceId };
  const [tab, setTab] = useState<Domain>('definitions'),
    [rows, setRows] = useState<Record<string, S.SuiteRecord[]>>({}),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [name, setName] = useState('固定流程'),
    [graph, setGraph] = useState(JSON.stringify(initialGraph, null, 2)),
    [text, setText] = useState('{"message":"待核对的本机材料","publish":false}'),
    [reviewed, setReviewed] = useState(false),
    [allowExport, setAllowExport] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [details, setDetails] = useState<unknown>(),
    [runRow, setRunRow] = useState<S.SuiteRecord>(),
    [nodeId, setNodeId] = useState(''),
    [reason, setReason] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [stage, setStage] = useState<S.SuiteRecord>(),
    [plan, setPlan] = useState<{ value: S.SuitePlan; domain: string; apply: string }>(),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [history, setHistory] = useState<S.SuiteRecord[]>([]),
    [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const current = runRow ? F.flowRun.parse(runRow.content) : undefined;
  const stageDialog = useRef<HTMLDialogElement>(null),
    [stageExpired, setStageExpired] = useState(false);
  const [templates, setTemplates] = useState<
    { id: string; name: string; graph: unknown; description: string }[]
  >([]);
  useEffect(() => {
    if (!stage) return;
    const element = stageDialog.current!,
      previous = document.activeElement,
      remaining = Date.parse(F.flowStepPlan.parse(stage.content).expiresAt) - Date.now();
    element.showModal();
    setStageExpired(remaining <= 0);
    const timer = setTimeout(() => setStageExpired(true), Math.max(0, remaining));
    return () => {
      clearTimeout(timer);
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [stage?.id, stage?.revision]);
  const reload = async () => {
    const result: Record<string, S.SuiteRecord[]> = {};
    for (const d of Object.keys(labels))
      result[d] = (await invoke<S.SuitePage>(d, 'list', { ...s, limit: 20 })).items;
    setRows((previous) =>
      Object.fromEntries(
        Object.entries(result).map(([domain, items]) => [
          domain,
          [...items, ...(previous[domain] ?? []).filter((old) => !items.some((item) => item.id === old.id))],
        ]),
      ),
    );
  };
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  const run = async (work: () => Promise<unknown>, message = '操作已完成') => {
    setBusy(true);
    setError('');
    try {
      const result = await work();
      if (result !== undefined) setDetails(result);
      await reload();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const chosen = (d: string) => {
    const row = rows[d]?.find((r) => key(r) === selected[d]);
    if (!row) throw new Error('请先选择' + (labels[d as Domain] ?? d));
    return row;
  };
  const select = (d: Domain, title = labels[d]) => (
    <label>
      {title}
      <select
        aria-label={title}
        value={selected[d] ?? ''}
        onChange={(e) => setSelected((v) => ({ ...v, [d]: e.target.value }))}
      >
        <option value="">选择固定修订</option>
        {(rows[d] ?? []).map((r) => (
          <option key={key(r)} value={key(r)}>
            {r.name} · {r.revision.slice(0, 8)}
            {r.origin === 'imported' ? ' · 来源声明' : ''}
          </option>
        ))}
      </select>
    </label>
  );
  const preview = async (d: string, action: string, input: unknown, apply: string) =>
    setPlan({ domain: d, apply, value: await invoke(d, action, input) });
  const loadRun = async () => {
    const row = await invoke<S.SuiteRecord>('runs', 'inspect', { ...s, id: chosen('runs').id });
    setRunRow(row);
    setDetails(row);
    return row;
  };
  const refreshRun = async () => {
    if (!runRow) throw new Error('请先载入运行');
    const row = await invoke<S.SuiteRecord>('runs', 'inspect', { ...s, id: runRow.id });
    setRunRow(row);
    return row;
  };
  const historyLoad = async (cursor = 0) => {
    const page = await invoke<S.SuitePage>(tab, 'list', {
      ...s,
      cursor,
      limit: 20,
      history: true,
      archived: true,
    });
    setHistory((v) => (cursor ? [...v, ...page.items] : page.items));
    setHistoryCursor(page.next);
  };
  return (
    <>
      <nav className="suite-tabs" aria-label="流程领域">
        {Object.entries(labels).map(([d, label]) => (
          <button
            key={d}
            aria-pressed={tab === d}
            onClick={() => {
              setTab(d as Domain);
              setDetails(undefined);
              setHistory([]);
              setHistoryCursor(null);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {tab === 'definitions' && (
        <section className="suite-columns">
          <article>
            <h2>固定流程图</h2>
            <p>最多 24 个节点、50 条边。支持材料、人工批准、固定时间等待、标量条件及两个原服务动作。</p>
            <label>
              名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              DAG JSON
              <textarea
                aria-label="DAG JSON"
                rows={18}
                value={graph}
                onChange={(e) => setGraph(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(() => invoke('definitions', 'compile', { ...s, name, graph: JSON.parse(graph) }))
              }
            >
              校验并固定流程
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const items = await invoke<
                    { id: string; name: string; graph: unknown; description: string }[]
                  >('workbench', 'templates');
                  setDetails(items);
                  setTemplates(items);
                })
              }
            >
              载入建议模板
            </button>
            {templates.map((template) => (
              <button
                key={template.id}
                disabled={busy}
                title={template.description}
                onClick={() => {
                  setName(template.name);
                  setGraph(JSON.stringify(template.graph, null, 2));
                }}
              >
                {template.name}
              </button>
            ))}
          </article>
          <article>
            <h2>图与输入就绪</h2>
            {select('definitions')}
            {select('inputs', '已审阅固定输入')}
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  invoke('plans', 'previewFlow', {
                    ...s,
                    definition: ref(chosen('definitions')),
                    inputs: ref(chosen('inputs')),
                  }),
                )
              }
            >
              预览拓扑与依赖
            </button>
            <p>预览只反映当前就绪情况。每个阶段仍须重新预览具体参数并批准。</p>
          </article>
        </section>
      )}
      {tab === 'inputs' && (
        <section className="suite-columns">
          <article>
            <h2>上传与人工核对</h2>
            <label>
              材料名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              标量 JSON 对象
              <textarea
                rows={12}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            <label className="suite-check">
              <input
                type="checkbox"
                checked={allowExport}
                onChange={(e) => setAllowExport(e.target.checked)}
              />
              允许导出来源字节
            </label>
            <button
              disabled={busy}
              onClick={() => void run(() => invoke('inputs', 'upload', { ...s, name, text, allowExport }))}
            >
              上传来源材料
            </button>
          </article>
          <article>
            <h2>固定输入</h2>
            {select('inputs', '来源或固定输入')}
            <label className="suite-check">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              我已核对来源、内容与用途
            </label>
            <button
              disabled={busy || !reviewed}
              onClick={() =>
                void run(() =>
                  invoke('inputs', 'bind', { ...s, source: ref(chosen('inputs')), reviewed: true }),
                )
              }
            >
              固定所选来源
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = chosen('inputs');
                  return invoke('inputs', 'policy', { ...s, id: r.id, revision: r.revision });
                })
              }
            >
              查看来源许可
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = chosen('inputs'),
                    p = await invoke<{ revision: number }>('inputs', 'policy', {
                      ...s,
                      id: r.id,
                      revision: r.revision,
                    });
                  await preview(
                    'inputs',
                    'planPolicy',
                    {
                      ...s,
                      id: r.id,
                      revision: r.revision,
                      expectedPolicyRevision: p.revision,
                      allowRead: true,
                      allowExport,
                    },
                    'applyPolicy',
                  );
                })
              }
            >
              预览导出许可变更
            </button>
          </article>
        </section>
      )}
      {tab === 'connectors' && (
        <article>
          <h2>固定原服务适配器</h2>
          <p>
            integration-run 运行原接口验证计划，清理确认后才放行后继阶段。knowledge-publish
            发布已审阅的本机知识版本。目标参数须完整写入固定图的 provider 节点。
          </p>
          <button disabled={busy} onClick={() => void run(() => invoke('connectors', 'catalogue'))}>
            检查原服务可用性
          </button>
          <p>没有任意工具、Shell 或动态表达式入口。原知识发布无法通过取消流程自动撤回。</p>
        </article>
      )}
      {tab === 'plans' && (
        <article>
          <h2>就绪计划与运行</h2>
          {select('plans')}
          <button
            disabled={busy}
            onClick={() => void run(() => invoke('plans', 'inspect', { ...s, plan: ref(chosen('plans')) }))}
          >
            核对当前计划
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const row = await invoke<S.SuiteRecord>('runs', 'start', {
                  ...s,
                  plan: ref(chosen('plans')),
                });
                setRunRow(row);
                setTab('runs');
                return row;
              })
            }
          >
            由图计划创建运行
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(() => invoke('plans', 'invalidate', { ...s, plan: ref(chosen('plans')) }))
            }
          >
            使计划失效
          </button>
        </article>
      )}
      {tab === 'approvals' && (
        <article>
          <h2>单账户批准记录</h2>
          {select('approvals')}
          <label>
            撤销理由
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void run(() => invoke('approvals', 'inspect', { ...s, approval: ref(chosen('approvals')) }))
            }
          >
            检查批准有效性
          </button>
          <button
            disabled={busy || !reason.trim()}
            onClick={() =>
              void run(() =>
                invoke('approvals', 'revoke', { ...s, approval: ref(chosen('approvals')), reason }),
              )
            }
          >
            撤销未消费批准
          </button>
          <p>批准绑定阶段、固定修订、当前账户及插件代次。已消费批准不能撤回原动作。</p>
        </article>
      )}
      {(tab === 'runs' || tab === 'journal' || tab === 'timers') && (
        <section className="suite-columns">
          <article>
            <h2>当前流程</h2>
            {select('runs')}
            <button disabled={busy} onClick={() => void run(loadRun)}>
              载入运行
            </button>
            {current && (
              <>
                <p>
                  状态：{current.status} · 修订 {runRow!.revision.slice(0, 8)}
                </p>
                <label>
                  阶段
                  <select aria-label="流程阶段" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                    <option value="">选择阶段</option>
                    {current.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.id} · {n.status}
                      </option>
                    ))}
                  </select>
                </label>
                <ul>
                  {current.nodes.map((n) => (
                    <li key={n.id}>
                      {n.id}：{n.status}
                      {n.error ? ' · ' + n.error : ''}
                    </li>
                  ))}
                </ul>
                <button disabled={busy} onClick={() => void run(refreshRun)}>
                  刷新原运行
                </button>
                <button
                  disabled={busy || current.cancelled}
                  onClick={() =>
                    void run(async () => {
                      const row = await invoke<S.SuiteRecord>('runs', 'cancel', { ...s, id: runRow!.id });
                      setRunRow(row);
                      return row;
                    })
                  }
                >
                  停止后续阶段并请求原清理
                </button>
              </>
            )}
          </article>
          <article>
            <h2>{tab === 'journal' ? '原事件链' : tab === 'timers' ? '固定等待' : '逐阶段推进'}</h2>
            {tab === 'runs' && (
              <>
                <button
                  disabled={busy || !runRow || !nodeId}
                  onClick={() =>
                    void run(async () => {
                      const value = await invoke<S.SuiteRecord>('runs', 'previewStep', {
                        ...s,
                        id: runRow!.id,
                        nodeId,
                      });
                      await refreshRun();
                      setReason('');
                      setConfirmed(false);
                      setStage(value);
                    })
                  }
                >
                  预览当前阶段
                </button>
                <button
                  disabled={busy || !runRow || !nodeId}
                  onClick={() =>
                    void run(async () => {
                      const row = await invoke<S.SuiteRecord>('runs', 'reconcile', {
                        ...s,
                        id: runRow!.id,
                        nodeId,
                      });
                      setRunRow(row);
                      return row;
                    })
                  }
                >
                  核对未知或进行中的原回执
                </button>
                <p>每次预览展示固定参数和原目标。未知结果不重发；取消不等于业务回滚。</p>
              </>
            )}
            {tab === 'journal' && (
              <>
                <button
                  disabled={busy || !runRow}
                  onClick={() =>
                    void run(() => invoke('journal', 'readTimeline', { ...s, runId: runRow!.id, limit: 100 }))
                  }
                >
                  读取事件
                </button>
                <button
                  disabled={busy || !runRow}
                  onClick={() => void run(() => invoke('journal', 'verify', { ...s, runId: runRow!.id }))}
                >
                  核对完整事件链
                </button>
              </>
            )}
            {tab === 'timers' && (
              <>
                <button
                  disabled={busy || !runRow || !nodeId}
                  onClick={() =>
                    void run(() =>
                      invoke('timers', 'scheduleWait', {
                        ...s,
                        id: runRow!.id,
                        nodeId,
                        until: current?.nodes.find((n) => n.id === nodeId)?.until,
                      }),
                    )
                  }
                >
                  登记当前等待
                </button>
                <button disabled={busy} onClick={() => void run(() => invoke('timers', 'due', s))}>
                  查询到期情况
                </button>
                {select('timers')}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await invoke('timers', 'release', {
                        ...s,
                        timer: ref(chosen('timers')),
                      });
                      if (runRow) await refreshRun();
                      return result;
                    })
                  }
                >
                  释放到期等待
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() => invoke('timers', 'cancelWait', { ...s, timer: ref(chosen('timers')) }))
                  }
                >
                  取消等待登记
                </button>
                <p>服务重启后保留等待；到期查询不会执行后续原服务动作。</p>
              </>
            )}
          </article>
        </section>
      )}
      {tab === 'exchange' && (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setTransfers(await invoke('exchange', 'transfers', s));
              })
            }
          >
            刷新传输
          </button>
          <SuiteExchangePanel
            invoke={invoke}
            workspaceId={workspaceId}
            domains={{ runs: '流程快照', exchange: '交接' }}
            records={rows}
            transfers={transfers}
            busy={busy}
            run={run}
            preview={preview}
            onAccepted={onAccepted}
            downloadName="flow-history.zip"
            description="导出流程快照及固定输入、计划和事件链。原执行回执只作为来源声明，批准和执行能力不会转移。"
          />
        </>
      )}
      <section>
        <h2>固定修订与维护</h2>
        {select(tab, '维护修订 · ' + labels[tab])}
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const page = await invoke<S.SuitePage>(tab, 'list', {
                ...s,
                cursor: rows[tab]?.length ?? 0,
                limit: 20,
              });
              setRows((previous) => ({
                ...previous,
                [tab]: [
                  ...(previous[tab] ?? []),
                  ...page.items.filter(
                    (item) => !(previous[tab] ?? []).some((old) => key(old) === key(item)),
                  ),
                ],
              }));
            }, '已读取下一页修订')
          }
        >
          更多修订
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = chosen(tab);
              return invoke(tab, 'get', { ...s, id: r.id, revision: r.revision });
            })
          }
        >
          查看固定内容
        </button>
        <button disabled={busy} onClick={() => void run(() => historyLoad())}>
          读取历史
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = chosen(tab);
              return invoke(tab, 'archive', { ...s, id: r.id, revision: r.revision });
            })
          }
        >
          归档所选修订
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(() =>
              preview(tab, 'previewCleanup', { ...s, references: [ref(chosen(tab))] }, 'cleanup'),
            )
          }
        >
          预览清理
        </button>
        {history.map((r) => (
          <button
            key={key(r)}
            disabled={busy}
            onClick={() => void run(() => invoke(tab, 'get', { ...s, id: r.id, revision: r.revision }))}
          >
            {r.name} · {r.sequence} · {r.state}
          </button>
        ))}
        {historyCursor !== null && (
          <button disabled={busy} onClick={() => void run(() => historyLoad(historyCursor))}>
            更多历史
          </button>
        )}
        <SuitePublicationRecoveryPanel
          invoke={invoke}
          domain={tab}
          workspaceId={workspaceId}
          run={run}
          preview={preview}
        />
      </section>
      {details !== undefined && (
        <article>
          <h2>固定结果</h2>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 600, overflow: 'auto' }}>
            {JSON.stringify(details, null, 2)}
          </pre>
        </article>
      )}
      {stage && (
        <dialog
          ref={stageDialog}
          className="suite-dialog"
          aria-label="阶段批准"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) setStage(undefined);
          }}
        >
          <h2>批准具体阶段</h2>
          <p>核对下面的固定参数、原提供者目标和有效期。本次批准只消费一次。</p>
          <pre style={{ maxHeight: '40vh', overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(stage.content, null, 2)}
          </pre>
          <label>
            批准理由
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="suite-check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            我已核对固定输入和原动作影响
          </label>
          {stageExpired && <p role="status">阶段计划已到期，请重新预览。</p>}
          <button autoFocus disabled={busy} onClick={() => setStage(undefined)}>
            取消
          </button>
          <button
            disabled={busy || stageExpired || !confirmed || !reason.trim()}
            onClick={() =>
              void run(async () => {
                const step = F.flowStepPlan.parse(stage.content),
                  approval = await invoke<S.SuiteRecord>('approvals', 'approve', {
                    ...s,
                    plan: ref(stage),
                    reason,
                  }),
                  latest = await invoke<S.SuiteRecord>('runs', 'inspect', { ...s, id: step.runId }),
                  row = await invoke<S.SuiteRecord>('runs', 'advance', {
                    ...s,
                    id: step.runId,
                    nodeId: step.node.id,
                    approval: ref(approval),
                    expectedRevision: latest.revision,
                  });
                setRunRow(row);
                setStage(undefined);
                return row;
              }, '已提交本阶段；请核对原回执状态')
            }
          >
            批准并推进本阶段
          </button>
        </dialog>
      )}
      {plan && (
        <SuitePlanDialog
          value={plan.value}
          busy={busy}
          onCancel={() => setPlan(undefined)}
          onApprove={() =>
            void run(async () => {
              const result = await invoke(plan.domain, plan.apply, {
                ...s,
                planId: plan.value.id,
                digest: plan.value.digest,
              });
              setPlan(undefined);
              return result;
            })
          }
        />
      )}
    </>
  );
}
