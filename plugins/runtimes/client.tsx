import { useState } from 'react';
import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

export function RuntimePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
    selected: { node?: string; python?: string };
    declared: Record<string, string>;
    actual: Record<string, string>;
    mismatches: string[];
    job: JobView | null;
  }>(request, `/vms/${vm.id}/runtimes`, vm.status === 'running', 10000);
  const action = useAction();
  const [tool, setTool] = useState<'node' | 'python'>('node');
  const [version, setVersion] = useState('22.12.0');
  return (
    <>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-card">
        <p>
          项目声明：Node {remote.data?.declared.node || '—'} · Python {remote.data?.declared.python || '—'}
        </p>
        <p>
          当前版本：Node {remote.data?.actual.node || '—'} · Python {remote.data?.actual.python || '—'}
        </p>
        {remote.data?.mismatches.length ? (
          <p className="machine-error">版本不匹配：{remote.data.mismatches.join('、')}</p>
        ) : (
          <p className="feature-success">版本匹配</p>
        )}
      </div>
      <div className="feature-actions">
        <select value={tool} onChange={(e) => setTool(e.target.value as 'node' | 'python')}>
          <option value="node">Node.js</option>
          <option value="python">Python</option>
        </select>
        <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="22.12.0" />
        <button
          className="secondary compact"
          disabled={action.busy}
          onClick={() =>
            void action.run(async (signal) => {
              await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'install', tool, version }, signal);
              remote.reload();
            })
          }
        >
          安装版本
        </button>
        <button
          className="primary compact"
          disabled={action.busy || !remote.data}
          onClick={() =>
            void action.run(async (signal) => {
              await request(
                `/vms/${vm.id}/runtimes`,
                'POST',
                {
                  action: 'select',
                  node: tool === 'node' ? version : remote.data?.selected.node,
                  python: tool === 'python' ? version : remote.data?.selected.python,
                },
                signal,
              );
              remote.reload();
            }, '项目版本已选择')
          }
        >
          应用到项目
        </button>
      </div>
      <JobLog job={remote.data?.job} />
    </>
  );
}

export const developmentSections = { runtimes: RuntimePanel };
