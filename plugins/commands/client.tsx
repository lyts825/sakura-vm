/**
 * 模块职责（中文）：“收藏命令”插件的参数化命令预设、执行表单与任务日志分区，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for project command presets and execution.
 * 详细范围（中文）：公开入口包括 PresetRunner, CommandsPanel, developmentSections；职责覆盖项目命令预设与执行的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PresetRunner, CommandsPanel, developmentSections. The scope covers UI interaction and state presentation for project command presets and execution. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import '../../src/development.css';
import {
  Feedback,
  JobLog,
  useAction,
  useRemote,
  type FeatureProps,
  type Request,
} from '../../src/feature-shared';
import '../../src/features.css';
import { usePlugins } from '../../src/plugin-context';
type CommandsView = OperationResponse<'commands.list'>;
type CommandPreset = CommandsView['presets'][number];
/**
 * 中文：呈现项目命令预设与执行的界面交互与状态呈现中的 PresetRunner 界面，组合 Play，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PresetRunner surface for UI interaction and state presentation for project command presets and execution and composing Play. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  preset,
  id,
  request,
  executed,
} 提供 preset（preset 状态）、id（目标资源标识）、request（带身份和权限作用域的传输能力）、executed（executed 状态） 上下文字段
 * English: Inputs: {
  preset,
  id,
  request,
  executed,
} provides context fields preset (preset state), id (target resource identifier), request (transport capability bound to identity/authority scope), executed (executed state)
 */
export function PresetRunner({
  preset,
  id,
  request,
  executed,
}: {
  preset: CommandPreset;
  id: string;
  request: Request;
  executed?: /** 中文：在预设命令确认后通知父级恢复执行反馈；这是 PresetRunner 的调用契约 | English: Notify the parent to restore execution feedback after preset-command confirmation; this is the callable contract of PresetRunner | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
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
        void action.run(/** 中文：提交 POST /vms/{id}/commands，完成项目命令预设与执行的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{id}/commands for UI interaction and state presentation for project command presets and execution. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
          await request(`/vms/${id}/commands`, 'POST', { id: preset.id, values }, signal);
          signal.throwIfAborted();
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
/**
 * 中文：呈现项目命令预设与执行的界面交互与状态呈现中的 CommandsPanel 界面，订阅 /vms/{vm.id}/commands，组合 Save、PresetRunner，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the CommandsPanel surface for UI interaction and state presentation for project command presets and execution, subscribing to /vms/{vm.id}/commands and composing Save, PresetRunner. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function CommandsPanel({ vm, request }: FeatureProps) {
  const hasPalette = usePlugins().includes('command-palette');
  const remote = useRemote<CommandsView>(
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
  useEffect(/** 中文：当依赖 [remote.data, loadedProject] 变化时loadedProject 状态，当前选择，editing 状态，名称输入，command 状态，parameters 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data, loadedProject] change, loadedProject state, current selection, editing state, name input, command state, parameters state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
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
              void action.run(/** 中文：提交 PUT /vms/{vm.id}/commands，完成项目命令预设与执行的界面交互与状态呈现的数据交互并更新名称输入、command 状态、parameters 状态、editing 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PUT /vms/{vm.id}/commands for UI interaction and state presentation for project command presets and execution and update name input, command state, parameters state, editing state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
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
                signal.throwIfAborted();
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
                  void action.run(/** 中文：提交 DELETE /vms/{vm.id}/commands，完成项目命令预设与执行的界面交互与状态呈现的数据交互并更新当前选择；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform DELETE /vms/{vm.id}/commands for UI interaction and state presentation for project command presets and execution and update current selection. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                    await request(`/vms/${vm.id}/commands`, 'DELETE', { id: preset.id }, signal);
                    signal.throwIfAborted();
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
