import './plugin-fonts.css';
/** 数据插件界面：选择来源与固定版本，审阅后提交，取消随页面寿命传播。 */
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { FeatureProps } from './feature-shared';
import { formatBytes } from './feature-shared';
import { uploadDeliveryFile, downloadDeliveryFile } from './delivery-transfer';
import { dataViewSchema, dataActionSchema, type DataView } from '../shared/contracts/data-services';
import { dataHttpResultSchema, dataPlanSchema } from '../shared/contracts/data-http';
import { deliveryManifestSchema } from '../shared/contracts/delivery-common';
import './data-lab.css';
type PanelProps = Pick<FeatureProps, 'request' | 'projectId'> & {
  scopeId: string;
  localArchive?: boolean;
  section: Section;
};
type Section =
  | 'runtime'
  | 'sources'
  | 'datasets'
  | 'transforms'
  | 'quality'
  | 'notebooks'
  | 'experiments'
  | 'lineage'
  | 'exchange'
  | 'workbench';
const titles: Record<Section, string> = {
  runtime: '数据环境',
  sources: '数据来源',
  datasets: '数据版本',
  transforms: 'SQL 变换',
  quality: '质量验证',
  notebooks: 'Notebook',
  experiments: '参数实验',
  lineage: '血缘与比较',
  exchange: '数据交接',
  workbench: '数据与实验工作台',
};
const actions: Record<Section, string[]> = {
  runtime: ['prepare-builtin', 'prepare-environment', 'cancel', 'reconcile', 'reconcile-preparation'],
  sources: ['capture-upload', 'credential-version', 'capture-project', 'capture-postgres'],
  datasets: ['seal', 'mask', 'archive'],
  transforms: ['save-query', 'run-query'],
  quality: ['save-rules', 'check'],
  notebooks: ['save-notebook', 'execute-notebook', 'open-notebook', 'stop-notebook', 'notebook-link'],
  experiments: ['plan-experiment', 'run-experiment', 'cancel-experiment'],
  lineage: ['graph', 'compare'],
  exchange: ['export', 'import-preview', 'accept', 'reconcile-import', 'inspect-import'],
  workbench: [],
};
const labels: Record<string, string> = {
  'prepare-builtin': '准备内置镜像环境',
  'prepare-environment': '准备指定镜像环境',
  'credential-version': '读取凭据引用版本',
  'capture-upload': '登记上传来源',
  'capture-project': '捕获项目文件',
  'capture-postgres': '只读捕获 PostgreSQL',
  seal: '封存数据版本',
  mask: '生成脱敏副本',
  archive: '归档版本',
  'save-query': '保存 SQL',
  'run-query': '执行 SQL',
  'save-rules': '保存质量规则',
  check: '检查数据质量',
  'save-notebook': '保存 Notebook',
  'execute-notebook': '执行 Notebook',
  'open-notebook': '打开交互会话',
  'stop-notebook': '停止并核销会话',
  'notebook-link': '获取会话入口',
  'plan-experiment': '计划参数实验',
  'cancel-experiment': '取消参数实验',
  'run-experiment': '运行剩余实验',
  graph: '查看版本血缘',
  compare: '比较执行结果',
  export: '导出数据交接包',
  'import-preview': '验证数据交接包',
  'inspect-import': '查看研究资料清单',
  'reconcile-import': '核对中断的接收',
  accept: '接收至新命名空间',
  cancel: '取消运行',
  reconcile: '核销遗留实例',
  'reconcile-preparation': '核销中断环境准备',
};
const fieldLabels: Record<string, string> = {
  name: '名称',
  id: '记录 ID',
  sourceId: '来源',
  datasetId: '数据版本',
  datasetIds: '输入版本（按顺序）',
  manifestId: '已上传的制品清单',
  format: '文件格式',
  files: '输入文件路径',
  paths: '项目内相对路径',
  sql: 'SQL（仅一个 SELECT；数据表为 data_0、data_1…）',
  parameters: '参数',
  rules: '质量规则',
  masks: '脱敏规则（未列出的列保持原值）',
  content: 'Notebook 文件内容',
  parse: '解析设置',
  evidenceIds: '显式选择的执行证据 ID（可留空）',
  allowOutputs: '明确导出执行定义及任意 Notebook 输出',
  allowRaw: '明确允许原始敏感数据及其输出',
  allowDownload: '明确允许联网准备固定依赖',
  expectedRevision: '预期修订（新建为 0）',
  sample: '前 N 行样本（0 表示全量）',
  namespace: '新的接收命名空间',
  leftId: '左侧执行证据 ID',
  rightId: '右侧执行证据 ID',
  definitionId: 'SQL 或 Notebook 定义 ID',
  kind: '实验种类',
  assetId: '固定镜像资产 ID',
  digest: '固定镜像 SHA-256',
  distro: '发行版',
  architecture: '架构',
  secretRef: '私密配置引用名称',
  connection: '只读连接（凭据仅填写 Secrets 引用与版本）',
};
const uuid = '00000000-0000-4000-8000-000000000000';
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
function defaults(action: string, v: DataView, selected: string[], envId: string) {
  const env = v.environments.find((e) => e.id === envId) ?? v.environments[0];
  const environment = {
    assetId: env?.image.id ?? '',
    digest: env?.image.digest ?? '',
    memoryMiB: 2048,
    cpus: 2,
    timeoutSeconds: 300,
  };
  const datasetIds = selected.length ? selected : v.datasets[0] ? [v.datasets[0].id] : [];
  const common = { action };
  const confirmed = { confirmed: true };
  const map: Record<string, object> = {
    'prepare-builtin': { name: '数据环境', distro: 'debian', architecture: 'x86_64', allowDownload: false },
    'prepare-environment': { name: '数据环境', assetId: '', digest: '', allowDownload: false },
    'credential-version': { secretRef: '' },
    'capture-upload': {
      name: '本地数据',
      manifestId: uuid,
      format: 'csv',
      files: ['table.csv'],
      ...confirmed,
    },
    'capture-project': { name: '项目数据', paths: ['data/table.csv'], format: 'csv', ...confirmed },
    'capture-postgres': {
      name: '只读数据库快照',
      connection: {
        host: '',
        address: '',
        port: 5432,
        database: '',
        user: '',
        secretRef: '',
        secretVersion: '',
        schema: 'public',
        table: '',
        columns: ['id'],
        timeoutSeconds: 60,
      },
      ...confirmed,
    },
    seal: {
      name: '数据版本',
      sourceId: v.sources[0]?.id ?? uuid,
      parse: { delimiter: ',', header: true, nullValue: '' },
      environment,
      ...confirmed,
    },
    mask: {
      name: '脱敏副本',
      datasetId: datasetIds[0] ?? uuid,
      masks: [{ kind: 'drop', column: 'email' }],
      environment,
      ...confirmed,
    },
    archive: { id: datasetIds[0] ?? uuid },
    'save-query': {
      name: '查询',
      expectedRevision: 0,
      sql: 'SELECT * FROM data_0',
      parameters: {},
      datasetIds,
    },
    'run-query': { id: v.queries[0]?.id ?? uuid, environment, ...confirmed },
    'save-rules': { name: '质量规则', expectedRevision: 0, rules: [{ kind: 'row-count', min: 1 }] },
    check: { id: v.rules[0]?.id ?? uuid, datasetIds, environment, sample: 0, ...confirmed },
    'save-notebook': {
      name: '分析',
      expectedRevision: 0,
      content: pretty({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          {
            id: 'analysis',
            cell_type: 'code',
            metadata: {},
            source:
              'import json\nfrom pathlib import Path\nprint(json.loads(Path("datasets.json").read_text()))',
            outputs: [],
            execution_count: null,
          },
        ],
      }),
      datasetIds,
      allowRaw: false,
    },
    'execute-notebook': {
      id: v.notebooks[0]?.id ?? uuid,
      environment,
      parameters: {},
      allowRaw: false,
      ...confirmed,
    },
    'open-notebook': { id: v.notebooks[0]?.id ?? uuid, environment, allowRaw: false, ...confirmed },
    'stop-notebook': { id: v.sessions.find((s) => s.state !== 'stopped')?.id ?? uuid },
    'notebook-link': { id: v.sessions.find((s) => s.state === 'active')?.id ?? uuid },
    'plan-experiment': {
      name: '参数实验',
      kind: 'sql',
      definitionId: v.queries[0]?.id ?? uuid,
      parameters: { threshold: [1, 2, 3] },
    },
    'cancel-experiment': { id: v.experiments[0]?.id ?? uuid },
    'run-experiment': { id: v.experiments[0]?.id ?? uuid, environment, allowRaw: false, ...confirmed },
    graph: {},
    compare: { leftId: v.evidence[0]?.id ?? uuid, rightId: v.evidence[1]?.id ?? uuid },
    export: { datasetIds, evidenceIds: [], allowOutputs: false, allowRaw: false, ...confirmed },
    'import-preview': { manifestId: uuid },
    'inspect-import': { id: v.imports[0]?.id ?? uuid },
    'reconcile-import': { id: v.imports.find((i) => i.state === 'accepting')?.id ?? uuid },
    accept: {
      id: v.imports.find((i) => i.state === 'quarantined')?.id ?? uuid,
      namespace: 'study-' + new Date().toISOString().slice(0, 10),
      ...confirmed,
    },
    'reconcile-preparation': { id: v.preparations.find((p) => p.cleanup === 'unknown')?.id ?? uuid },
    cancel: { id: v.runs.find((r) => !r.finishedAt)?.id ?? uuid },
    reconcile: { id: v.runs.find((r) => r.cleanup === 'unknown')?.id ?? uuid },
  };
  return { ...common, ...map[action] };
}
export function DataPanel(props: FeatureProps & { section: Section }) {
  return (
    <DataScopePanel
      request={props.request}
      projectId={props.projectId}
      scopeId={props.vm.id}
      section={props.section}
    />
  );
}
export function DataScopePanel(props: PanelProps) {
  return (
    <ScopePanel key={props.scopeId + ':' + (props.projectId ?? 'default') + ':' + props.section} {...props} />
  );
}
function ScopePanel({ scopeId, localArchive = false, projectId = 'default', request, section }: PanelProps) {
  const [view, setView] = useState<DataView>(dataViewSchema.parse({})),
    [tab, setTab] = useState<Section>(section === 'workbench' ? 'sources' : section),
    [invalid, setInvalid] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [environment, setEnvironment] = useState(''),
    [selected, setSelected] = useState<string[]>([]),
    [action, setAction] = useState(actions[section === 'workbench' ? 'sources' : section][0]),
    [draft, setDraft] = useState<Record<string, unknown>>({}),
    [plan, setPlan] = useState<z.infer<typeof dataPlanSchema> | null>(null),
    [result, setResult] = useState<unknown>(null),
    [file, setFile] = useState<File | null>(null);
  const controller = useRef(new AbortController()),
    dirty = useRef(false);
  const query = '?vmId=' + encodeURIComponent(scopeId) + '&projectId=' + encodeURIComponent(projectId),
    url = '/data-' + section + query,
    artifactUrl = '/delivery-artifacts' + query;
  useEffect(() => {
    controller.current = new AbortController();
    void reload();
    return () => controller.current.abort();
  }, [request]);
  async function reload() {
    try {
      const data = dataViewSchema.parse(await request(url, 'GET', undefined, controller.current.signal));
      if (!controller.current.signal.aborted) {
        setView(data);
        if (!dirty.current) setDraft(defaults(action, data, selected, environment));
      }
    } catch (e) {
      if (!controller.current.signal.aborted) setError(e instanceof Error ? e.message : '读取失败');
    }
  }
  function choose(next: string) {
    dirty.current = true;
    setAction(next);
    setDraft(defaults(next, view, selected, environment));
    setPlan(null);
    setResult(null);
    setInvalid([]);
    setError('');
  }
  useEffect(() => {
    setDraft(defaults(action, view, selected, environment));
  }, []);
  function update(key: string, value: unknown) {
    dirty.current = true;
    setPlan(null);
    setDraft((old) => ({ ...old, [key]: value }));
  }
  async function perform(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      if (!controller.current.signal.aborted) setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  async function preview() {
    await perform(async () => {
      if (localArchive && ['capture-project', 'capture-postgres', 'credential-version'].includes(action))
        throw new Error('此操作需要选择实际来源实例；本地档案不提供项目文件和实例凭据。');
      if (invalid.length) throw new Error('请先修复无效字段：' + invalid.join('、'));
      const input = dataActionSchema.parse({
        ...draft,
        action,
        ...('environment' in draft && view.environments.length
          ? {
              environment: (defaults(action, view, selected, environment) as Record<string, unknown>)
                .environment,
            }
          : {}),
      });
      const response = dataHttpResultSchema.parse(
        await request(url, 'POST', { phase: 'preview', input }, controller.current.signal),
      );
      if (!('plan' in response)) throw new Error('缺少计划');
      setPlan(response.plan);
    });
  }
  async function commit() {
    if (!plan) return;
    const token = plan.token;
    setPlan(null);
    await perform(async () => {
      const response = dataHttpResultSchema.parse(
        await request(url, 'POST', { phase: 'commit', token }, controller.current.signal),
      );
      setResult(response);
      setMessage('message' in response ? (response.message ?? '操作完成，已记录实际结果') : '操作完成');
      await reload();
    });
  }
  async function upload() {
    if (!file) return;
    dirty.current = true;
    await perform(async () => {
      if (tab === 'sources' && file.size > 512 * 1024 ** 2) throw new Error('数据源总量最多 512 MiB');
      const manifest = await uploadDeliveryFile(
        request,
        artifactUrl,
        file,
        controller.current.signal,
        setMessage,
      );
      if (tab === 'exchange') {
        setAction('import-preview');
        setDraft({ action: 'import-preview', manifestId: manifest.id });
      } else {
        const ext = file.name.split('.').pop();
        setAction('capture-upload');
        setDraft({
          action: 'capture-upload',
          name: file.name,
          manifestId: manifest.id,
          format: ext === 'parquet' ? 'parquet' : ext === 'jsonl' ? 'jsonl' : 'csv',
          files: manifest.files.map((f) => f.path),
          confirmed: true,
        });
      }
      setPlan(null);
      setMessage('上传已封存，请审阅登记或验证计划');
    });
  }
  async function download(id: string) {
    await perform(async () => {
      const manifests = z
        .array(deliveryManifestSchema)
        .parse(await request(artifactUrl, 'GET', undefined, controller.current.signal));
      const manifest = manifests.find((v) => v.id === id);
      if (!manifest || manifest.files.length !== 1) throw new Error('下载清单不存在或含多个文件');
      await downloadDeliveryFile(
        request,
        artifactUrl,
        manifest.files[0],
        manifest.id,
        controller.current.signal,
      );
    });
  }
  const listKey: Record<Section, keyof DataView> = {
    runtime: 'runs',
    sources: 'sources',
    datasets: 'datasets',
    transforms: 'queries',
    quality: 'rules',
    notebooks: 'notebooks',
    experiments: 'experiments',
    lineage: 'evidence',
    exchange: 'imports',
    workbench: 'datasets',
  };
  const rows = view[listKey[tab]] as unknown as Record<string, unknown>[];
  return (
    <section className="data-lab">
      <header>
        <div>
          <h3>{titles[section]}</h3>
          <p>固定数据 → SQL 与质量验证 → Notebook 与参数实验 → 可核验交接</p>
        </div>
        <button disabled={busy} onClick={() => void reload()}>
          刷新记录
        </button>
      </header>
      {section === 'workbench' && (
        <nav aria-label="数据工作流">
          {Object.keys(titles)
            .filter((s) => s !== 'workbench')
            .map((s) => (
              <button
                key={s}
                aria-pressed={tab === s}
                onClick={() => {
                  setTab(s as Section);
                  choose(actions[s as Section][0]);
                }}
              >
                {titles[s as Section]}
              </button>
            ))}
        </nav>
      )}
      <p className="data-help">
        单版本最多 512 MiB / 128 个分区；单次输入 1 GiB、输出 256
        MiB。抽样结果不代表全量质量，脱敏副本不修改原数据。
      </p>
      {error && (
        <p role="alert" className="data-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="data-layout">
        <div className="data-actions">
          <h4>{titles[tab]}</h4>
          {['sources', 'exchange'].includes(tab) && (
            <div className="data-upload">
              <label>
                {tab === 'exchange' ? '导入数据交接 ZIP' : '选择本地 CSV、JSONL 或 Parquet'}
                <input
                  type="file"
                  accept={tab === 'exchange' ? '.zip' : '.csv,.jsonl,.parquet'}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button disabled={!file || busy} onClick={() => void upload()}>
                上传并封存
              </button>
            </div>
          )}
          <label>
            操作
            <select value={action} disabled={busy} onChange={(e) => choose(e.target.value)}>
              {actions[tab].map((a) => (
                <option
                  key={a}
                  value={a}
                  disabled={
                    localArchive && ['capture-project', 'capture-postgres', 'credential-version'].includes(a)
                  }
                >
                  {labels[a]}
                </option>
              ))}
            </select>
          </label>
          {'environment' in draft && (
            <label>
              固定执行环境
              <select
                value={environment}
                onChange={(e) => {
                  setEnvironment(e.target.value);
                  setPlan(null);
                }}
              >
                <option value="">使用第一个已准备环境</option>
                {view.environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} · {env.image.digest.slice(0, 12)}
                  </option>
                ))}
              </select>
              {!view.environments.length && (
                <small>请先在数据环境中准备镜像；独立插件可在下方高级参数填写固定镜像。</small>
              )}
            </label>
          )}
          {Object.entries(draft)
            .filter(([k]) => !['action', 'confirmed', 'environment'].includes(k))
            .map(([key, value]) => (
              <Field
                key={action + key}
                label={fieldLabels[key] ?? key}
                value={value}
                disabled={busy}
                onChange={(v) => update(key, v)}
                onInvalid={(bad) =>
                  setInvalid((old) => (bad ? [...new Set([...old, key])] : old.filter((k) => k !== key)))
                }
              />
            ))}
          {'environment' in draft && !view.environments.length && (
            <Field
              label="固定环境参数"
              value={draft.environment}
              disabled={busy}
              onChange={(value) => update('environment', value)}
              onInvalid={(bad) =>
                setInvalid((old) =>
                  bad ? [...new Set([...old, 'environment'])] : old.filter((k) => k !== 'environment'),
                )
              }
            />
          )}
          <button className="primary" disabled={busy} onClick={() => void preview()}>
            审阅执行计划
          </button>
          {busy && (
            <button
              onClick={() => {
                controller.current.abort();
                controller.current = new AbortController();
                setBusy(false);
                setMessage('已请求取消；请刷新运行核销结果');
              }}
            >
              取消当前请求
            </button>
          )}
          {plan && (
            <div className="data-plan">
              <h4>提交前核对</h4>
              <ul>
                {plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <pre>{pretty(plan.input)}</pre>
              <p>有效期至 {new Date(plan.expiresAt).toLocaleTimeString()}</p>
              <button disabled={busy} onClick={() => void commit()}>
                确认并执行
              </button>
              <button onClick={() => setPlan(null)}>返回修改</button>
            </div>
          )}
        </div>
        <div className="data-records">
          <h4>
            当前记录 <small>{rows.length}</small>
          </h4>
          {rows.length === 0 ? (
            <p>此项目尚无相关记录。</p>
          ) : (
            rows.map((row) => (
              <article key={String(row.id)}>
                <strong>{String(row.name ?? row.id)}</strong>
                <p>
                  {String(row.state ?? row.sensitivity ?? row.kind ?? '已记录')}
                  {typeof row.bytes === 'number' ? ' · ' + formatBytes(row.bytes) : ''}
                </p>
                <code>{String(row.id)}</code>
                {tab === 'datasets' && (
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(String(row.id))}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked ? [...old, String(row.id)] : old.filter((id) => id !== row.id),
                        )
                      }
                    />
                    选作下一步输入
                  </label>
                )}
                <details>
                  <summary>查看记录</summary>
                  <pre>{pretty(row)}</pre>
                </details>
              </article>
            ))
          )}
          {tab === 'runtime' &&
            view.preparations.map((preparation) => (
              <article key={preparation.id}>
                <strong>
                  {preparation.name} · {preparation.state}
                </strong>
                <code>{preparation.id}</code>
                <p>环境准备清理：{preparation.cleanup}</p>
              </article>
            ))}
          {tab === 'notebooks' &&
            view.sessions.map((session) => (
              <article key={session.id}>
                <strong>交互会话 · {session.state}</strong>
                <code>{session.id}</code>
                <p>
                  {session.sensitivity === 'raw' ? '原始敏感输出' : '脱敏输入会话'} · 清理{' '}
                  {session.receipt.cleanup}
                </p>
              </article>
            ))}
          {result !== null && (
            <article>
              <h4>本次结果</h4>
              {typeof result === 'object' && result && 'url' in result && typeof result.url === 'string' && (
                <a href={result.url} target="_blank" rel="noreferrer">
                  打开本机会话
                </a>
              )}
              {typeof result === 'object' &&
                result &&
                'manifestId' in result &&
                typeof result.manifestId === 'string' && (
                  <button onClick={() => void download(result.manifestId as string)}>下载交接文件</button>
                )}
              <pre>{pretty(result)}</pre>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}
function Field({
  label,
  value,
  onChange,
  disabled,
  onInvalid,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  onInvalid: (bad: boolean) => void;
}) {
  const [text, setText] = useState(pretty(value));
  useEffect(() => setText(pretty(value)), [value]);
  if (typeof value === 'boolean')
    return (
      <label className="data-check">
        <input
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  if (typeof value === 'number')
    return (
      <label>
        {label}
        <input
          type="number"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  if (typeof value === 'string')
    return (
      <label>
        {label}
        {value.includes('\n') || label.includes('SQL') || label.includes('Notebook 文件') ? (
          <textarea rows={6} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        )}
      </label>
    );
  return (
    <label>
      {label}
      <textarea
        rows={Math.min(12, text.split('\n').length + 1)}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            onInvalid(false);
          } catch {
            onInvalid(true);
          }
        }}
      />
    </label>
  );
}
