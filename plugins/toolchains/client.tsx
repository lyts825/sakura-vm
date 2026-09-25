import type { JobView } from '../../server/jobs';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';

export function ToolsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{
      tools: { id: string; name: string; installed: boolean; version: string; required: boolean }[];
      job: JobView | null;
    }>(request, `/vms/${vm.id}/tools`, vm.status === 'running', 10000),
    action = useAction();
  const install = (tools: string[]) =>
    action.run(async (signal) => {
      await request(`/vms/${vm.id}/tools`, 'POST', { tools }, signal);
      remote.reload();
    });
  return (
    <>
      <Feedback error={action.error || remote.error} />
      {vm.status !== 'running' && stopped}
      <div className="feature-grid">
        {remote.data?.tools.map((tool) => (
          <div className="feature-card" key={tool.id}>
            <h4>{tool.name}</h4>
            <p className="subtle-note">
              {tool.required ? '项目需要 · ' : ''}
              {tool.installed ? '已安装' : '未安装'}
            </p>
            <pre className="tool-version">{tool.version || '—'}</pre>
            <button
              className="secondary compact"
              disabled={action.busy || remote.data?.job?.status === 'running'}
              onClick={() => void install([tool.id])}
            >
              {tool.installed ? '安装 / 更新' : '安装'}
            </button>
          </div>
        ))}
      </div>
      <p className="subtle-note">
        使用当前发行版的软件源安装；项目需求根据 package.json、go.mod 等文件识别。
      </p>
      <JobLog job={remote.data?.job} />
    </>
  );
}

export const developmentSections = { tools: ToolsPanel };
