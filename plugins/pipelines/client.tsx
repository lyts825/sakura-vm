/**
 * 模块职责（中文）：“项目流水线”插件的构建流水线步骤、运行记录与产物下载分区，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for project build steps, runs and artifacts.
 * 详细范围（中文）：公开入口包括 PipelinePanel, developmentSections；职责覆盖项目构建步骤、记录与产物的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PipelinePanel, developmentSections. The scope covers UI interaction and state presentation for project build steps, runs and artifacts. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from '../../src/localization';
import { Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

/**
 * 中文：呈现项目构建步骤、记录与产物的界面交互与状态呈现中的 PipelinePanel 界面，订阅 /vms/{vm.id}/pipelines，组合 Save，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PipelinePanel surface for UI interaction and state presentation for project build steps, runs and artifacts, subscribing to /vms/{vm.id}/pipelines and composing Save. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function PipelinePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<OperationResponse<'pipelines.legacy.get.vms.vmId.pipelines'>>(
    request, `/vms/${vm.id}/pipelines`, vm.status === 'running', 3000);
  const action = useAction();
  const [name, setName] = useState('检查与构建');
  const [command, setCommand] = useState('npm test && npm run build');
  const [artifact, setArtifact] = useState('dist');
  const [loadedProject, setLoadedProject] = useState('');
  useEffect(/** 中文：当依赖 [remote.data, loadedProject] 变化时loadedProject 状态，名称输入，command 状态，artifact 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data, loadedProject] change, loadedProject state, name input, command state, artifact state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    const projectId = remote.data?.projectId || 'default';
    if (remote.data && projectId !== loadedProject) {
      setLoadedProject(projectId);
      setName('检查与构建');
      setCommand('npm test && npm run build');
      setArtifact('dist');
    }
  }, [remote.data, loadedProject]);
  /**
   * 中文：提交 PUT /vms/{vm.id}/pipelines，完成项目构建步骤、记录与产物的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform PUT /vms/{vm.id}/pipelines for UI interaction and state presentation for project build steps, runs and artifacts. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const save = () =>
    void action.run(/** 中文：提交 PUT /vms/{vm.id}/pipelines，完成项目构建步骤、记录与产物的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PUT /vms/{vm.id}/pipelines for UI interaction and state presentation for project build steps, runs and artifacts. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
              void action.run(/** 中文：提交 POST /vms/{vm.id}/pipelines，完成项目构建步骤、记录与产物的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/pipelines for UI interaction and state presentation for project build steps, runs and artifacts. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
          {run.steps.map((step) => (
            <div className="development-row" key={step.name}>
              <span>
                {step.name} · {step.status}
              </span>
              <pre className="feature-log">{step.log}</pre>
            </div>
          ))}
          <div className="feature-actions">
            {run.artifacts.map((a) => (
              <button
                className="text-button"
                key={a.index}
                onClick={() =>
                  void action.run(/** 中文：提交 POST /vms/{vm.id}/pipeline-artifact，完成项目构建步骤、记录与产物的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/pipeline-artifact for UI interaction and state presentation for project build steps, runs and artifacts. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                    const { url } = await request<OperationResponse<'pipelines.legacy.post.vms.vmId.pipeline-artifact'>>(
                      `/vms/${vm.id}/pipeline-artifact`,
                      'POST',
                      { runId: run.id, index: a.index },
                      signal,
                    );
                    signal.throwIfAborted();
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
