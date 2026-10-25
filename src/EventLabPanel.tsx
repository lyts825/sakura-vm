/** 固定消息、执行批准、逐事件检查与交接；工作区切换撤销旧页面请求。 */
import { useEffect, useRef, useState } from 'react';
import type { Request } from './feature-shared';
import type * as S from '../shared/contracts/suite-common';
import type { ImageAsset } from '../shared/contracts/image-assets';
import * as E from '../shared/contracts/event-lab';
import { eventHttpSchemas } from '../shared/contracts/event-http';
import { useSuiteClient, suiteReference as ref, suiteReferenceKey as key } from './suite-client';
import { SuiteRecordSelect } from './SuiteRecordSelect';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import { SuiteHostCapacityStatus } from './SuiteHostCapacityStatus';
import type { SuiteHostCapacity } from '../shared/contracts/suite-capacity';
import './suite-workbench.css';
const titles: Record<string, string> = {
  contracts: '模式与材料',
  fixtures: '消息样例',
  producers: '生产计划',
  consumers: '消费策略',
  scenarios: '固定场景',
  brokers: '代理与会话',
  runs: '执行记录',
  assertions: '消息断言',
  reports: '封存报告',
  exchange: '交接记录',
};
export function EventLabPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: unknown;
  authorized?: boolean;
}) {
  if (!authorized) return <p>请解锁会话后查看事件实验材料。</p>;
  return <EventSession key={String(accessEpoch ?? 'local')} request={request} />;
}
function EventSession({ request }: { request: Request }) {
  const call = useSuiteClient(request, 'event', eventHttpSchemas),
    [workspaces, setWorkspaces] = useState<S.SuiteWorkspace[]>([]),
    [workspaceId, setWorkspace] = useState(''),
    [name, setName] = useState('队列实验'),
    [images, setImages] = useState<ImageAsset[]>([]),
    [imageId, setImage] = useState(''),
    [rows, setRows] = useState<Record<string, S.SuiteRecord[]>>({}),
    [selection, setSelection] = useState<Record<string, string>>({}),
    [tab, setTab] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [plan, setPlan] = useState<{ value: S.SuitePlan; domain: string; apply: string } | null>(null),
    [experiment, setExperiment] = useState<'duplicate-delivery' | 'ack-loss' | 'slow-consumer'>(
      'duplicate-delivery',
    ),
    [count, setCount] = useState(20),
    [idempotent, setIdempotent] = useState(true),
    [retry, setRetry] = useState(1),
    [delay, setDelay] = useState(100),
    [ordering, setOrdering] = useState<'fifo' | 'per-key'>('fifo'),
    [poison, setPoison] = useState(''),
    [contractText, setContract] = useState(
      '{"format":"sakura-event-contract/1","fields":{"value":"number","label":"string"},"required":["value","label"],"maximumBytes":8192}',
    ),
    [file, setFile] = useState<File>(),
    [summary, setSummary] = useState(''),
    [unresolved, setUnresolved] = useState(''),
    [history, setHistory] = useState('runs'),
    [tracePage, setTracePage] = useState(0),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [capacity, setCapacity] = useState<SuiteHostCapacity>();
  const epoch = useRef(0),
    mounted = useRef(true),
    scope = { workspaceId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  const invoke = async <T,>(domain: string, method: string, input: unknown = {}): Promise<T> => {
    const version = epoch.current,
      result = await call<T>(domain, method, input);
    if (!mounted.current || version !== epoch.current) throw new DOMException('工作区已切换', 'AbortError');
    return result;
  };
  const selected = (domain: string) => rows[domain]?.find((r) => key(r) === selection[domain]);
  const fixed = (domain: string, format?: string) => {
    const value = selected(domain);
    if (
      !value ||
      value.origin !== 'local' ||
      value.state !== 'sealed' ||
      (format && (value.content as Record<string, unknown>)?.format !== format)
    )
      throw new Error('请选择本地' + (titles[domain] ?? domain) + '固定修订');
    return ref(value);
  };
  const add = (value: S.SuiteRecord) => {
    const domain = value.domain.replace('event-', '');
    setRows((old) => ({
      ...old,
      [domain]: [value, ...(old[domain] ?? []).filter((r) => key(r) !== key(value))],
    }));
    setSelection((old) => ({ ...old, [domain]: key(value) }));
  };
  const refresh = async () => {
    const view = await invoke<ReturnType<typeof E.eventView.parse>>(
      'workbench',
      'view',
      workspaceId ? { ...scope, limit: 50, cursor: 0 } : {},
    );
    setWorkspaces(view.workspaces);
    if (workspaceId) {
      setRows(Object.fromEntries(view.domains.map((d) => [d.id.replace('event-', ''), d.records])));
      setTransfers(await invoke('exchange', 'transfers', scope));
      setCapacity(await invoke('contracts', 'hostCapacity', scope));
    }
  };
  const run = async (work: () => Promise<unknown>, message = '已保存固定记录') => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (mounted.current) setNotice(message);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    void (async () => {
      await refresh();
      setImages(await invoke('contracts', 'images'));
    })().catch((error) => {
      if (mounted.current && error?.name !== 'AbortError') setError(String(error.message ?? error));
    });
  }, [workspaceId]);
  const preview = async (domain: string, action: string, input: unknown, apply: string) => {
    const value = await invoke<S.SuitePlan>(domain, action, input);
    setPlan({ value, domain, apply });
  };
  const choose = (domain: string, format?: string) => (
    <SuiteRecordSelect
      title={titles[domain]}
      rows={(rows[domain] ?? []).filter(
        (r) => !format || (r.content as Record<string, unknown>)?.format === format,
      )}
      value={selection[domain] ?? ''}
      onChange={(v) => setSelection((old) => ({ ...old, [domain]: v }))}
    />
  );
  const button = (label: string, work: () => Promise<unknown>, disabled = false) => (
    <button disabled={busy || disabled} onClick={() => void run(work)}>
      {label}
    </button>
  );
  const image = () => {
    const selected = images.find((i) => i.id === imageId);
    if (!selected) throw new Error('请选择已经准备依赖的镜像');
    return { assetId: selected.id, digest: selected.digest };
  };
  const currentRun = E.eventRun.safeParse(selected('runs')?.content),
    sessionRow = currentRun.success
      ? (rows.brokers ?? []).find(
          (r) =>
            r.id === currentRun.data.brokerSession.id &&
            r.revision === currentRun.data.brokerSession.revision,
        )
      : undefined,
    session = E.eventSession.safeParse(sessionRow?.content),
    trace = session.success ? (session.data.result?.trace ?? []) : [];
  return (
    <section className="suite-workbench">
      <header>
        <h1>事件与队列实验</h1>
        <p>专用隔离副本中的测试代理。观察重复、重投、积压和应用结果，不作为生产集群性能结论。</p>
      </header>
      <div className="suite-toolbar">
        <label>
          工作区
          <select
            aria-label="工作区"
            value={workspaceId}
            disabled={busy}
            onChange={(e) => {
              epoch.current++;
              setWorkspace(e.target.value);
              setRows({});
              setSelection({});
              setPlan(null);
              setError('');
              setTracePage(0);
            }}
          >
            <option value="">新建或选择工作区</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.revoked ? ' · 已撤销' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </label>
        {button('新建工作区', async () => {
          const w = await invoke<S.SuiteWorkspace>('contracts', 'createWorkspace', { name });
          epoch.current++;
          setWorkspace(w.id);
          setRows({});
          setSelection({});
        })}
        {button('刷新原记录', refresh)}
      </div>
      <label>
        已准备镜像
        <select value={imageId} onChange={(e) => setImage(e.target.value)}>
          <option value="">选择含 Python 3 和 SQLite 的镜像</option>
          {images.map((i) => (
            <option key={i.id} value={i.id}>
              {i.distro} · {i.digest.slice(0, 12)} · {Math.ceil(i.virtualBytes / 1024 ** 3)} GiB
            </option>
          ))}
        </select>
      </label>
      <p>
        每次最多 1000 条消息、12,000 条完整轨迹、1 个消费者，最长 900 秒。虚拟盘至少预留 8
        GiB，镜像与材料还需额外额度；默认宿主总额 8 GiB 会拒绝执行，须显式配置足够容量。依赖不会在运行中下载。
      </p>
      {capacity && <SuiteHostCapacityStatus value={capacity} />}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <nav aria-label="事件工作台">
        {['输入与策略', '执行与轨迹', '断言与报告', '交接', '历史与清理'].map((title, i) => (
          <button
            key={title}
            className={tab === i ? 'active' : undefined}
            aria-pressed={tab === i}
            onClick={() => setTab(i)}
          >
            {title}
          </button>
        ))}
      </nav>
      {tab === 0 && (
        <div className="suite-grid">
          <article>
            <h2>三个可运行样例</h2>
            <label>
              实验
              <select value={experiment} onChange={(e) => setExperiment(e.target.value as typeof experiment)}>
                <option value="duplicate-delivery">重复消息去重</option>
                <option value="ack-loss">确认丢失后重投</option>
                <option value="slow-consumer">慢消费者积压</option>
              </select>
            </label>
            {button(
              '创建样例工作区',
              async () => {
                const result = await invoke<ReturnType<typeof E.eventExampleResult.parse>>(
                  'workbench',
                  'createExample',
                  { name, template: experiment, image: image() },
                );
                epoch.current++;
                setWorkspace(result.workspace.id);
                for (const value of [
                  result.contract,
                  result.fixture,
                  result.producer,
                  result.consumer,
                  result.scenario,
                  result.broker,
                ])
                  add(value);
              },
              !imageId,
            )}
            <p>这里只生成固定输入，实际运行仍需预览与批准。</p>
            <h2>消息模式与正文</h2>
            <label>
              消息模式
              <textarea rows={8} value={contractText} onChange={(e) => setContract(e.target.value)} />
            </label>
            {button(
              '固定消息模式',
              async () =>
                add(
                  await invoke('contracts', 'validate', {
                    ...scope,
                    name: name + ' · 模式',
                    definition: JSON.parse(contractText),
                  }),
                ),
              !workspaceId,
            )}
            {choose('contracts', 'sakura-event-contract/1')}
            <label>
              合成条数
              <input
                type="number"
                min={1}
                max={1000}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            {button(
              '生成固定消息',
              async () =>
                add(
                  await invoke('fixtures', 'generate', {
                    ...scope,
                    contract: fixed('contracts', 'sakura-event-contract/1'),
                    name,
                    count,
                    seed: 'event-' + count,
                  }),
                ),
              !workspaceId,
            )}
            <label>
              JSON 消息数组
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            {button(
              '导入并校验消息',
              async () => {
                if (!file || file.size > 2 * 1024 ** 2) throw new Error('请选择不超过2 MiB的JSON文件');
                const source = await invoke<S.SuiteRecord>('contracts', 'upload', {
                  ...scope,
                  name: file.name,
                  text: await file.text(),
                  allowExport: false,
                });
                add(source);
                add(
                  await invoke('fixtures', 'importRows', {
                    ...scope,
                    contract: fixed('contracts', 'sakura-event-contract/1'),
                    source: ref(source),
                    reviewed: true,
                  }),
                );
              },
              !workspaceId || !file,
            )}
          </article>
          <article>
            <h2>有限生产与消费策略</h2>
            {choose('fixtures')}
            <label>
              顺序范围
              <select value={ordering} onChange={(e) => setOrdering(e.target.value as typeof ordering)}>
                <option value="fifo">整个固定批次</option>
                <option value="per-key">每个消息键</option>
              </select>
            </label>
            {button(
              '编译生产计划',
              async () =>
                add(
                  await invoke('producers', 'compile', {
                    ...scope,
                    name: name + ' · 生产',
                    fixture: fixed('fixtures'),
                    ordering,
                    reverse: false,
                  }),
                ),
              !workspaceId,
            )}
            <label>
              <input type="checkbox" checked={idempotent} onChange={(e) => setIdempotent(e.target.checked)} />
              按消息 ID 防止重复应用
            </label>
            <label>
              重试上限
              <input
                type="number"
                min={0}
                max={3}
                value={retry}
                onChange={(e) => setRetry(Number(e.target.value))}
              />
            </label>
            <label>
              消费等待毫秒
              <input
                type="number"
                min={0}
                max={500}
                value={delay}
                onChange={(e) => setDelay(Number(e.target.value))}
              />
            </label>
            <label>
              始终拒绝的消息 ID（每行一个）
              <textarea value={poison} onChange={(e) => setPoison(e.target.value)} />
            </label>
            {button(
              '编译消费策略',
              async () =>
                add(
                  await invoke('consumers', 'compile', {
                    ...scope,
                    name: name + ' · 消费',
                    contract: fixed('contracts', 'sakura-event-contract/1'),
                    idempotent,
                    delayMs: delay,
                    retryLimit: retry,
                    poisonIds: poison
                      .split(/\r?\n/)
                      .map((v) => v.trim())
                      .filter(Boolean),
                  }),
                ),
              !workspaceId,
            )}
            {choose('producers')}
            {choose('consumers')}
            {button(
              '固定实验场景',
              async () =>
                add(
                  await invoke('scenarios', 'compile', {
                    ...scope,
                    name,
                    fixture: fixed('fixtures'),
                    producer: fixed('producers'),
                    consumer: fixed('consumers'),
                    experiment,
                    maximumSeconds: 900,
                  }),
                ),
              !workspaceId,
            )}
            {button(
              '保存代理准备配置',
              async () =>
                add(
                  await invoke('brokers', 'prepare', {
                    ...scope,
                    name: name + ' · 隔离代理',
                    image: image(),
                  }),
                ),
              !workspaceId || !imageId,
            )}
          </article>
        </div>
      )}
      {tab === 1 && workspaceId && (
        <>
          <div className="suite-grid">
            <article>
              <h2>核对并执行</h2>
              {choose('brokers', 'sakura-event-broker/1')}
              {choose('scenarios')}
              {button('预览原执行计划', () =>
                preview(
                  'runs',
                  'preview',
                  {
                    ...scope,
                    broker: fixed('brokers', 'sakura-event-broker/1'),
                    scenario: fixed('scenarios'),
                  },
                  'start',
                ),
              )}
              <p>每个批准仅提交一次。宿主重启、取消或撤权后只核销原资源，不重新投递。</p>
              {choose('runs')}
              {button('读取原运行', async () => {
                add(await invoke('runs', 'inspect', { ...scope, run: fixed('runs') }));
                await refresh();
              })}
              {button('取消原运行', async () =>
                add(await invoke('runs', 'cancel', { ...scope, run: fixed('runs') })),
              )}
              {button('核销原资源', async () =>
                add(await invoke('runs', 'reconcile', { ...scope, run: fixed('runs') })),
              )}
              {currentRun.success && (
                <p>
                  状态：{currentRun.data.state} · 结论：{currentRun.data.outcome} · 资源：
                  {currentRun.data.cleanup}
                </p>
              )}
            </article>
            <article>
              <h2>逐消息轨迹</h2>
              <p>{trace.length} 条原代理观测，时间来自同一代理单调时钟。</p>
              <table>
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>消息</th>
                    <th>投递</th>
                    <th>事件</th>
                    <th>尝试</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.slice(tracePage * 100, (tracePage + 1) * 100).map((row) => (
                    <tr key={row.sequence}>
                      <td>{row.sequence}</td>
                      <td>{row.messageId}</td>
                      <td>{row.deliveryId ?? '—'}</td>
                      <td>{row.kind}</td>
                      <td>{row.attempt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button disabled={!tracePage} onClick={() => setTracePage((n) => n - 1)}>
                上一页
              </button>
              <button
                disabled={(tracePage + 1) * 100 >= trace.length}
                onClick={() => setTracePage((n) => n + 1)}
              >
                下一页
              </button>
            </article>
          </div>
        </>
      )}
      {tab === 2 && workspaceId && (
        <div className="suite-grid">
          <article>
            <h2>检查与解释</h2>
            {choose('runs')}
            {button('重算消息断言', async () =>
              add(await invoke('assertions', 'evaluate', { ...scope, run: fixed('runs') })),
            )}
            {choose('assertions')}
            {selected('assertions') && <pre>{JSON.stringify(selected('assertions')!.content, null, 2)}</pre>}
          </article>
          <article>
            <h2>封存报告</h2>
            <label>
              检查结论
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} />
            </label>
            <label>
              尚未解决的问题
              <textarea value={unresolved} onChange={(e) => setUnresolved(e.target.value)} />
            </label>
            {button(
              '封存原结果报告',
              async () =>
                add(
                  await invoke('reports', 'sealReport', {
                    ...scope,
                    run: fixed('runs'),
                    assertion: fixed('assertions'),
                    summary,
                    unresolved: unresolved.split(/\r?\n/).filter(Boolean),
                  }),
                ),
              !summary.trim(),
            )}
            <p>缺少原观测或未确认核销的运行不会被标记为通过。</p>
          </article>
        </div>
      )}
      {tab === 3 && workspaceId && (
        <>
          <article>
            <h2>正文导出许可</h2>
            <SuiteRecordSelect
              title="原始消息材料"
              rows={(rows.contracts ?? []).filter((r) => r.kind === 'source')}
              value={selection.source ?? ''}
              onChange={(v) => setSelection((old) => ({ ...old, source: v }))}
            />
            {button('预览允许此材料导出', async () => {
              const value = (rows.contracts ?? []).find((r) => key(r) === selection.source);
              if (!value) throw new Error('请选择原材料');
              const policy = await invoke<{ revision: number }>('contracts', 'policy', {
                ...scope,
                id: value.id,
                revision: value.revision,
              });
              await preview(
                'contracts',
                'planPolicy',
                {
                  ...scope,
                  id: value.id,
                  revision: value.revision,
                  expectedPolicyRevision: policy.revision,
                  allowRead: true,
                  allowExport: true,
                },
                'applyPolicy',
              );
            })}
          </article>
          <SuiteExchangePanel
            invoke={invoke}
            workspaceId={workspaceId}
            domains={{ reports: '封存报告' }}
            records={rows}
            transfers={transfers}
            busy={busy}
            run={run}
            preview={preview}
            onAccepted={refresh}
            downloadName="event-lab.sakura"
            description="交接报告及完整材料图；运行许可、原VM令牌和宿主进程身份不会传递。外来轨迹只作为可重算的来源声明。"
          />
        </>
      )}
      {tab === 4 && workspaceId && (
        <article>
          <h2>固定修订与清理</h2>
          <label>
            领域
            <select aria-label="领域" value={history} onChange={(e) => setHistory(e.target.value)}>
              {Object.entries(titles).map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          {button('读取历史修订', async () => {
            const page = await invoke<S.SuitePage>(history, 'list', {
              ...scope,
              cursor: 0,
              limit: 50,
              history: true,
              archived: true,
            });
            setRows((old) => ({ ...old, [history]: page.items }));
          })}
          <label>
            历史修订
            <select
              aria-label="历史修订"
              value={selection[history] ?? ''}
              onChange={(e) => setSelection((old) => ({ ...old, [history]: e.target.value }))}
            >
              <option value="">选择原修订</option>
              {(rows[history] ?? []).map((row) => (
                <option key={key(row)} value={key(row)}>
                  {row.name} · {row.revision.slice(0, 8)} · {row.state}
                </option>
              ))}
            </select>
          </label>
          {button('归档所选修订', async () => {
            const row = selected(history);
            if (!row) throw new Error('请选择历史修订');
            const target = ref(row);
            add(await invoke(history, 'archive', { ...scope, id: target.id, revision: target.revision }));
          })}
          {button('预览物理清理', async () => {
            const row = selected(history);
            if (!row) throw new Error('请选择历史修订');
            await preview(history, 'previewCleanup', { ...scope, references: [ref(row)] }, 'cleanup');
          })}
          <SuitePublicationRecoveryPanel
            domain={history}
            workspaceId={workspaceId}
            invoke={invoke}
            run={run}
            preview={preview}
          />
        </article>
      )}
      {plan && (
        <SuitePlanDialog
          value={plan.value}
          busy={busy}
          onCancel={() =>
            void run(async () => {
              if (plan.domain === 'runs' && plan.apply === 'start')
                await invoke('runs', 'discardPreview', {
                  ...scope,
                  planId: plan.value.id,
                  digest: plan.value.digest,
                });
              setPlan(null);
            }, '已取消预览')
          }
          onApprove={() =>
            void run(async () => {
              const result = await invoke<S.SuiteRecord>(plan.domain, plan.apply, {
                ...scope,
                planId: plan.value.id,
                digest: plan.value.digest,
              });
              add(result);
              setPlan(null);
              await refresh();
            }, '原计划已提交')
          }
        />
      )}
    </section>
  );
}
