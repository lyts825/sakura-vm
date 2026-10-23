/** 交付工作台：各写入步骤显式触发，跨项目切换时销毁旧草稿和请求。
 * Delivery workbench with explicit mutations and draft/request disposal across scope changes. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Feedback, formatBytes, useAction, useRemote, type FeatureProps } from './feature-shared';
import {
  deliveryCandidateSchema,
  deliveryDefinitionSchema,
  deliveryManifestSchema,
  deliveryPathSchema,
  type DeliveryCandidate,
  type DeliveryDefinition,
} from '../shared/contracts/delivery-common';
import {
  deliveryInputPlanSchema,
  deliveryInputSchema,
  deliveryCleanupPlanSchema,
  type DeliveryInputPlan,
  type DeliveryCleanupPlan,
} from '../shared/contracts/delivery-storage';
import { deliveryRunSchema, deliveryPreviewSchema } from '../shared/contracts/delivery-execution';
import {
  deliveryEvidenceSchema,
  deliveryPolicyInputSchema,
  deliveryGateViewSchema,
  deliveryReleaseViewSchema,
} from '../shared/contracts/delivery-quality';
import {
  deliveryTemplates,
  deliveryWorkbenchSchema,
  type DeliveryDefinitionRecord,
} from '../shared/contracts/delivery-workbench';
import { deliveryHttpResponses, deliveryExportResultSchema } from '../shared/contracts/delivery-http';
import { uploadDeliveryFile, downloadDeliveryFile } from './delivery-transfer';
import './delivery.css';
import { usePlugin } from './plugin-context';

type Section =
  'workbench' | 'inputs' | 'runners' | 'reports' | 'gates' | 'artifacts' | 'previews' | 'releases';
const labels: Record<Section, string> = {
  workbench: '交付定义',
  inputs: '输入快照',
  runners: '隔离执行',
  reports: '验证报告',
  gates: '交付规则',
  artifacts: '制品仓库',
  previews: '候选预览',
  releases: '本地版本',
};
const sections = Object.keys(labels) as Section[];
const deps: Record<Section, Section[]> = {
  workbench: sections,
  artifacts: ['artifacts'],
  inputs: ['inputs'],
  runners: ['runners', 'inputs'],
  reports: ['reports', 'runners', 'artifacts'],
  gates: ['gates', 'runners', 'reports', 'previews'],
  previews: ['previews'],
  releases: ['releases', 'runners', 'inputs', 'artifacts', 'reports', 'gates', 'previews'],
};
const status: Record<string, string> = {
  passed: '通过',
  failed: '失败',
  incomplete: '证据不全',
  waived: '已豁免',
  success: '成功',
  cancelled: '已取消',
  interrupted: '已中断',
  queued: '排队',
  preparing: '准备',
  running: '执行',
  collecting: '采集',
  finished: '结束',
  verified: '已确认',
  unknown: '待核对',
  pending: '等待',
  healthy: '健康',
  unhealthy: '异常',
  starting: '启动',
  stopped: '已停止',
  expired: '已到期',
  registered: '已登记',
  withdrawn: '已撤回',
  archived: '已归档',
  quarantined: '隔离区',
  accepted: '已接收',
  trusted: '可信',
  unsigned: '未签名',
  revoked: '已撤销',
  deferred: '待登记核验',
};
const label = (value?: string) => (value ? status[value] || value : '尚无结论');
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
/** 折叠展示原始证据，不从记录自行推断通过。 Display raw evidence without inferring success. */
function Evidence({ value, title = '完整记录' }: { value: unknown; title?: string }) {
  return (
    <details>
      <summary>{title}</summary>
      <pre>{pretty(value)}</pre>
    </details>
  );
}

/** 以身份和请求代次重建工作台，清除旧审阅与迟到操作。
 * Remount on identity or request-generation changes to discard stale reviews and operations. */
export function DeliveryPanel(props: FeatureProps & { section: Section }) {
  const [manualProject, setManualProject] = useState('');
  const scope = useRef({ request: props.request, generation: 0 });
  if (scope.current.request !== props.request)
    scope.current = { request: props.request, generation: scope.current.generation + 1 };
  const projectId = props.projectId || manualProject;
  return (
    <>
      {!props.projectId && (
        <label>
          项目标识
          <input
            value={manualProject}
            onChange={(event) => setManualProject(event.target.value)}
            placeholder="项目 ID"
          />
        </label>
      )}
      <DeliveryWorkspace
        key={`${props.vm.id}:${projectId}:${props.section}:${props.token}:${scope.current.generation}`}
        {...props}
        projectId={projectId}
      />
    </>
  );
}
/** 查询已装配领域，校验响应并将每项操作绑定当前项目及取消寿命。
 * Read available domains, validate responses and bind each operation to the current scope and cancellation lifetime. */
