/** 项目流水线编辑、依赖预览及受控重跑。 Pipeline editing, dependency preview and explicit reruns. */
import { formatDateTime } from '../../src/localization';
import { Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import type { pipelinesGetVmsVmIdPipelinesResponseSchema } from '../../shared/contracts/plugin-route-responses';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/development.css';
import '../../src/features.css';

type View = z.infer<typeof pipelinesGetVmsVmIdPipelinesResponseSchema>;
type DraftStep = { id: string; name: string; command: string; timeout: number; dependencies: string; rerunnable: boolean };
const firstStep = (): DraftStep => ({ id: 'check', name: '检查与构建', command: 'npm test && npm run build', timeout: 600, dependencies: '', rerunnable: false });

/** 用有向边展示已保存的依赖；文字列表提供同等信息。 Render saved edges with an equivalent text list. */
function DependencyGraph({ pipeline }: { pipeline: View['pipelines'][number] }) {
  const nodes = pipeline.steps.map((step, index) => ({ id: step.id || `step-${index + 1}`, name: step.name,
    deps: step.dependsOn ?? (index ? [pipeline.steps[index - 1].id || `step-${index}`] : []) }));
  const depth = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    const node = nodes.find(node => node.id === id);
    if (!node?.deps.length) return 0;
    return 1 + Math.max(...node.deps.map(parent => depth(parent, new Set([...seen, id]))));
  };
  const levels = nodes.map(node => depth(node.id)), maximum = Math.max(1, ...levels);
  const positions = nodes.map((node, index) => ({ ...node, x: 100 + levels[index] / maximum * 580, y: 32 + index * 56 }));
  const marker = `pipeline-arrow-${pipeline.id}`;
  return <div style={{ overflowX: 'auto' }}>
    <svg role="img" aria-label={`${pipeline.name} 的步骤依赖图`} viewBox={`0 0 800 ${positions.length * 56 + 8}`} style={{ width: '100%', minWidth: 480, maxWidth: 800 }}>
      <defs><marker id={marker} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      {positions.flatMap(node => node.deps.map(id => {
        const from = positions.find(parent => parent.id === id);
        return from ? <path key={`${id}-${node.id}`} d={`M ${from.x + 70} ${from.y} C ${from.x + 100} ${from.y}, ${node.x - 100} ${node.y}, ${node.x - 74} ${node.y}`} fill="none" stroke="currentColor" opacity={0.5} markerEnd={`url(#${marker})`} /> : null;
      }))}
      {positions.map(node => <g key={node.id}><title>{node.id} · {node.name}</title><rect x={node.x - 70} y={node.y - 18} width={140} height={36} rx={8} fill="var(--bg, #fff)" stroke="currentColor" /><text x={node.x} y={node.y + 5} fill="currentColor" textAnchor="middle" fontSize={12}>{node.id.length > 18 ? `${node.id.slice(0, 16)}…` : node.id}</text></g>)}
    </svg>
  </div>;
}

/** 仅展示已保存定义对应的执行集合；最终选择及指纹由服务端再校验。
 * Preview the saved graph's execution set; the server rechecks selection and fingerprints. */
function selectedClosure(pipeline: View['pipelines'][number], chosen: string[]) {
  const nodes = pipeline.steps.map((step, index) => ({ id: step.id || `step-${index + 1}`,
    deps: step.dependsOn ?? (index ? [pipeline.steps[index - 1].id || `step-${index}`] : []) }));
  const selected = new Set(chosen);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (!selected.has(node.id) && node.deps.some(id => selected.has(id))) {
      selected.add(node.id); changed = true;
    }
  }
  changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (selected.has(node.id)) for (const id of node.deps) if (!selected.has(id)) {
      selected.add(id); changed = true;
    }
  }
  return nodes.filter(node => selected.has(node.id)).map(node => node.id);
}

