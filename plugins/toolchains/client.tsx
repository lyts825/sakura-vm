/**
 * 模块职责（中文）：“工具安装”插件的客户机开发工具检查与安装分区，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for guest development-tool discovery and installation.
 * 详细范围（中文）：公开入口包括 ToolsPanel, developmentSections；职责覆盖客户机开发工具探测和安装的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ToolsPanel, developmentSections. The scope covers UI interaction and state presentation for guest development-tool discovery and installation. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { stopped } from '../../src/guest-state';

/**
 * 中文：呈现客户机开发工具探测和安装的界面交互与状态呈现中的 ToolsPanel 界面，订阅 /vms/{vm.id}/tools，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the ToolsPanel surface for UI interaction and state presentation for guest development-tool discovery and installation, subscribing to /vms/{vm.id}/tools. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function ToolsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<OperationResponse<'toolchains.legacy.get.vms.vmId.tools'>>(
      request, `/vms/${vm.id}/tools`, vm.status === 'running', 10000),
    action = useAction();
  /**
   * 中文：提交 POST /vms/{vm.id}/tools，完成客户机开发工具探测和安装的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/tools for UI interaction and state presentation for guest development-tool discovery and installation. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：tools：签名所示 string[] 业务值
   * English: Inputs: tools: the string[] domain value in the signature
   */
  const install = (tools: string[]) =>
    action.run(/** 中文：提交 POST /vms/{vm.id}/tools，完成客户机开发工具探测和安装的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/tools for UI interaction and state presentation for guest development-tool discovery and installation. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
