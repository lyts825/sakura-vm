import { formatDateTime } from '../../src/localization';
import { Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

export function PipelinePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
    projectId?: string;
    pipelines: {
      id: string;
      name: string;
      steps: { name: string; command: string }[];
      artifacts: string[];
    }[];
    runs: any[];
    job: JobView | null;
  }>(request, `/vms/${vm.id}/pipelines`, vm.status === 'running', 3000);
  const action = useAction();
  const [name, setName] = useState('检查与构建');
  const [command, setCommand] = useState('npm test && npm run build');
  const [artifact, setArtifact] = useState('dist');
  const [loadedProject, setLoadedProject] = useState('');
  useEffect(() => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      setName('检查与构建');
      setCommand('npm test && npm run build');
      setArtifact('dist');
    }
  }, [remote.data, loadedProject]);
  const save = () =>
    void action.run(async (signal) => {
      await request(
        `/vms/${vm.id}/pipelines`,
        'PUT',
        {
          name,
          steps: [{ name: '检查与构建', command, timeout: 600 }],
          artifacts: artifact ? [artifact] : [],
        },
        signal,
      );
      remote.reload();
    }, '流水线已保存');
  return (
    <>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-grid">
        <label>
          流水线名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          产物路径（相对项目目录）
          <input value={artifact} onChange={(e) => setArtifact(e.target.value)} placeholder="dist" />
        </label>
      </div>
      <label>
        步骤命令
        <textarea rows={3} value={command} onChange={(e) => setCommand(e.target.value)} />
      </label>
      <div className="feature-actions">
        <button className="secondary compact" disabled={action.busy} onClick={save}>
          <Save size={14} />
          保存流水线
        </button>
        {remote.data?.pipelines.map((p) => (
          <button
            className="primary compact"
            disabled={action.busy}
            key={p.id}
            onClick={() =>
              void action.run(async (signal) => {
                await request(`/vms/${vm.id}/pipelines`, 'POST', { action: 'run', pipelineId: p.id }, signal);
                remote.reload();
              })
            }
          >
            <Play size={14} />
            运行 {p.name}
          </button>
        ))}
      </div>
      <JobLog job={remote.data?.job} />
      {remote.data?.runs.map((run) => (
        <details className="feature-card" key={run.id}>
          <summary>
            {run.name} · {run.status} · {formatDateTime(new Date(run.startedAt))}
          </summary>
          {run.steps.map((step: any) => (
            <div className="development-row" key={step.name}>
              <span>
                {step.name} · {step.status}
              </span>
              <pre className="feature-log">{step.log}</pre>
            </div>
          ))}
          <div className="feature-actions">
            {run.artifacts.map((a: any) => (
              <button
                className="text-button"
                key={a.index}
                onClick={() =>
                  void action.run(async (signal) => {
                    const { url } = await request(
                      `/vms/${vm.id}/pipeline-artifact`,
                      'POST',
                      { runId: run.id, index: a.index },
                      signal,
                    );
                    window.open(url, '_blank', 'noopener,noreferrer');
                  })
                }
              >
                下载 {a.name}
              </button>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

export const developmentSections = { pipelines: PipelinePanel };
