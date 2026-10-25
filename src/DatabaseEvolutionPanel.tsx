/** 固定修订的数据库演练；批准前展示计划，恢复始终创建新的独立副本。 */
import { useEffect, useRef, useState } from 'react';
import type { Request } from './feature-shared';
import * as S from '../shared/contracts/suite-common';
import * as D from '../shared/contracts/database-evolution';
import { databaseHttpSchemas } from '../shared/contracts/database-http';
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
  sources: '固定材料',
  schemas: '数据库结构',
  changes: '声明式变更',
  fixtures: '独立副本',
  runners: '执行记录',
  checks: '完整检查',
  rehearsals: '恢复演练',
  reports: '封存报告',
  exchange: '交接记录',
};
type Domain = keyof typeof titles;
const tabs = ['输入与变更', '副本与执行', '检查与恢复', '报告与交接', '历史与清理'];
const content = (row?: S.SuiteRecord) =>
  row?.content && typeof row.content === 'object' && !Array.isArray(row.content) ? row.content : null;
export function DatabaseEvolutionPanel(props: { request: Request; accessEpoch?: unknown }) {
  return <DatabaseSession key={String(props.accessEpoch ?? 'local')} request={props.request} />;
}
function DatabaseSession({ request }: { request: Request }) {
  const call = useSuiteClient(request, 'database', databaseHttpSchemas),
    [workspaces, setWorkspaces] = useState<S.SuiteWorkspace[]>([]),
    [workspaceId, setWorkspace] = useState(''),
    [name, setName] = useState('数据库演练'),
    [tab, setTab] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [rows, setRows] = useState<Record<string, S.SuiteRecord[]>>({}),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [plan, setPlan] = useState<{ value: S.SuitePlan; domain: string; apply: string } | null>(null),
    [templates, setTemplates] = useState<D.DatabaseOperation[][]>([]),
    [template, setTemplate] = useState('add-column-backfill'),
    [operations, setOperations] = useState('[]'),
    [file, setFile] = useState<File>(),
    [csvSchema, setCsvSchema] = useState(''),
    [csvTable, setCsvTable] = useState('accounts'),
    [assetId, setAssetId] = useState(''),
    [digest, setDigest] = useState(''),
    [destructive, setDestructive] = useState(false),
    [summary, setSummary] = useState(''),
    [unresolved, setUnresolved] = useState(''),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [history, setHistory] = useState<Domain>('sources'),
    [capacity, setCapacity] = useState<SuiteHostCapacity>(),
    [cursor, setCursor] = useState<Record<string, number | null>>({});
  const epoch = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  const scope = { workspaceId },
    image = { assetId, digest };
  const invoke = async <T,>(domain: string, method: string, input: unknown = {}): Promise<T> => {
    const current = epoch.current,
      result = await call<T>(domain, method, input);
    if (!mounted.current || current !== epoch.current) throw new DOMException('工作区已变化', 'AbortError');
    return result;
  };
  const chosen = (domain: string) => rows[domain]?.find((row) => key(row) === selected[domain]);
  const fixed = (domain: string) => {
    const row = chosen(domain);
    if (!row || row.origin !== 'local') throw new Error('请选择本地固定修订');
    return ref(row);
  };
  const add = (row: S.SuiteRecord) => {
    const domain = row.domain.replace('database-', '');
    setRows((old) => ({
      ...old,
      [domain]: [row, ...(old[domain] ?? []).filter((x) => x.id !== row.id)].slice(0, 20),
    }));
    setSelected((old) => ({ ...old, [domain]: key(row) }));
    return row;
  };
  const refresh = async () => {
    if (!workspaceId) return;
    const domains: Domain[] =
      tab === 0
        ? ['sources', 'schemas', 'changes']
        : tab === 1
          ? ['fixtures', 'runners', 'rehearsals']
          : tab === 2
            ? ['runners', 'checks', 'rehearsals']
            : tab === 3
              ? ['sources', 'runners', 'checks', 'reports', 'exchange']
              : [history];
    for (const domain of domains) {
      const page = await invoke<S.SuitePage>(domain, 'list', {
        ...scope,
        limit: 20,
        cursor: 0,
        history: false,
        archived: false,
      });
      setRows((old) => ({ ...old, [domain]: page.items }));
      setCursor((old) => ({ ...old, [domain]: page.next }));
    }
    setCapacity(await invoke('sources', 'hostCapacity', scope));
    if (tab === 3) setTransfers(await invoke('exchange', 'transfers', scope));
  };
  const run = async (work: () => Promise<unknown>, message = '操作完成') => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (mounted.current) setNotice(message);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setError(e instanceof Error ? e.message : '操作失败');
        const v = e as { status?: number; code?: string };
        if ([401, 403].includes(v.status ?? 0) || /REVOK|PERMISSION|DENIED/.test(v.code ?? '')) {
          epoch.current++;
          setRows({});
          setSelected({});
          setPlan(null);
          setOperations('[]');
          setCsvSchema('');
          setSummary('');
          setUnresolved('');
          setWorkspace('');
          setCapacity(undefined);
          setFile(undefined);
          setTransfers([]);
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const preview = async (domain: string, action: string, input: unknown, apply: string) => {
    const value = await invoke<S.SuitePlan>(domain, action, input);
    setPlan({ value, domain, apply });
  };
  const act = async (domain: string, method: string, input: unknown) =>
    add(await invoke<S.SuiteRecord>(domain, method, input));
  useEffect(() => {
    void run(async () => {
      setWorkspaces(await invoke('sources', 'listWorkspaces'));
      const list = await invoke<{ operations: D.DatabaseOperation[] }[]>('workbench', 'templates');
      setTemplates(list.map((x) => x.operations));
      setOperations(JSON.stringify(list[0].operations, null, 2));
    }, '已读取工作区与固定示例');
  }, []);
  useEffect(() => {
    if (workspaceId) void run(refresh, '已刷新固定修订');
  }, [workspaceId, tab, history]);
  const selector = (domain: Domain, format?: string) => (
    <SuiteRecordSelect
      title={titles[domain]}
      rows={(rows[domain] ?? []).filter((r) => !format || content(r)?.format === format)}
      value={selected[domain] ?? ''}
      onChange={(value) => {
        setSelected((old) => ({ ...old, [domain]: value }));
        setPlan(null);
      }}
    />
  );
  const button = (label: string, work: () => Promise<unknown>, disabled = false) => (
    <button disabled={busy || !workspaceId || disabled} onClick={() => void run(work)}>
      {label}
    </button>
  );
  const upload = async () => {
    if (!file) throw new Error('请选择 JSON 或 CSV 文件');
    if (file.size > 8 * 1024 ** 2) throw new Error('文件最多 8 MiB');
    const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json',
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
    return act('sources', 'finishUpload', { ...scope, id: handle.id });
  };
  const fixture = D.databaseFixture.safeParse(chosen('fixtures')?.content),
    check = D.databaseCheck.safeParse(chosen('checks')?.content);
  return (
    <section className="suite-workbench">
      <header>
        <h1>数据库演进演练</h1>
        <p>审阅固定数据，在独立 PostgreSQL 副本执行声明式变更，核对完整数据与独立恢复结果。</p>
      </header>
      <div className="suite-toolbar">
        <label>
          工作区
          <select
            aria-label="工作区"
            disabled={busy}
            value={workspaceId}
            onChange={(event) => {
              epoch.current++;
              setWorkspace(event.target.value);
              setRows({});
              setSelected({});
              setPlan(null);
              setFile(undefined);
              setSummary('');
              setUnresolved('');
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
          新工作区
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button
          disabled={busy || !name.trim()}
          onClick={() =>
            void run(async () => {
              const w = await invoke<S.SuiteWorkspace>('sources', 'createWorkspace', { name });
              setWorkspaces((old) => [...old, w]);
              setWorkspace(w.id);
            })
          }
        >
          创建工作区
        </button>
        <button disabled={busy || !workspaceId} onClick={() => void run(refresh)}>
          刷新
        </button>
      </div>
      <SuiteHostCapacityStatus value={capacity} />
      <nav aria-label="数据库演练步骤">
        {tabs.map((title, i) => (
          <button disabled={busy} aria-pressed={tab === i} key={title} onClick={() => setTab(i)}>
            {title}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {workspaceId && tab === 0 && (
        <div className="suite-columns">
          <article>
            <h2>固定输入</h2>
            <label>
              示例
              <select
                aria-label="示例"
                value={template}
                onChange={(e) => {
                  const ids = ['add-column-backfill', 'unique-conflict', 'independent-recovery'];
                  setTemplate(e.target.value);
                  setOperations(JSON.stringify(templates[ids.indexOf(e.target.value)] ?? [], null, 2));
                  setPlan(null);
                }}
              >
                <option value="add-column-backfill">新增字段与回填</option>
                <option value="unique-conflict">唯一约束冲突</option>
                <option value="independent-recovery">转换失败与独立恢复</option>
              </select>
            </label>
            {button('生成并固定 20 行合成数据', () =>
              act('sources', 'generate', { ...scope, template, rows: 20, seed: 'database-v1' }),
            )}
            <label>
              数据文件
              <input type="file" accept=".json,.csv" onChange={(e) => setFile(e.target.files?.[0])} />
            </label>
            {button('上传材料', upload, !file)}
            {selector('sources')}
            {button('已审阅：固定 JSON 输入', () =>
              act('sources', 'pin', { ...scope, source: fixed('sources'), reviewed: true }),
            )}
            <details>
              <summary>固定 CSV 输入</summary>
              <p>只支持单表，首行必须按顺序列出全部列名。空值使用 \N。</p>
              <label>
                表名
                <input value={csvTable} onChange={(e) => setCsvTable(e.target.value)} />
              </label>
              <label>
                声明结构 JSON
                <textarea value={csvSchema} onChange={(e) => setCsvSchema(e.target.value)} />
              </label>
              {button('已审阅：固定 CSV 输入', () =>
                act('sources', 'importRows', {
                  ...scope,
                  source: fixed('sources'),
                  schema: JSON.parse(csvSchema),
                  table: csvTable,
                  nullToken: '\\N',
                }),
              )}
            </details>
            {button('验证固定输入结构', () =>
              act('schemas', 'validate', { ...scope, source: fixed('sources') }),
            )}
          </article>
          <article>
            <h2>编译变更</h2>
            {selector('schemas', 'sakura-database-validated/1')}
            <label>
              声明式操作 JSON
              <textarea
                rows={18}
                value={operations}
                onChange={(e) => {
                  setOperations(e.target.value);
                  setPlan(null);
                }}
              />
            </label>
            <p>
              支持建表、增删列、改名、无损类型转换、固定表达式回填、索引与约束。每条操作单独提交，失败后停止。
            </p>
            {button('编译并检查风险', () =>
              act('changes', 'compile', {
                ...scope,
                schema: fixed('schemas'),
                operations: JSON.parse(operations),
              }),
            )}
            {selector('changes')}
            <pre>{JSON.stringify(chosen('changes')?.content ?? null, null, 2)}</pre>
          </article>
        </div>
      )}
      {workspaceId && tab === 1 && (
        <div className="suite-columns">
          <article>
            <h2>独立基线副本</h2>
            <p>使用已准备的 PostgreSQL 17.11 镜像。运行阶段关闭外网，每次执行均建立新的隔离副本。</p>
            {selector('sources', 'sakura-database-pinned/1')}
            <label>
              镜像资产 ID
              <input
                value={assetId}
                onChange={(e) => {
                  setAssetId(e.target.value);
                  setPlan(null);
                }}
              />
            </label>
            <label>
              镜像 SHA-256
              <input
                value={digest}
                onChange={(e) => {
                  setDigest(e.target.value);
                  setPlan(null);
                }}
              />
            </label>
            {button('预览创建基线', () =>
              preview(
                'fixtures',
                'prepare',
                { ...scope, source: fixed('sources'), image, name: 'PostgreSQL 独立基线' },
                'checkpoint',
              ),
            )}
            {selector('fixtures')}
            {button('读取原副本状态', () =>
              act('fixtures', 'inspect', { ...scope, fixture: fixed('fixtures') }),
            )}
            {button('取消原基线执行', () =>
              act('fixtures', 'cancel', { ...scope, fixture: fixed('fixtures') }),
            )}
            {fixture.success && (
              <p>
                状态：{fixture.data.session?.state ?? 'preparing'}；结果：
                {fixture.data.result?.outcome ?? 'inconclusive'}；清理：
                {fixture.data.session?.cleanup ?? 'unknown'}
              </p>
            )}
          </article>
          <article>
            <h2>执行固定变更</h2>
            {selector('changes')}
            <label>
              <input
                type="checkbox"
                checked={destructive}
                onChange={(e) => {
                  setDestructive(e.target.checked);
                  setPlan(null);
                }}
              />
              已核对本次副本中的列删除或全部覆盖
            </label>
            {button('预览变更执行', () =>
              preview(
                'runners',
                'preview',
                {
                  ...scope,
                  fixture: fixed('fixtures'),
                  changes: fixed('changes'),
                  confirmDestructive: destructive,
                },
                'execute',
              ),
            )}
            {button('预览完整演练', () =>
              preview(
                'rehearsals',
                'preview',
                {
                  ...scope,
                  fixture: fixed('fixtures'),
                  changes: fixed('changes'),
                  confirmDestructive: destructive,
                },
                'start',
              ),
            )}
            {selector('runners')}
            {button('读取原执行状态', () => act('runners', 'inspect', { ...scope, run: fixed('runners') }))}
            {button('取消原执行', () => act('runners', 'cancel', { ...scope, run: fixed('runners') }))}
            {button('预览核销原副本', () =>
              preview('runners', 'reconcile', { ...scope, run: fixed('runners') }, 'confirmReconcile'),
            )}
            <pre>{JSON.stringify(chosen('runners')?.content ?? null, null, 2)}</pre>
          </article>
        </div>
      )}
      {workspaceId && tab === 2 && (
        <div className="suite-columns">
          <article>
            <h2>完整数据与未知状态</h2>
            {selector('runners')}
            {button('核对原执行和完整数据', () =>
              act('checks', 'evaluate', { ...scope, run: fixed('runners') }),
            )}
            {selector('checks')}
            {check.success && (
              <p>
                结论：{check.data.outcome}；清理：{check.data.cleanup}；观察到 {check.data.observedSteps}/
                {check.data.totalSteps} 条完成记录。{check.data.findings.join(' ')}
              </p>
            )}
            <pre>{JSON.stringify(chosen('checks')?.content ?? null, null, 2)}</pre>
          </article>
          <article>
            <h2>恢复到新的独立副本</h2>
            <p>使用原工具读回的完整逻辑基线。恢复会重新建库并比较全部选定数据，原未知写入不会重放。</p>
            <label>
              恢复镜像资产 ID
              <input value={assetId} onChange={(e) => setAssetId(e.target.value)} />
            </label>
            <label>
              恢复镜像 SHA-256
              <input value={digest} onChange={(e) => setDigest(e.target.value)} />
            </label>
            {button('预览独立恢复', () =>
              preview('runners', 'previewRestore', { ...scope, run: fixed('runners'), image }, 'restore'),
            )}
            {selector('rehearsals')}
            {button('读取演练与检查', () =>
              act('rehearsals', 'inspect', { ...scope, rehearsal: fixed('rehearsals') }),
            )}
            {button('取消原演练', () =>
              act('rehearsals', 'cancel', { ...scope, rehearsal: fixed('rehearsals') }),
            )}
            {button('预览演练恢复', () =>
              preview(
                'rehearsals',
                'recover',
                { ...scope, rehearsal: fixed('rehearsals'), image },
                'confirmRecovery',
              ),
            )}
            <pre>{JSON.stringify(chosen('rehearsals')?.content ?? null, null, 2)}</pre>
          </article>
        </div>
      )}
      {workspaceId && tab === 3 && (
        <>
          <article>
            <h2>封存与交接</h2>
            {selector('runners')}
            {selector('checks')}
            <label>
              报告说明
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
            </label>
            <label>
              未解决项（每行一项）
              <textarea value={unresolved} onChange={(e) => setUnresolved(e.target.value)} />
            </label>
            {button(
              '封存当前检查报告',
              () => {
                const c = D.databaseCheck.parse(chosen('checks')?.content);
                return act('reports', 'sealReport', {
                  ...scope,
                  run: c.run,
                  checks: fixed('checks'),
                  recovery: null,
                  summary,
                  unresolved: unresolved
                    .split(/\r?\n/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                });
              },
              !summary.trim(),
            )}
            <p>恢复运行可单独封存，报告中的恢复摘要必须匹配原固定基线。报告不构成生产变更批准。</p>
            {selector('sources')}
            {button('预览允许原材料导出', async () => {
              const source = fixed('sources'),
                policy = await invoke<{ revision: number }>('sources', 'policy', {
                  ...scope,
                  id: source.id,
                  revision: source.revision,
                });
              await preview(
                'sources',
                'planPolicy',
                {
                  ...scope,
                  id: source.id,
                  revision: source.revision,
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
            downloadName="database-evolution.sakura"
            description="只导出封存报告与其完整引用图。原材料须先明确允许导出；导入内容只作历史声明，执行计划和 VM 凭据不传递。"
          />
        </>
      )}
      {workspaceId && tab === 4 && (
        <article>
          <h2>固定修订与原资源核销</h2>
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
              const page = await invoke<S.SuitePage>(history, 'list', {
                ...scope,
                limit: 20,
                cursor: cursor[history],
                history: false,
                archived: false,
              });
              setRows((old) => ({ ...old, [history]: page.items }));
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
          {history === 'fixtures' &&
            button('预览原副本核销', () =>
              preview('fixtures', 'cleanupPreview', { ...scope, fixture: fixed('fixtures') }, 'cleanup'),
            )}
          <pre>{JSON.stringify(chosen(history)?.content ?? null, null, 2)}</pre>
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
          onCancel={() => {
            const current = plan;
            if (
              [
                'database-baseline',
                'database-rehearse',
                'database-restore',
                'database-run',
                'database-run-restore',
                'database-rehearsal',
                'database-rehearsal-restore',
              ].includes(current.value.action)
            )
              void run(async () => {
                await invoke(current.domain, 'discardPreview', {
                  workspaceId: current.value.workspaceId,
                  planId: current.value.id,
                  digest: current.value.digest,
                });
                setPlan(null);
              }, '未执行的预览材料已释放');
            else setPlan(null);
          }}
          onApprove={() =>
            void run(async () => {
              const current = plan;
              setPlan(null);
              const result = await invoke<unknown>(current.domain, current.apply, {
                workspaceId: current.value.workspaceId,
                planId: current.value.id,
                digest: current.value.digest,
              });
              const parsed = S.suiteRecord.safeParse(result);
              if (parsed.success) add(parsed.data);
              else await refresh();
            }, '固定计划已提交；可读取原执行记录')
          }
        />
      )}
    </section>
  );
}
