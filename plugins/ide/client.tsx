/**
 * 模块职责（中文）：“IDE 接入”插件的VS Code Remote-SSH 连接配置与项目接入面板，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for project editor connections.
 * 详细范围（中文）：公开入口包括 IdeConnection；职责覆盖项目编辑器连接的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include IdeConnection. The scope covers UI interaction and state presentation for project editor connections. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

/**
 * 中文：呈现项目编辑器连接的界面交互与状态呈现中的 IdeConnection 界面，订阅 /vms/{vm.id}/ide，组合 ExternalLink，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the IdeConnection surface for UI interaction and state presentation for project editor connections, subscribing to /vms/{vm.id}/ide and composing ExternalLink. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function IdeConnection({ vm, request }: FeatureProps) {
  const ide = useRemote<OperationResponse<'ide.legacy.get.vms.vmId.ide'>>(request, `/vms/${vm.id}/ide`);
  const scoped = ide.data && 'projectScoped' in ide.data ? ide.data : null;
  const [link, setLink] = useState('');
  const action = useAction();
  return (
    <>
      <div className="feature-card">
        <h4>{ide.data?.vscodeSupported === false ? '项目 SSH 连接' : '在 VS Code 中开发'}</h4>
        {ide.data?.supported ? (
          <>
            <p className="subtle-note">
              {scoped?.projectScoped
                ? '使用此项目专属的 SSH 服务，编辑器与子进程遵守项目网络设置。停止项目 SSH 会关闭其编辑器和后台进程。'
                : '连接当前项目目录。首次配置会向本机 SSH 配置添加 Sakura 的 Include，并保留原配置备份。'}
            </p>
            {ide.data.vscodeSupported === false && (
              <p className="subtle-note">
                Alpine 可使用普通 SSH、SFTP 和 Neovim。VS Code Remote-SSH 与 JetBrains Gateway 请使用 Debian
                或 Ubuntu。
              </p>
            )}
            {scoped?.networkIsolation === 'private' && ide.data.vscodeSupported !== false && (
              <p className="subtle-note">
                首次连接请在 VS Code 用户设置中使用
                <code>"remote.SSH.localServerDownload": "always"</code>， 并关闭 Remote Server Listen On
                Socket。扩展和项目依赖也需提前准备。
              </p>
            )}
            <button
              className="secondary compact"
              disabled={action.busy || !ide.data.running}
              onClick={() =>
                void action.run(/** 中文：提交 POST /vms/{vm.id}/ide，完成项目编辑器连接的界面交互与状态呈现的数据交互并更新link 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/ide for UI interaction and state presentation for project editor connections and update link state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                  const result = await request<OperationResponse<'ide.legacy.post.vms.vmId.ide'>>(
                    `/vms/${vm.id}/ide`, 'POST', undefined, signal);
                  signal.throwIfAborted();
                  setLink(result.url);
                  await ide.reload();
                }, 'SSH 连接配置已更新')
              }
            >
              <ExternalLink size={14} />
              {ide.data.vscodeSupported === false ? '配置项目 SSH' : '配置 VS Code 连接'}
            </button>
            {scoped?.projectScoped && scoped.runtime.running && (
              <button
                className="text-button"
                disabled={action.busy || !ide.data.running}
                onClick={() => {
                  if (confirm('停止此项目的 SSH、编辑器及其后台进程？'))
                    void action.run(/** 中文：提交 POST /vms/{vm.id}/ide，完成项目编辑器连接的界面交互与状态呈现的数据交互并更新link 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/ide for UI interaction and state presentation for project editor connections and update link state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                      await request(`/vms/${vm.id}/ide`, 'POST', { action: 'stop' }, signal);
                      signal.throwIfAborted();
                      setLink('');
                      await ide.reload();
                    }, '项目 SSH 已停止');
                }}
              >
                停止项目 SSH
              </button>
            )}
            {scoped?.runtime.reason && <p className="subtle-note">{scoped.runtime.reason}</p>}
            {(scoped?.projectScoped ? ide.data.url : link) && (
              <a className="primary compact" href={scoped?.projectScoped ? ide.data.url : link}>
                打开 VS Code
              </a>
            )}
            <p className="muted">也可以在 PowerShell 中运行：</p>
            {ide.data.command && <code className="wrap-code">{ide.data.command}</code>}
            {scoped?.sshCommand && <code className="wrap-code">{scoped.sshCommand}</code>}
          </>
        ) : (
          <p className="muted">
            Remote-SSH 接入支持 Debian 与 Ubuntu。Alpine 可继续使用网页终端和文件编辑器。
          </p>
        )}
      </div>
      <Feedback error={action.error || ide.error} message={action.message} />
    </>
  );
}
