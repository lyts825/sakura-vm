/**
 * 模块职责（中文）：“运行时版本”插件的项目语言运行时选择、安装与状态分区，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for project runtime version selection and installation.
 * 详细范围（中文）：公开入口包括 RuntimePanel, developmentSections；职责覆盖项目运行时版本选择和安装的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include RuntimePanel, developmentSections. The scope covers UI interaction and state presentation for project runtime version selection and installation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import { formatDateTime } from '../../src/localization';
import '../../src/features.css';

type RuntimeView = OperationResponse<'runtimes.legacy.get.vms.vmId.runtimes'>;

/**
 * 中文：呈现项目运行时版本选择和安装的界面交互与状态呈现中的 RuntimePanel 界面，订阅 /vms/{vm.id}/runtimes，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RuntimePanel surface for UI interaction and state presentation for project runtime version selection and installation, subscribing to /vms/{vm.id}/runtimes. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function RuntimePanel({ vm, request }: FeatureProps) {
  const remote = useRemote<RuntimeView>(request, `/vms/${vm.id}/runtimes`, vm.status === 'running', 10000);
  const action = useAction();
  const [tool, setTool] = useState<'node' | 'python'>('node');
  const [version, setVersion] = useState('22.12.0');
  const probeState = remote.data?.probe?.state || 'unprobed';
  const probeBusy = probeState === 'running';
  const runtimeBusy = probeBusy || remote.data?.job?.status === 'running';
  const hasRequirements = Boolean(remote.data &&
    (Object.values(remote.data.selected).some(Boolean) || Object.values(remote.data.declared).some(Boolean)));
  return (
    <>
      <Feedback error={action.error || remote.error} message={action.message} />
      <div className="feature-card">
        <p>
          项目选择：Node {remote.data?.selected.node || '未指定'} · Python{' '}
          {remote.data?.selected.python || '未指定'}
        </p>
        <p>
          最近探测声明：Node {remote.data?.declared.node || '—'} · Python{' '}
          {remote.data?.declared.python || '—'}
        </p>
        <p>
          最近探测版本：Node {remote.data?.actual.node || '—'} · Python{' '}
          {remote.data?.actual.python || '—'}
        </p>
        {remote.data?.probe?.checkedAt && (
          <p className="subtle-note">
            采样时间：{formatDateTime(new Date(remote.data.probe.checkedAt))}
          </p>
        )}
        {probeState === 'unprobed' && <p>尚未探测，请点击“探测项目版本”。</p>}
        {probeBusy && <p role="status">正在探测项目版本…</p>}
        {probeState === 'stale' && <p>最近采样已过期，请重新探测。</p>}
        {probeState === 'failed' && <p className="machine-error">上次探测未完成，请重试。</p>}
        {probeState === 'cached' && (remote.data?.mismatches.length ? (
          <p className="machine-error">最近探测版本不匹配：{remote.data.mismatches.join('、')}</p>
        ) : hasRequirements ? <p className="feature-success">最近探测版本匹配</p> :
          <p>最近探测未发现版本要求。</p>)}
        <p className="subtle-note">面板刷新只读取最近采样；项目文件或环境变化后需重新探测。</p>
        <button
          className="secondary compact"
          disabled={action.busy || runtimeBusy || !remote.data}
          onClick={() => void action.run(/** 中文：提交 POST /vms/{vm.id}/runtimes，完成项目运行时版本选择和安装的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/runtimes for UI interaction and state presentation for project runtime version selection and installation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
            try {
              await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'probe' }, signal);
            } finally { remote.reload(); }
          }, '项目运行时已探测')}
        >
          探测项目版本
        </button>
      </div>
      <div className="feature-actions">
        <select value={tool} onChange={(e) => setTool(e.target.value as 'node' | 'python')}>
          <option value="node">Node.js</option>
          <option value="python">Python</option>
        </select>
        <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="22.12.0" />
        <button
          className="secondary compact"
          disabled={action.busy || runtimeBusy}
          onClick={() =>
            void action.run(/** 中文：提交 POST /vms/{vm.id}/runtimes，完成项目运行时版本选择和安装的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/runtimes for UI interaction and state presentation for project runtime version selection and installation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
              await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'install', tool, version }, signal);
              remote.reload();
            })
          }
        >
          安装版本
        </button>
        <button
          className="primary compact"
          disabled={action.busy || runtimeBusy || !remote.data}
          onClick={() =>
            void action.run(/** 中文：提交 POST /vms/{vm.id}/runtimes，完成项目运行时版本选择和安装的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/runtimes for UI interaction and state presentation for project runtime version selection and installation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
              try {
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
              } finally { remote.reload(); }
            }, '项目版本已选择')
          }
        >
          应用到项目
        </button>
        <button
          className="secondary compact"
          disabled={action.busy || runtimeBusy || !remote.data || !Object.values(remote.data.selected).some(Boolean)}
          onClick={() => void action.run(/** 中文：提交 POST /vms/{vm.id}/runtimes，完成项目运行时版本选择和安装的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/runtimes for UI interaction and state presentation for project runtime version selection and installation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (signal) => {
            try { await request(`/vms/${vm.id}/runtimes`, 'POST', { action: 'select' }, signal); }
            finally { remote.reload(); }
          }, '已清除项目版本选择')}
        >
          清除版本选择
        </button>
      </div>
      <JobLog job={remote.data?.job} />
    </>
  );
}

export const developmentSections = { runtimes: RuntimePanel };
