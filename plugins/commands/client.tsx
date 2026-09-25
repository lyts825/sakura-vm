import { useEffect, useState } from 'react';
import { Play, Save } from 'lucide-react';
import type { JobView } from '../../server/jobs.ts';
import type { CommandPreset } from '../../server/command-presets.ts';
import { Feedback, JobLog, useAction, useRemote, type FeatureProps, type Request } from '../../src/feature-shared';
import { usePlugins } from '../../src/plugin-context';
import '../../src/development.css';
export function PresetRunner({
  preset,
  id,
  request,
  executed,
}: {
  preset: CommandPreset;
  id: string;
  request: Request;
  executed?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(preset.parameters.map((p) => [p.name, p.value])),
    ),
    action = useAction();
  return (
    <form
      className="feature-card"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async (signal) => {
          await request(`/vms/${id}/commands`, 'POST', { id: preset.id, values }, signal);
          executed?.();
        }, '命令已加入任务中心');
      }}
    >
      <h4>{preset.name}</h4>
      <pre className="feature-log">{preset.command}</pre>
      {preset.parameters.map((parameter) => (
        <label key={parameter.name}>
          {parameter.name}
          <input
            value={values[parameter.name] || ''}
            maxLength={4096}
            onChange={(e) => setValues({ ...values, [parameter.name]: e.target.value })}
          />
        </label>
      ))}
      <button className="primary compact" disabled={action.busy}>
        <Play size={14} />
        执行命令
      </button>
      <Feedback error={action.error} message={action.message} />
    </form>
  );
}
export function CommandsPanel({ vm, request }: FeatureProps) {
  const hasPalette = usePlugins().includes('command-palette');
  const remote = useRemote<{ projectId?: string; presets: CommandPreset[]; job: JobView | null }>(
      request,
      `/vms/${vm.id}/commands`,
      true,
      2500,
    ),
    action = useAction();
  const [name, setName] = useState(''),
    [command, setCommand] = useState(''),
    [parameters, setParameters] = useState(''),
    [selected, setSelected] = useState<CommandPreset | null>(null),
    [editing, setEditing] = useState<string | undefined>(),
    [loadedProject, setLoadedProject] = useState('');
  useEffect(() => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      setSelected(null);
      setEditing(undefined);
      setName('');
      setCommand('');
      setParameters('');
    }
  }, [remote.data, loadedProject]);
  return (
    <>
      <p className="subtle-note">
        {hasPalette && '收藏命令可用 Ctrl / ⌘ + K 快速找到。'}参数以环境变量传入，在命令中使用
        $NAME；执行记录保存在任务中心。
      </p>
      <Feedback error={action.error || remote.error} />
      <div className="feature-card">
        <h4>{editing ? '编辑收藏命令' : '收藏新命令'}</h4>
        <label>
          命令名称
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          命令
          <textarea
            rows={3}
            value={command}
            maxLength={8192}
            onChange={(e) => setCommand(e.target.value)}
            placeholder={'npm run test -- "$TARGET"'}
          />
        </label>
        <label>
          参数默认值（每行 NAME=value）
          <textarea
            rows={2}
            value={parameters}
            onChange={(e) => setParameters(e.target.value)}
            placeholder="TARGET=unit"
          />
        </label>
        <div className="feature-actions">
          <button
            className="primary compact"
            disabled={action.busy || !name.trim() || !command.trim()}
            onClick={() =>
              void action.run(async (signal) => {
                const params = parameters
                  .split('\n')
                  .filter((row) => row.trim())
                  .map((row) => {
                    const index = row.indexOf('=');
                    return {
                      name: (index < 0 ? row : row.slice(0, index)).trim(),
                      value: index < 0 ? '' : row.slice(index + 1),
                    };
                  });
                await request(
                  `/vms/${vm.id}/commands`,
                  'PUT',
                  { id: editing, name, command, parameters: params },
                  signal,
                );
                setName('');
                setCommand('');
                setParameters('');
                setEditing(undefined);
                remote.reload();
              })
            }
          >
            <Save size={14} />
            保存收藏
          </button>
          {editing && (
            <button
              className="text-button"
              onClick={() => {
                setEditing(undefined);
                setName('');
                setCommand('');
                setParameters('');
              }}
            >
              取消编辑
            </button>
          )}
        </div>
      </div>
      {remote.data?.presets.map((preset) => (
        <div className="development-row" key={preset.id}>
          <b>{preset.name}</b>
          <div className="feature-actions">
            <button
              className="text-button"
              disabled={vm.status !== 'running' || remote.data?.job?.status === 'running'}
              onClick={() => setSelected(preset)}
            >
              填写参数并执行
            </button>
            <button
              className="text-button"
              onClick={() => {
                setEditing(preset.id);
                setName(preset.name);
                setCommand(preset.command);
                setParameters(preset.parameters.map((p) => `${p.name}=${p.value}`).join('\n'));
              }}
            >
              编辑
            </button>
            <button
              className="text-button danger-text"
              disabled={action.busy}
              onClick={() => {
                if (confirm(`删除收藏命令 ${preset.name}？`))
                  void action.run(async (signal) => {
                    await request(`/vms/${vm.id}/commands`, 'DELETE', { id: preset.id }, signal);
                    if (selected?.id === preset.id) setSelected(null);
                    remote.reload();
                  });
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      {selected && vm.status === 'running' && (
        <PresetRunner
          key={selected.id + selected.command}
          preset={selected}
          id={vm.id}
          request={request}
          executed={() => {
            setSelected(null);
            remote.reload();
          }}
        />
      )}
      <JobLog job={remote.data?.job} />
    </>
  );
}


export const developmentSections = { commands: CommandsPanel };