function DeliveryWorkspace({
  vm,
  projectId,
  request,
  section,
  onDevelopmentNavigate,
}: FeatureProps & { section: Section }) {
  const repairEnabled = usePlugin('repair');
  const [repairTarget, setRepairTarget] = useState('');
  const [tab, setTab] = useState<Section>(section === 'workbench' ? 'workbench' : section);
  const [scopeProject, setScopeProject] = useState(projectId || '');
  useEffect(() => {
    if (projectId) setScopeProject(projectId);
  }, [projectId]);
  const query = `?vmId=${encodeURIComponent(vm.id)}&projectId=${encodeURIComponent(scopeProject)}`;
  const endpoint = (id: Section) => `/delivery-${id}${query}`;
  const allowed = deps[section],
    enabled = !!scopeProject;
  const workbench = useRemote(request, endpoint('workbench'), enabled && allowed.includes('workbench'));
  const inputView = useRemote(request, endpoint('inputs'), enabled && allowed.includes('inputs'));
  const runView = useRemote(request, endpoint('runners'), enabled && allowed.includes('runners'));
  const reportView = useRemote(request, endpoint('reports'), enabled && allowed.includes('reports'));
  const gateView = useRemote(request, endpoint('gates'), enabled && allowed.includes('gates'));
  const artifactView = useRemote(request, endpoint('artifacts'), enabled && allowed.includes('artifacts'));
  const previewView = useRemote(request, endpoint('previews'), enabled && allowed.includes('previews'));
  const releaseView = useRemote(request, endpoint('releases'), enabled && allowed.includes('releases'));
  const views = {
    workbench,
    inputs: inputView,
    runners: runView,
    reports: reportView,
    gates: gateView,
    artifacts: artifactView,
    previews: previewView,
    releases: releaseView,
  };
  const parsedWorkbench = deliveryWorkbenchSchema.safeParse(workbench.data),
    inputs = z.array(deliveryInputSchema).safeParse(inputView.data),
    runs = z.array(deliveryRunSchema).safeParse(runView.data);
  const reports = z.array(deliveryEvidenceSchema).safeParse(reportView.data),
    gates = deliveryGateViewSchema.safeParse(gateView.data),
    artifacts = z.array(deliveryManifestSchema).safeParse(artifactView.data);
  const previews = z.array(deliveryPreviewSchema).safeParse(previewView.data),
    releases = deliveryReleaseViewSchema.safeParse(releaseView.data);
  const records = parsedWorkbench.success ? parsedWorkbench.data.definitions : [],
    inputRows = inputs.success ? inputs.data : [],
    runRows = runs.success ? runs.data : [];
  const reportRows = reports.success ? reports.data : [],
    gateState = gates.success ? gates.data : undefined,
    artifactRows = artifacts.success ? artifacts.data : [],
    previewRows = previews.success ? previews.data : [];
  const releaseState = releases.success ? releases.data : undefined;
  const candidates = [
    ...(releaseState?.candidates || []),
    ...(releaseState?.imports.filter((x) => x.status === 'accepted').map((x) => x.candidate) || []),
  ];
  const [draft, setDraft] = useState<DeliveryDefinition>(() =>
    structuredClone(deliveryTemplates[0].definition),
  );
  const [record, setRecord] = useState<DeliveryDefinitionRecord>();
  const [definitionText, setDefinitionText] = useState(''),
    [candidateText, setCandidateText] = useState(''),
    [candidateId, setCandidateId] = useState('');
  const importedCandidate = useMemo(() => {
    try {
      return deliveryCandidateSchema.parse(JSON.parse(candidateText));
    } catch {
      return undefined;
    }
  }, [candidateText]);
  const candidate = candidates.find((c) => c.id === candidateId) || importedCandidate;
  const [selectedInput, setSelectedInput] = useState(''),
    [selectedRun, setSelectedRun] = useState(''),
    [selectedOutput, setSelectedOutput] = useState('');
  const [plan, setPlan] = useState<DeliveryInputPlan>(),
    [cleanup, setCleanup] = useState<DeliveryCleanupPlan>();
  const [reviewed, setReviewed] = useState(false),
    [progress, setProgress] = useState(''),
    [result, setResult] = useState<unknown>();
  const [policyText, setPolicyText] = useState(() =>
    pretty(deliveryPolicyInputSchema.parse({ expectedRevision: 0 })),
  );
  const [policyId, setPolicyId] = useState(''),
    [decisionId, setDecisionId] = useState(''),
    [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [waivers, setWaivers] = useState(''),
    [reportPath, setReportPath] = useState('junit.xml'),
    [reportManifest, setReportManifest] = useState(''),
    [reportFormat, setReportFormat] = useState('junit');
  const [leftReport, setLeftReport] = useState(''),
    [rightReport, setRightReport] = useState('');
  const [namespace, setNamespace] = useState('project'),
    [version, setVersion] = useState('1.0.0'),
    [notes, setNotes] = useState(''),
    [releaseId, setReleaseId] = useState('');
  const [includeSource, setIncludeSource] = useState(false),
    [signingRef, setSigningRef] = useState(''),
    [lifetime, setLifetime] = useState(30),
    [reason, setReason] = useState('');
  const [keyId, setKeyId] = useState(''),
    [publisher, setPublisher] = useState(''),
    [publicKey, setPublicKey] = useState('');
  const [retrySteps, setRetrySteps] = useState(''),
    [importNamespace, setImportNamespace] = useState(''),
    [allowUntrusted, setAllowUntrusted] = useState(false);
  const action = useAction(),
    cancellation = useAction();
  // 审阅结论只属于当时选定的内容；切换任何执行或证据输入后重新确认。
  // Reviews belong to the selected content and must be renewed when execution or evidence inputs change.
  const selectedEvidence = evidenceIds.join(',');
  useEffect(() => {
    setReviewed(false);
  }, [
    selectedInput,
    selectedRun,
    candidate?.digest,
    selectedEvidence,
    importNamespace,
    allowUntrusted,
    lifetime,
    policyId,
    draft,
  ]);
  const blocked = action.busy || !enabled;
  /** 写入后校验结果并刷新原领域，取消后不写回界面。
   * Validate mutation results and refresh their domain without updating the UI after cancellation. */
  const act = async (id: Section, body: unknown, signal: AbortSignal) => {
    const response = await request(endpoint(id), 'POST', body, signal);
    signal.throwIfAborted();
    const value = deliveryHttpResponses[`delivery-${id}.act`].schema.parse(response);
    setResult(value);
    await views[id].reload();
    signal.throwIfAborted();
    return value;
  };
  const perform = (id: Section, body: unknown) => void action.run((signal) => act(id, body, signal));
  /** 编辑定义即使已有捕获计划失效。 Editing invalidates the pending capture plan and review. */
  const edit = (value: DeliveryDefinition) => {
    setDraft(value);
    setPlan(undefined);
    setReviewed(false);
  };
  const run = runRows.find((row) => row.id === selectedRun);
  const currentInput = inputRows.find((row) => row.id === selectedInput);
  /** 切换候选时清除旧证据和判定，服务端仍核对真实身份。
   * Clear stale evidence and decisions when selecting a candidate; server identity checks still apply. */
  const chooseCandidate = (value: DeliveryCandidate) => {
    setCandidateId(value.id);
    setCandidateText(pretty(value));
    setDecisionId('');
    setEvidenceIds([]);
    setReviewed(false);
  };
  const candidateControls = (
    <div className="delivery-grid">
      <label>
        交付候选
        <select
          value={candidateId}
          onChange={(event) => {
            const value = candidates.find((c) => c.id === event.target.value);
            if (value) chooseCandidate(value);
            else setCandidateId('');
          }}
        >
          <option value="">选择候选或粘贴描述</option>
          {candidates.map((value) => (
            <option key={value.id} value={value.id}>
              {value.id.slice(0, 8)} · {value.digest.slice(0, 12)}
            </option>
          ))}
        </select>
      </label>
      <details>
        <summary>候选描述（用于独立插件之间传递）</summary>
        <textarea
          aria-label="候选描述"
          rows={8}
          value={candidateText}
          onChange={(e) => {
            setCandidateText(e.target.value);
            setCandidateId('');
            setReviewed(false);
          }}
        />
      </details>
      {candidate && (
        <p>
          固定内容：<code>{candidate.digest}</code>
        </p>
      )}
    </div>
  );
  const runSelect = (
    <label>
      运行
      <select
        value={selectedRun}
        onChange={(e) => {
          setSelectedRun(e.target.value);
          setSelectedOutput('');
        }}
      >
        <option value="">请选择</option>
        {runRows.map((value) => (
          <option key={value.id} value={value.id}>
            {value.id.slice(0, 8)} · {value.mode} · {label(value.result || value.state)}
          </option>
        ))}
      </select>
    </label>
  );
  const confirm = (
    <label className="delivery-check">
      <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
      我已审阅本次内容、命令、联网权限和所选证据
    </label>
  );
  return (
    <div className="feature-card delivery-workspace">
      <h3>{section === 'workbench' ? '项目交付工作台' : labels[section]}</h3>
      <p>输入 → 隔离执行 → 报告与规则 → 制品预览 → 本地版本与离线交接</p>
      {section === 'workbench' && (
        <nav aria-label="交付阶段">
          {sections.map((id) => (
            <button
              key={id}
              className={tab === id ? 'primary compact' : 'secondary compact'}
              onClick={() => setTab(id)}
            >
              {labels[id]}
            </button>
          ))}
        </nav>
      )}
      <div className="delivery-toolbar">
        <button className="secondary compact" disabled={!enabled} onClick={() => void views[tab].reload()}>
          刷新本阶段
        </button>
        <span>
          源实例：{vm.name} · 项目：{scopeProject || '未选择'}
        </span>
      </div>
      <Feedback
        error={action.error || cancellation.error || views[tab].error}
        message={action.message || progress}
      />
      {views[tab].data &&
        !{
          workbench: parsedWorkbench.success,
          inputs: inputs.success,
          runners: runs.success,
          reports: reports.success,
          gates: gates.success,
          artifacts: artifacts.success,
          previews: previews.success,
          releases: releases.success,
        }[tab] && <p role="alert">服务响应结构不兼容，已停止使用该响应。</p>}
      {tab === 'workbench' && (
        <>
          <div className="delivery-grid">
            <label>
              从模板开始
              <select
                onChange={(e) => {
                  const value = deliveryTemplates.find((x) => x.id === e.target.value);
                  if (value) {
                    setRecord(undefined);
                    edit(structuredClone(value.definition));
                  }
                }}
                defaultValue="static"
              >
                {deliveryTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              现有定义
              <select
                value={record?.id || ''}
                onChange={(e) => {
                  const value = records.find((x) => x.id === e.target.value);
                  setRecord(value);
                  if (value) edit(structuredClone(value.definition));
                }}
              >
                <option value="">新定义</option>
                {records.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.definition.name} · r{value.revision}
                    {value.archived ? ' · 已归档' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <DefinitionEditor value={draft} onChange={edit} />
          <div className="delivery-toolbar">
            <button
              disabled={blocked}
              onClick={() =>
                void action.run(async (signal) => {
                  const value = await act(
                    'workbench',
                    {
                      action: 'save',
                      input: { id: record?.id, expectedRevision: record?.revision || 0, definition: draft },
                    },
                    signal,
                  );
                  setRecord(value as DeliveryDefinitionRecord);
                })
              }
            >
              保存定义
            </button>
            <button
              disabled={blocked || !record}
              onClick={() => perform('workbench', { action: 'copy', id: record!.id })}
            >
              复制定义
            </button>
            <button
              disabled={blocked || !record || record.archived}
              onClick={() =>
                perform('workbench', {
                  action: 'archive',
                  id: record!.id,
                  expectedRevision: record!.revision,
                })
              }
            >
              归档定义
            </button>
            <button
              disabled={blocked}
              onClick={() => {
                setDefinitionText(pretty(draft));
                setTab('inputs');
              }}
            >
              进入输入捕获
            </button>
          </div>
          <details>
            <summary>导入 / 导出定义</summary>
            <textarea
              rows={8}
              aria-label="交付定义 JSON"
              value={definitionText}
              onChange={(e) => setDefinitionText(e.target.value)}
            />
            <button disabled={blocked} onClick={() => setDefinitionText(pretty(draft))}>
              复制当前定义到文本区
            </button>
            <button
              disabled={blocked || !definitionText}
              onClick={() =>
                void action.run(async (signal) => {
                  const value = await act(
                    'workbench',
                    { action: 'preview-import', text: definitionText },
                    signal,
                  );
                  setRecord(undefined);
                  edit(deliveryDefinitionSchema.parse(value));
                })
              }
            >
              预览导入内容
            </button>
            <p>预览仅载入编辑器，保存后才建立定义。</p>
          </details>
        </>
      )}
      {tab === 'inputs' && (
        <>
          <DefinitionEditor value={draft} onChange={edit} />
          <p className="subtle-note">
            捕获需要源实例正在运行且已安装 Git、Python 3。提交模式固定 Git
            对象；草稿模式必须逐项审阅。子模块、未物化 LFS 和链接会明确拒绝。
          </p>
          {confirm}
          <button
            disabled={blocked || vm.status !== 'running' || (draft.source.mode === 'draft' && !reviewed)}
            onClick={() =>
              void action.run(async (signal) => {
                setPlan(
                  deliveryInputPlanSchema.parse(
                    await act(
                      'inputs',
                      { action: 'preview', definition: draft, reviewedDraft: reviewed },
                      signal,
                    ),
                  ),
                );
                setReviewed(false);
              })
            }
          >
            预览实际输入
          </button>
          {plan && (
            <article>
              <h4>
                待固定 {plan.files.length} 个文件 · {formatBytes(plan.totalBytes)}
              </h4>
              <p>
                提交：{plan.commit || '显式草稿'} · 有效至 {new Date(plan.expiresAt).toLocaleString()}
              </p>
              <Evidence
                value={{ files: plan.files, changes: plan.changes, excluded: plan.excluded }}
                title="审阅文件、改动和排除项"
              />
              <button
                disabled={blocked || !reviewed}
                onClick={() =>
                  void action.run(async (signal) => {
                    const value = deliveryInputSchema.parse(
                      await act('inputs', { action: 'capture', token: plan.token }, signal),
                    );
                    setSelectedInput(value.id);
                    setPlan(undefined);
                    if (section === 'workbench') setTab('runners');
                  })
                }
              >
                确认并固定输入
              </button>
            </article>
          )}
          {inputRows.map((value) => (
            <article key={value.id}>
              <h4>{value.definition.name}</h4>
              <p>
                {value.mode} · {value.commit?.slice(0, 12) || '草稿'} · {value.createdAt}
              </p>
              <code>{value.digest}</code>
              <button
                onClick={() => {
                  setSelectedInput(value.id);
                  edit(value.definition);
                  if (section === 'workbench') setTab('runners');
                }}
              >
                使用此快照
              </button>
              <Evidence value={value} />
            </article>
          ))}
        </>
      )}
      {tab === 'runners' && (
        <>
          <label>
            固定输入
            <select value={selectedInput} onChange={(e) => setSelectedInput(e.target.value)}>
              <option value="">请选择输入快照</option>
              {inputRows.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.definition.name} · {value.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {currentInput && <Evidence value={currentInput.definition} title="审阅冻结的命令、矩阵和环境" />}
          <p>
            每个矩阵单元使用新 VM。断网执行需要镜像预装 Python 3 和项目身份工具；联网安装请在捕获前明确选择
            NAT。实际环境证据与执行结果分别记录。
          </p>
          {confirm}
          <button
            disabled={blocked || !selectedInput || !reviewed}
            onClick={() =>
              perform('runners', {
                action: 'start',
                input: { mode: 'build', inputId: selectedInput, reviewed: true },
              })
            }
          >
            启动隔离构建
          </button>
          {runSelect}
          <label>
            局部重跑步骤（逗号分隔；留空重跑完整定义）
            <input value={retrySteps} onChange={(e) => setRetrySteps(e.target.value)} />
          </label>
          <button
            disabled={blocked || !run?.inputId || !reviewed || run?.state !== 'finished'}
            onClick={() =>
              perform('runners', {
                action: 'start',
                input: {
                  mode: 'build',
                  inputId: run!.inputId,
                  reviewed: true,
                  retryOf: run!.id,
                  selectedSteps: retrySteps
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                },
              })
            }
          >
            以原输入创建新尝试
          </button>
          {runRows
            .slice()
            .reverse()
            .map((value) => (
              <article key={value.id}>
                <h4>
                  {value.id.slice(0, 8)} · {label(value.result || value.state)}
                </h4>
                <p>
                  清理：{label(value.cleanup)} · 实际环境：{value.environmentVerified ? '已核验' : '未核验'} ·
                  退出码：{value.exitCode ?? '未知'}
                </p>
                {value.cells.map((cell) => (
                  <details key={cell.id}>
                    <summary>
                      {cell.label} · {label(cell.result || cell.state)} · 清理 {label(cell.cleanup)}
                    </summary>
                    <p>{cell.environmentEvidence}</p>
                    {cell.steps.map((step) => (
                      <div key={step.id}>
                        <strong>
                          {step.id} · {label(step.state)}
                        </strong>
                        <pre>{step.log}</pre>
                      </div>
                    ))}
                    {cell.error && <p role="alert">{cell.error}</p>}
                  </details>
                ))}
                <button
                  disabled={cancellation.busy || value.state === 'finished'}
                  onClick={() =>
                    void cancellation.run((signal) =>
                      act('runners', { action: 'cancel', id: value.id }, signal),
                    )
                  }
                >
                  取消并回收
                </button>
                <button
                  disabled={blocked || value.cleanup === 'verified' || value.state !== 'finished'}
                  onClick={() => perform('runners', { action: 'recover', id: value.id })}
                >
                  核销原资源
                </button>
                <Evidence value={value} />
              </article>
            ))}
        </>
      )}
      {tab === 'reports' && (
        <>
          {candidateControls}
          {runSelect}
          <div className="delivery-grid">
            <label>
              报告清单 ID
              <input
                value={reportManifest}
                onChange={(e) => setReportManifest(e.target.value)}
                list="delivery-report-manifests"
              />
              <datalist id="delivery-report-manifests">
                {run?.reportManifestIds.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </datalist>
            </label>
            <label>
              报告路径
              <input value={reportPath} onChange={(e) => setReportPath(e.target.value)} />
            </label>
            <label>
              报告格式
              <select value={reportFormat} onChange={(e) => setReportFormat(e.target.value)}>
                {['junit', 'istanbul', 'lcov', 'coverage-py', 'diagnostics', 'benchmark'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            disabled={blocked || !candidate || !selectedRun || !reportManifest}
            onClick={() =>
              perform('reports', {
                action: 'ingest',
                candidate,
                runId: selectedRun,
                manifestId: reportManifest,
                path: reportPath,
                format: reportFormat,
              })
            }
          >
            解析并绑定报告
          </button>
          {repairEnabled && onDevelopmentNavigate && (
            <label>
              修复目标文件（相对源项目目录）
              <input
                value={repairTarget}
                onChange={(event) => setRepairTarget(event.target.value)}
                placeholder="src/example.py"
              />
              <span>修复后重新捕获输入并执行；原候选和证据保留。</span>
            </label>
          )}
          {reportRows.map((value) => (
            <article key={value.id}>
              <h4>
                {value.path} · {label(value.status)}
              </h4>
              <p>
                测试 {value.tests} · 失败 {value.failures} · 跳过 {value.skipped} · 覆盖率{' '}
                {value.coverage === null ? '无' : `${value.coverage}%`}
              </p>
              <p>{value.detail}</p>
              {value.diagnostics.map((item, i) => (
                <p key={i}>
                  {item.severity}：{item.message}
                </p>
              ))}
              <Evidence value={value} />
              {repairEnabled && onDevelopmentNavigate && value.status !== 'passed' && (
                <button
                  disabled={
                    blocked || vm.status !== 'running' || !deliveryPathSchema.safeParse(repairTarget).success
                  }
                  onClick={() =>
                    onDevelopmentNavigate('repair', {
                      target: repairTarget,
                      instruction:
                        `请根据交付报告修复所选文件。报告状态：${value.status}；${value.detail}\n${value.diagnostics.map((item) => item.message).join('\n')}`.slice(
                          0,
                          4000,
                        ),
                    })
                  }
                >
                  打开 AI 修复草稿
                </button>
              )}
            </article>
          ))}
          <div className="delivery-grid">
            {[
              ['基准报告', leftReport, setLeftReport],
              ['比较报告', rightReport, setRightReport],
            ].map(([name, value, setter]) => (
              <label key={String(name)}>
                {String(name)}
                <select
                  value={value as string}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                >
                  <option value="">请选择</option>
                  {reportRows
                    .filter((x) => x.benchmark)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.id.slice(0, 8)} · {row.path}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <button
            disabled={blocked || !leftReport || !rightReport}
            onClick={() =>
              perform('reports', { action: 'compare', leftId: leftReport, rightId: rightReport })
            }
          >
            比较可比基准
          </button>
        </>
      )}
      {tab === 'gates' && (
        <>
          {candidateControls}
          {runSelect}
          <details>
            <summary>规则编辑器</summary>
            <p>
              构建使用 build，接收验证使用 import-acceptance。修改规则会创建新修订；expectedRevision
              填当前同类规则版本。
            </p>
            <textarea
              rows={13}
              aria-label="交付规则 JSON"
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
            />
            <button
              disabled={blocked}
              onClick={() =>
                void action.run((signal) =>
                  act(
                    'gates',
                    { action: 'policy', input: deliveryPolicyInputSchema.parse(JSON.parse(policyText)) },
                    signal,
                  ),
                )
              }
            >
              保存新规则修订
            </button>
          </details>
          <label>
            使用规则
            <select
              value={policyId}
              onChange={(e) => {
                setPolicyId(e.target.value);
                setReviewed(false);
              }}
            >
              <option value="">请选择</option>
              {gateState?.policies.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.kind} · r{value.revision} · {value.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          {reportRows
            .filter((value) => value.candidateDigest === candidate?.digest)
            .map((value) => (
              <label className="delivery-check" key={value.id}>
                <input
                  type="checkbox"
                  checked={evidenceIds.includes(value.id)}
                  onChange={(e) =>
                    setEvidenceIds(
                      e.target.checked
                        ? [...evidenceIds, value.id]
                        : evidenceIds.filter((id) => id !== value.id),
                    )
                  }
                />
                {value.path} · {label(value.status)} · {value.id.slice(0, 8)}
              </label>
            ))}
          <details>
            <summary>填写可豁免规则及原因</summary>
            <p>
              JSON 数组：[{`{"rule":"tests","reason":"至少十字的人工审阅原因"}`}
              ]。完整性、身份、未知结果和清理问题不可豁免。
            </p>
            <textarea
              aria-label="规则豁免"
              rows={3}
              value={waivers}
              onChange={(e) => setWaivers(e.target.value)}
            />
          </details>
          {confirm}
          <button
            disabled={blocked || !candidate || !policyId || !reviewed}
            onClick={() =>
              void action.run((signal) =>
                act(
                  'gates',
                  {
                    action: 'evaluate',
                    input: {
                      candidate,
                      runId: selectedRun || undefined,
                      policyId,
                      evidenceIds,
                      reviewed,
                      waivers: waivers ? JSON.parse(waivers) : [],
                    },
                  },
                  signal,
                ),
              )
            }
          >
            核对并保存判定
          </button>
          {gateState?.decisions
            .slice()
            .reverse()
            .map((value) => (
              <article key={value.id}>
                <h4>
                  {label(value.status)} · {value.id.slice(0, 8)}
                </h4>
                <p>
                  规则 r{value.policyRevision} · 有效至 {new Date(value.expiresAt).toLocaleString()}
                </p>
                <ul>
                  {value.checks.map((check) => (
                    <li key={check.rule}>
                      {label(check.status)} · {check.detail}
                      {check.reason ? ` · 豁免原因：${check.reason}` : ''}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => {
                    setDecisionId(value.id);
                    if (section === 'workbench') setTab('releases');
                  }}
                >
                  选择此判定登记版本
                </button>
                <Evidence value={value} />
              </article>
            ))}
        </>
      )}
      {tab === 'artifacts' && (
        <>
          <label>
            上传交付包或文件
            <input
              type="file"
              disabled={blocked}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void action.run(async (signal) => {
                    setResult(
                      await uploadDeliveryFile(request, endpoint('artifacts'), file, signal, setProgress),
                    );
                    await artifactView.reload();
                  });
              }}
            />
          </label>
          {artifactRows
            .slice()
            .reverse()
            .map((value) => (
              <article key={value.id}>
                <h4>
                  {value.label} · {value.kind}
                </h4>
                <p>
                  {value.files.length} 个文件 · {formatBytes(value.files.reduce((n, f) => n + f.bytes, 0))}
                </p>
                <code>{value.digest}</code>
                <button
                  disabled={blocked}
                  onClick={() => perform('artifacts', { action: 'verify', id: value.id })}
                >
                  重新核验内容
                </button>
                <details>
                  <summary>文件与下载</summary>
                  {value.files.map((file) => (
                    <p key={file.path}>
                      <code>{file.path}</code> · {formatBytes(file.bytes)}{' '}
                      <button
                        disabled={blocked}
                        onClick={() =>
                          void action.run((signal) =>
                            downloadDeliveryFile(request, endpoint('artifacts'), file, value.id, signal),
                          )
                        }
                      >
                        下载
                      </button>
                    </p>
                  ))}
                </details>
                <Evidence value={value} />
              </article>
            ))}
          <button
            disabled={blocked}
            onClick={() =>
              void action.run(async (signal) => {
                setCleanup(
                  deliveryCleanupPlanSchema.parse(await act('artifacts', { action: 'cleanup-plan' }, signal)),
                );
              })
            }
          >
            预览无引用内容清理
          </button>
          {cleanup && (
            <article>
              <p>
                可清理 {cleanup.manifests.length} 个清单 · {formatBytes(cleanup.bytes)}；
                {cleanup.protected.length} 个清单受引用保护。
              </p>
              <Evidence value={cleanup} title="核对具体清理对象" />
              <button
                disabled={blocked}
                onClick={() =>
                  void action.run(async (signal) => {
                    await act('artifacts', { action: 'cleanup', token: cleanup.token }, signal);
                    setCleanup(undefined);
                  })
                }
              >
                执行此清理计划
              </button>
            </article>
          )}
        </>
      )}
      {tab === 'previews' && (
        <>
          {candidateControls}
          <label>
            绝对有效期（分钟）
            <input
              type="number"
              min={1}
              max={1440}
              value={lifetime}
              onChange={(e) => setLifetime(Number(e.target.value))}
            />
          </label>
          {candidate && (
            <Evidence
              value={{ environment: candidate.environment, startup: candidate.startup }}
              title="审阅预览启动和联网权限"
            />
          )}
          {confirm}
          <button
            disabled={blocked || !candidate || !reviewed || candidate.startup.kind === 'command'}
            onClick={() =>
              perform('previews', { action: 'start', candidate, lifetimeMinutes: lifetime, reviewed: true })
            }
          >
            启动实际制品预览
          </button>
          <p>
            入口使用独立 localhost 子域；不会携带管理端
            Cookie。暂停和重启不会延长有效期。命令行制品请运行接收验证。
          </p>
          {previewRows
            .slice()
            .reverse()
            .map((value) => (
              <article key={value.id}>
                <h4>
                  {label(value.state)} · {value.id.slice(0, 8)}
                </h4>
                <p>
                  到期：{new Date(value.expiresAt).toLocaleString()} · 清理：{label(value.cleanup)}
                </p>
                {value.url && value.state === 'healthy' && (
                  <a href={value.url} target="_blank" rel="noreferrer noopener">
                    打开独立预览
                  </a>
                )}
                <p>{value.error}</p>
                <button
                  disabled={blocked || ['expired', 'failed', 'stopped'].includes(value.state)}
                  onClick={() => perform('previews', { action: 'health', id: value.id })}
                >
                  刷新健康证据
                </button>
                <button
                  disabled={cancellation.busy || ['expired', 'stopped'].includes(value.state)}
                  onClick={() =>
                    void cancellation.run((signal) =>
                      act('previews', { action: 'stop', id: value.id }, signal),
                    )
                  }
                >
                  停止并关闭入口
                </button>
                <button
                  disabled={blocked || !['failed', 'unknown'].includes(value.cleanup)}
                  onClick={() => perform('previews', { action: 'recover', id: value.id })}
                >
                  核销原资源
                </button>
                <details>
                  <summary>预览日志</summary>
                  <pre>{value.log}</pre>
                </details>
              </article>
            ))}
        </>
      )}
      {tab === 'releases' && (
        <>
          <h4>封存候选</h4>
          {runSelect}
          <label>
            输出清单
            <select value={selectedOutput} onChange={(e) => setSelectedOutput(e.target.value)}>
              <option value="">请选择真实运行输出</option>
              {run?.outputManifestIds.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <button
            disabled={blocked || !run?.inputId || !selectedOutput}
            onClick={() =>
              void action.run(async (signal) => {
                chooseCandidate(
                  deliveryCandidateSchema.parse(
                    await act(
                      'releases',
                      {
                        action: 'candidate',
                        inputId: run!.inputId,
                        runId: run!.id,
                        manifestId: selectedOutput,
                      },
                      signal,
                    ),
                  ),
                );
              })
            }
          >
            创建不可变候选
          </button>
          {candidateControls}
          <h4>登记本地版本</h4>
          <div className="delivery-grid">
            <label>
              项目命名空间
              <input value={namespace} onChange={(e) => setNamespace(e.target.value)} />
            </label>
            <label>
              版本号
              <input value={version} onChange={(e) => setVersion(e.target.value)} />
            </label>
            <label>
              有效判定
              <select value={decisionId} onChange={(e) => setDecisionId(e.target.value)}>
                <option value="">请选择</option>
                {gateState?.decisions
                  .filter((d) => d.candidateDigest === candidate?.digest)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {label(d.status)} · {d.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            交付说明
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button
            disabled={blocked || !candidate || !decisionId}
            onClick={() =>
              perform('releases', {
                action: 'register',
                candidateId: candidate!.id,
                decisionId,
                namespace,
                version,
                notes,
              })
            }
          >
            登记版本
          </button>
          <label>
            选择本地版本
            <select value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>
              <option value="">请选择</option>
              {releaseState?.releases.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.namespace}@{value.version} · {label(value.status)}
                </option>
              ))}
            </select>
          </label>
          <div className="delivery-grid">
            {(['candidate', 'stable'] as const).map((name) => {
              const channel = releaseState?.channels.find((c) => c.name === name);
              return (
                <article key={name}>
                  <h4>
                    {name === 'stable' ? '正式' : '候选'}通道 · r{channel?.revision || 0}
                  </h4>
                  <p>{channel?.releaseId || '未设置'}</p>
                  <button
                    disabled={blocked || !releaseId}
                    onClick={() =>
                      perform('releases', {
                        action: 'channel',
                        name,
                        expectedRevision: channel?.revision || 0,
                        releaseId,
                      })
                    }
                  >
                    晋级 / 回退到所选版本
                  </button>
                  <button
                    disabled={blocked || !channel?.releaseId}
                    onClick={() =>
                      perform('releases', {
                        action: 'channel',
                        name,
                        expectedRevision: channel!.revision,
                        releaseId: null,
                      })
                    }
                  >
                    移除通道指向
                  </button>
                  {channel && <Evidence value={channel.history} title="通道历史" />}
                </article>
              );
            })}
          </div>
          <label>
            撤回 / 归档原因
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            disabled={blocked || !releaseId || reason.length < 5}
            onClick={() =>
              perform('releases', { action: 'status', id: releaseId, status: 'withdrawn', reason })
            }
          >
            撤回所选版本
          </button>
          <button
            disabled={blocked || !releaseId || reason.length < 5}
            onClick={() =>
              perform('releases', { action: 'status', id: releaseId, status: 'archived', reason })
            }
          >
            归档所选版本
          </button>
          <h4>导出交付包</h4>
          <label className="delivery-check">
            <input
              type="checkbox"
              checked={includeSource}
              onChange={(e) => setIncludeSource(e.target.checked)}
            />
            包含源码附件
          </label>
          <label>
            签名私密引用（留空导出未签名包）
            <input value={signingRef} onChange={(e) => setSigningRef(e.target.value)} autoComplete="off" />
          </label>
          <button
            disabled={blocked || !releaseId}
            onClick={() =>
              void action.run(async (signal) => {
                const value = deliveryExportResultSchema.parse(
                  await act(
                    'releases',
                    {
                      action: 'export',
                      id: releaseId,
                      includeSource,
                      signingKeyRef: signingRef || undefined,
                    },
                    signal,
                  ),
                );
                await downloadDeliveryFile(
                  request,
                  endpoint('artifacts'),
                  value.manifest.files[0],
                  value.manifest.id,
                  signal,
                );
              })
            }
          >
            生成并下载 .sakura-delivery.zip
          </button>
          <h4>导入与接收验证</h4>
          <label>
            选择交付包
            <input
              type="file"
              accept=".zip"
              disabled={blocked}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void action.run(async (signal) => {
                    const manifest = await uploadDeliveryFile(
                      request,
                      endpoint('artifacts'),
                      file,
                      signal,
                      setProgress,
                    );
                    await act('releases', { action: 'import', manifestId: manifest.id }, signal);
                  });
              }}
            />
          </label>
          <label>
            明确接收的来源命名空间
            <input value={importNamespace} onChange={(e) => setImportNamespace(e.target.value)} />
          </label>
          <label className="delivery-check">
            <input
              type="checkbox"
              checked={allowUntrusted}
              onChange={(e) => setAllowUntrusted(e.target.checked)}
            />
            允许接收未签名或未知发布者内容，继续隔离验证
          </label>
          {confirm}
          {releaseState?.imports.map((value) => (
            <article key={value.id}>
              <h4>
                {value.namespace}@{value.version} · {label(value.trust)} · {label(value.status)}
              </h4>
              <p>
                来源候选：{value.sourceCandidateId} · 新本地候选：{value.candidate.id}
              </p>
              <button
                disabled={blocked || !reviewed || importNamespace !== value.namespace}
                onClick={() =>
                  perform('releases', {
                    action: 'accept',
                    id: value.id,
                    namespace: importNamespace,
                    allowUntrusted,
                    reviewed: true,
                  })
                }
              >
                确认来源并接收
              </button>
              <button
                disabled={blocked || !reviewed || value.status !== 'accepted'}
                onClick={() =>
                  void action.run(async (signal) => {
                    chooseCandidate(value.candidate);
                    await act(
                      'runners',
                      {
                        action: 'start',
                        input: { mode: 'validate-artifact', candidate: value.candidate, reviewed: true },
                      },
                      signal,
                    );
                  })
                }
              >
                对原制品执行接收验证
              </button>
              <Evidence value={value} />
            </article>
          ))}
          <details>
            <summary>交付发布者公钥与撤销</summary>
            <div className="delivery-grid">
              <label>
                公钥 ID
                <input value={keyId} onChange={(e) => setKeyId(e.target.value)} />
              </label>
              <label>
                发布者
                <input value={publisher} onChange={(e) => setPublisher(e.target.value)} />
              </label>
            </div>
            <label>
              Ed25519 公钥 PEM
              <textarea rows={4} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} />
            </label>
            <button
              disabled={blocked || !keyId || !publisher || !publicKey}
              onClick={() =>
                perform('releases', {
                  action: 'trust',
                  expectedRevision: releaseState?.trustRevision || 0,
                  id: keyId,
                  publisher,
                  publicKey,
                })
              }
            >
              登记交付公钥
            </button>
            {releaseState?.keys.map((key) => (
              <p key={key.id}>
                {key.id} · {key.publisher} · {key.revoked ? '已撤销' : '有效'} <code>{key.fingerprint}</code>
                <button
                  disabled={blocked || key.revoked}
                  onClick={() =>
                    perform('releases', {
                      action: 'trust',
                      expectedRevision: releaseState!.trustRevision,
                      id: key.id,
                      revoke: true,
                    })
                  }
                >
                  撤销
                </button>
              </p>
            ))}
          </details>
          {releaseState?.releases.map((value) => (
            <article key={value.id}>
              <h4>
                {value.namespace}@{value.version} · {label(value.status)}
              </h4>
              <p>{value.notes}</p>
              <code>{value.releaseCoreDigest}</code>
              <Evidence value={value} />
            </article>
          ))}
        </>
      )}
      {result !== undefined && <Evidence value={result} title="最近操作结果" />}
    </div>
  );
}

/** 提供常用字段及严格 JSON 编辑入口；仅保存草稿，不执行命令。
 * Edit common fields or strict JSON as a draft without executing commands. */
function DefinitionEditor({
  value,
  onChange,
}: {
  value: DeliveryDefinition;
  onChange: (value: DeliveryDefinition) => void;
}) {
  const [advanced, setAdvanced] = useState(''),
    [error, setError] = useState('');
  return (
    <>
      <div className="delivery-grid">
        <label>
          定义名称
          <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </label>
        <label>
          源码模式
          <select
            value={value.source.mode}
            onChange={(e) =>
              onChange({ ...value, source: { ...value.source, mode: e.target.value as 'commit' | 'draft' } })
            }
          >
            <option value="commit">固定提交</option>
            <option value="draft">审阅草稿</option>
          </select>
        </label>
        <label>
          Git 引用
          <input
            value={value.source.ref}
            onChange={(e) => onChange({ ...value, source: { ...value.source, ref: e.target.value } })}
          />
        </label>
        <label>
          外网权限
          <select
            value={value.environment.network}
            onChange={(e) =>
              onChange({
                ...value,
                environment: { ...value.environment, network: e.target.value as 'isolated' | 'nat' },
              })
            }
          >
            <option value="isolated">断网</option>
            <option value="nat">明确允许 NAT 联网</option>
          </select>
        </label>
      </div>
      <label>
        源码路径（每行一项；空白为提交中的全部文件）
        <textarea
          rows={2}
          value={value.source.paths.join('\n')}
          onChange={(e) =>
            onChange({
              ...value,
              source: { ...value.source, paths: e.target.value.split('\n').filter(Boolean) },
            })
          }
        />
      </label>
      {value.steps.map((step, index) => (
        <div className="delivery-step" key={index}>
          <label>
            {step.name} · {step.id}
            <textarea
              rows={3}
              value={step.command}
              onChange={(e) =>
                onChange({
                  ...value,
                  steps: value.steps.map((s, i) => (i === index ? { ...s, command: e.target.value } : s)),
                })
              }
            />
          </label>
        </div>
      ))}
      <div className="delivery-grid">
        <label>
          输出路径（每行一项）
          <textarea
            rows={2}
            value={value.outputs.join('\n')}
            onChange={(e) => onChange({ ...value, outputs: e.target.value.split('\n').filter(Boolean) })}
          />
        </label>
        <label>
          预览 / 验证目录
          <input
            value={value.startup.root}
            onChange={(e) => onChange({ ...value, startup: { ...value.startup, root: e.target.value } })}
          />
        </label>
        <label>
          服务或命令行启动命令
          <input
            value={value.startup.command}
            onChange={(e) => onChange({ ...value, startup: { ...value.startup, command: e.target.value } })}
          />
        </label>
      </div>
      <details>
        <summary>编辑环境、矩阵、DAG、报告及启动参数</summary>
        <button
          onClick={() => {
            setAdvanced(pretty(value));
            setError('');
          }}
        >
          载入当前定义
        </button>
        <textarea
          rows={16}
          aria-label="完整定义编辑器"
          value={advanced}
          onChange={(e) => setAdvanced(e.target.value)}
        />
        <button
          disabled={!advanced}
          onClick={() => {
            try {
              onChange(deliveryDefinitionSchema.parse(JSON.parse(advanced)));
              setError('');
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          校验并应用到草稿
        </button>
        {error && <p role="alert">{error}</p>}
      </details>
    </>
  );
}