/** 编辑多步骤依赖并显示真实运行记录。 Edit DAG steps and display actual run records. */
export function PipelinePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<View>(request, `/vms/${vm.id}/pipelines`, vm.status === 'running', 3000);
  const action = useAction();
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState('检查与构建');
  const [steps, setSteps] = useState<DraftStep[]>([firstStep()]);
  const [artifacts, setArtifacts] = useState('');
  const [inputs, setInputs] = useState('');
  const [concurrency, setConcurrency] = useState(1);
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const busy = action.busy || remote.data?.job?.status === 'running';
  const reset = () => { setEditing(undefined); setName('检查与构建'); setSteps([firstStep()]); setArtifacts(''); setInputs(''); setConcurrency(1); };
  useEffect(() => { reset(); setSelection({}); }, [remote.data?.projectId]);
  const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
  const patch = (index: number, value: Partial<DraftStep>) => setSteps(steps.map((step, i) => i === index ? { ...step, ...value } : step));
  const save = () => void action.run(async signal => {
    await request(`/vms/${vm.id}/pipelines`, 'PUT', {
      ...(editing ? { id: editing } : {}), name, maxConcurrency: concurrency, inputs: lines(inputs), artifacts: lines(artifacts),
      steps: steps.map(({ dependencies, ...step }) => ({ ...step, dependsOn: dependencies.split(',').map(id => id.trim()).filter(Boolean) })),
    }, signal);
    remote.reload();
  }, '流水线已保存');
  const load = (pipeline: View['pipelines'][number]) => {
    setEditing(pipeline.id); setName(pipeline.name); setConcurrency(pipeline.maxConcurrency || 1);
    setArtifacts(pipeline.artifacts.join('\n')); setInputs((pipeline.inputs || []).join('\n'));
    setSteps(pipeline.steps.map((step, index) => ({ ...step, id: step.id || `step-${index + 1}`, rerunnable: step.rerunnable || false,
      dependencies: (step.dependsOn ?? (index ? [pipeline.steps[index - 1].id || `step-${index}`] : [])).join(', ') })));
  };
  return <>
    <Feedback error={action.error || remote.error} message={action.message} />
    <div className="feature-grid">
      <label>流水线名称<input value={name} onChange={event => setName(event.target.value)} /></label>
      <label>最大并发步骤<input type="number" min={1} max={4} value={concurrency} onChange={event => setConcurrency(Number(event.target.value))} /></label>
      <label>输入文件（每行一个相对路径，用于重跑指纹）<textarea value={inputs} onChange={event => setInputs(event.target.value)} /></label>
      <label>产物文件（每行一个相对路径）<textarea value={artifacts} onChange={event => setArtifacts(event.target.value)} /></label>
    </div>
    {steps.map((step, index) => <fieldset className="feature-card" key={index}>
      <legend>步骤 {index + 1}</legend>
      <div className="feature-grid">
        <label>标识<input value={step.id} onChange={event => patch(index, { id: event.target.value })} /></label>
        <label>名称<input value={step.name} onChange={event => patch(index, { name: event.target.value })} /></label>
        <label>依赖标识（逗号分隔，留空可独立执行）<input value={step.dependencies} onChange={event => patch(index, { dependencies: event.target.value })} /></label>
        <label>超时（秒）<input type="number" min={1} max={3600} value={step.timeout} onChange={event => patch(index, { timeout: Number(event.target.value) })} /></label>
      </div>
      <label>命令<textarea value={step.command} onChange={event => patch(index, { command: event.target.value })} /></label>
      <label><input type="checkbox" checked={step.rerunnable} onChange={event => patch(index, { rerunnable: event.target.checked })} />已确认此步骤可重复执行，且没有部署、迁移等外部副作用</label>
      <button className="text-button" disabled={steps.length === 1 || busy} onClick={() => setSteps(steps.filter((_, i) => i !== index))}>移除步骤</button>
    </fieldset>)}
    <div className="feature-actions">
      <button className="secondary compact" disabled={steps.length >= 20 || busy} onClick={() => setSteps([...steps, { ...firstStep(), id: `step-${steps.length + 1}`, name: '新步骤', command: '', dependencies: steps.at(-1)!.id }])}>添加步骤</button>
      <button className="secondary compact" disabled={busy} onClick={save}><Save size={14} />{editing ? '更新流水线' : '保存流水线'}</button>
      <button className="text-button" disabled={busy} onClick={reset}>新建流水线</button>
    </div>
    {remote.data?.pipelines.map(pipeline => <div className="feature-card" key={pipeline.id}>
      <strong>{pipeline.name}</strong>
      <p>并发上限：{pipeline.maxConcurrency || 1}</p>
      <DependencyGraph pipeline={pipeline} />
      <ul aria-label="步骤依赖关系">{pipeline.steps.map((step, index) => <li key={step.id || index}>
        {(step.dependsOn ?? (index ? [pipeline.steps[index - 1].id || `step-${index}`] : [])).join(' + ') || '起点'} → {step.id || `step-${index + 1}`} · {step.name}
      </li>)}</ul>
      <div className="feature-actions">
        <button className="secondary compact" disabled={busy} onClick={() => load(pipeline)}>编辑</button>
        <button className="primary compact" disabled={busy} onClick={() => void action.run(async signal => {
          await request(`/vms/${vm.id}/pipelines`, 'POST', { action: 'run', pipelineId: pipeline.id }, signal); remote.reload();
        })}><Play size={14} />完整运行 {pipeline.name}</button>
      </div>
    </div>)}
    <JobLog job={remote.data?.job} />
    {remote.data?.runs.map(run => {
      const pipeline = remote.data?.pipelines.find(item => item.id === run.pipelineId);
      const chosen = selection[run.id] || [];
      const closure = pipeline ? selectedClosure(pipeline, chosen) : [];
      const safe = !!pipeline && !!run.fingerprint && ['done', 'error'].includes(run.status) && !run.errorCode?.endsWith('_CLEANUP_FAILED') && closure.length > 0 && closure.every(id => {
        const index = pipeline.steps.findIndex((step, i) => (step.id || `step-${i + 1}`) === id);
        const prior = run.steps.find(step => step.id === id);
        return pipeline.steps[index]?.rerunnable && prior && (!prior.startedAt || prior.code !== undefined) && !prior.errorCode?.endsWith('_CLEANUP_FAILED');
      });
      return <details className="feature-card" key={run.id}>
        <summary>{run.name} · {run.status} · {formatDateTime(new Date(run.startedAt))}</summary>
        {run.sourceRunId && <p>局部重跑来源：{run.sourceRunId}。本次仅验证列出的执行集合。</p>}
        {run.error && <p role="alert">{run.error}</p>}
        {run.rerunUnavailable && <p>{run.rerunUnavailable}</p>}
        {run.steps.map((step, index) => <div className="development-row" key={step.id || index}>
          <label><input type="checkbox" disabled={!step.id || busy} checked={chosen.includes(step.id || '')} onChange={event => setSelection({ ...selection, [run.id]: event.target.checked ? [...chosen, step.id!] : chosen.filter(id => id !== step.id) })} />{step.name} · {step.status}{step.blockedReason ? ` · ${step.blockedReason}` : ''}</label>
          <pre className="feature-log">{step.log}</pre>
        </div>)}
        {chosen.length > 0 && <p>本次将重新执行：{closure.join('、')}。包含选中步骤、下游及所需祖先；不复用旧结果，不发布整条流水线的产物。</p>}
        {chosen.length > 0 && !safe && <p>执行集合必须全部声明可重复执行，原结果须已确认且存在指纹。代码、配置和输入会在启动前复核。</p>}
        <div className="feature-actions">
          <button className="secondary compact" disabled={busy || !safe} onClick={() => void action.run(async signal => {
            await request(`/vms/${vm.id}/pipelines`, 'POST', { action: 'rerun', pipelineId: run.pipelineId, sourceRunId: run.id, stepIds: chosen }, signal); remote.reload();
          })}>重跑所选分支及依赖</button>
          {run.artifacts.map(artifact => <button className="text-button" key={artifact.index} onClick={() => void action.run(async signal => {
            const { url } = await request<OperationResponse<'pipelines.legacy.post.vms.vmId.pipeline-artifact'>>(`/vms/${vm.id}/pipeline-artifact`, 'POST', { runId: run.id, index: artifact.index }, signal);
            signal.throwIfAborted(); window.open(url, '_blank', 'noopener,noreferrer');
          })}>下载 {artifact.name}</button>)}
        </div>
      </details>;
    })}
  </>;
}
export const developmentSections = { pipelines: PipelinePanel };
