/**
 * 模块职责（中文）：启动客户机并等待已有安装任务结束，再保存项目配置和提交所选操作；等待期间支持取消与超时。
 * Module responsibility (English): Starting VMs and submitting project operations after existing installation work ends.
 * 详细范围（中文）：公开入口包括 ProjectAction, executeProjectAction；职责覆盖启动实例并等待已有安装结束后提交项目操作，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ProjectAction, executeProjectAction. The scope covers Starting VMs and submitting project operations after existing installation work ends. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { JobView } from '../shared/contracts/jobs.ts';
import type { VMView } from '../shared/contracts/vm.ts';
import type { Project } from '../server/project-config.ts';
import type { Request } from './feature-shared';

export type ProjectAction = 'setup' | 'start' | 'stop' | 'terminal';

/**
 * 中文：在给定取消寿命内等待指定毫秒，提前取消清除计时器并拒绝；正常完成移除取消监听，供安装状态轮询等待。
 * English: Wait the supplied milliseconds within cancellation lifetime. Cancellation clears the timer/rejects; normal completion removes the abort listener for installation-status polling.
 * 中文：输入：ms：签名所示 number 业务值；signal：本次调用的取消寿命
 * English: Inputs: ms: the number domain value in the signature; signal: cancellation lifetime for this invocation
 * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
 * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
 */
function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>(/** 中文：在启动实例并等待已有安装结束后提交项目操作流程中timeout 状态，登记浏览器或资源事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Starting VMs and submitting project operations after existing installation work ends, timeout state, register browser/resource event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：输入：resolve：此处理器的调用值；reject：此处理器的调用值 | English: Inputs: resolve: the invocation value for this handler; reject: the invocation value for this handler | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ (resolve, reject) => {
    /**
     * 中文：在启动实例并等待已有安装结束后提交项目操作流程中取消延迟计时任务，拒绝当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Starting VMs and submitting project operations after existing installation work ends, cancel delayed timers, reject the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(/** 中文：在启动实例并等待已有安装结束后提交项目操作流程中移除登记的事件监听，兑现当前异步等待；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Starting VMs and submitting project operations after existing installation work ends, remove registered event listeners, fulfill the current asynchronous wait. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/**
 * 中文：先启动客户机并在 5 分钟内等待 running，再等待已有安装任务最多 20 分钟；除 stop 外保存捕获的项目配置，随后提交动作。每个等待和新写入前复核取消，界面离开后不会继续启动任务。
 * English: Start the guest and wait up to five minutes for running, then wait up to twenty minutes for existing installation work. Save the captured project configuration except for stop, then submit the action. Check cancellation during waits and before new writes so departed surfaces cannot start more work.
 * 中文：输入：{
  request,
  vm,
  project,
  kind,
  refresh,
  signal,
} 提供 request（带身份和权限作用域的传输能力）、vm（vm 状态）、project（project 状态）、kind（kind 状态）、refresh（refresh 状态）、signal（本次调用的取消寿命） 上下文字段
 * English: Inputs: {
  request,
  vm,
  project,
  kind,
  refresh,
  signal,
} provides context fields request (transport capability bound to identity/authority scope), vm (vm state), project (project state), kind (kind state), refresh (refresh state), signal (cancellation lifetime for this invocation)
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 * 中文：拒绝原因：启动超时；请等待当前安装结束。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 启动超时; 请等待当前安装结束. These errors reach the direct caller or this function's catch handler
 * 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作
 * English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step
 */
export async function executeProjectAction({
  request,
  vm,
  project,
  kind,
  refresh,
  signal,
}: {
  request: Request;
  vm: VMView;
  project: Project;
  kind: ProjectAction;
  refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 executeProjectAction 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of executeProjectAction | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
  signal: AbortSignal;
}) {
  signal.throwIfAborted();
  if (vm.status !== 'running') await request(`/vms/${vm.id}/start`, 'POST', undefined, signal);
  const bootDeadline = Date.now() + 300000;
  while (true) {
    signal.throwIfAborted();
    if (Date.now() >= bootDeadline) throw new Error('启动超时');
    const state = await request<VMView>(`/vms/${vm.id}`, 'GET', undefined, signal);
    signal.throwIfAborted();
    if (state.status === 'running') break;
    if (['stopped', 'error', 'stopping'].includes(state.status))
      throw new Error(state.lastError || '启动未完成');
    await pause(1000, signal);
  }
  await refresh();
  const installDeadline = Date.now() + 1200000;
  while (true) {
    signal.throwIfAborted();
    const state = await request<{ job: JobView | null }>(`/vms/${vm.id}/project`, 'GET', undefined, signal);
    signal.throwIfAborted();
    if (state.job?.status !== 'running') break;
    if (Date.now() >= installDeadline) throw new Error('请等待当前安装结束');
    await pause(2000, signal);
  }
  // A boot or installation may finish after the panel has gone away. Never
  // submit that panel's old configuration or start a new job after cancellation.
  if (kind !== 'stop') await request(`/vms/${vm.id}/project`, 'PUT', project, signal);
  signal.throwIfAborted();
  await request(`/vms/${vm.id}/project`, 'POST', { action: kind }, signal);
}
