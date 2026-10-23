/**
 * 模块职责（中文）：插件界面共用的请求类型、远程资源订阅、动作状态与任务反馈组件。
 * Module responsibility (English): Shared resource subscriptions, controlled action state and job feedback.
 * 详细范围（中文）：公开入口包括 Request, FeatureProps, distroName, formatBytes, useRemote, useAction, Feedback, JobLog, download；职责覆盖共享资源订阅、受控动作状态与任务反馈，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include Request, FeatureProps, distroName, formatBytes, useRemote, useAction, Feedback, JobLog, download. The scope covers Shared resource subscriptions, controlled action state and job feedback. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime, formatNumber } from './localization';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VMView } from '../shared/contracts/vm.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import { resourceCache, type ResourceSnapshot } from './resource-cache';
import { jobPresentation } from './job-presentation';
export type Request = /** 中文：声明按路径/操作和请求选项传输数据的能力，返回类型由调用契约决定；取消和错误由实现能力传回 | English: Declare a transport capability accepting paths/operations and request options; the call contract determines result type, with cancellation/errors propagated by the implementation | 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法；body：待按操作契约编码的请求正文；signal：本次调用的取消寿命 | English: Inputs: path: target file/request path; method: request HTTP method; body: request body to encode under the operation contract; signal: cancellation lifetime for this invocation | 中文：结果：Promise<T>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<T>; callers depend on this type contract, with promise rejection representing asynchronous failure */ <T = unknown>(
  path: string,
  method?: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<T>;
export type FeatureProps = {
  vm: VMView;
  request: Request;
  token: string;
  refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 FeatureProps 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of FeatureProps | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
  projectId?: string;
  /** 分区跳转只携带待审阅文本，不代表发送或执行授权。
   * Section navigation carries draft text only, never authorization to send or execute. */
  developmentDraft?: { target: string; instruction: string };
  /** 请求父层切换到已启用分区；目标使用自己的插件请求能力。
   * Ask the parent to open an enabled section with its own plugin request capability. */
  onDevelopmentNavigate?: (section: string, draft?: { target: string; instruction: string }) => void;
  onProjectChange?: /** 中文：通知项目切换，让外层撤销旧作用域并读取新项目；这是 FeatureProps 的调用契约 | English: Notify a project switch so the owner revokes the old scope and reads the new project; this is the callable contract of FeatureProps | 中文：输入：projectId：当前项目标识 | English: Inputs: projectId: current project identifier | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (projectId: string) => void;
};
/**
 * 中文：把已知发行版键转换为显示名称，缺省使用 Alpine，未知键保留原值；aarch64 配置追加 ARM64 标记。
 * English: Convert known distribution keys to display names, default to Alpine and preserve unknown keys; append ARM64 for aarch64 configuration.
 * 中文：输入：distro：签名所示 string 业务值；architecture：签名所示 string 业务值
 * English: Inputs: distro: the string domain value in the signature; architecture: the string domain value in the signature
 */
export const distroName = (distro?: string, architecture?: string) => {
  const name = ({ alpine: 'Alpine 3.23', debian: 'Debian 12', ubuntu: 'Ubuntu 24.04 LTS' })
    [distro || 'alpine'] || distro;
  return architecture === 'aarch64' ? `${name} ARM64` : name;
};
/**
 * 中文：按 MiB/GiB 阈值选择单位并用区域数字格式保留一位小数，避免不同功能面板对资源大小显示不一致。
 * English: Select MiB/GiB by threshold and format one decimal with locale settings, keeping resource-size presentation consistent across panels.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
export const formatBytes = (value: number) =>
  value >= 1024 ** 3 ? `${formatNumber(value / 1024 ** 3, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GiB`
    : `${formatNumber(value / 1024 ** 2, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MiB`;
// 订阅取消只移除此组件的观察者；同一能力/路径的其他组件继续共享读取。
/**
 * 中文：向共享缓存注册观察者，返回当前数据、错误和失效刷新入口。每次渲染比较请求能力、路径和作用域代次，避免切换项目后短暂显示上一资源；卸载只退订本观察者。
 * English: Register an observer with the shared cache and return current data, errors and invalidation-based reload. Check request capability, path and scope generation on every render to hide previous resources immediately after switching; unmount removes only this observer.
 * 中文：输入：request：带身份和权限作用域的传输能力；path：目标文件或请求路径；enabled：是否启用本能力或读取流程（缺省 true）；interval：刷新间隔，零表示按失效事件更新（缺省 5000）
 * English: Inputs: request: transport capability bound to identity/authority scope; path: target file/request path; enabled: whether this capability/read flow is enabled (default true); interval: refresh interval; zero means invalidation-driven updates (default 5000)
 * 中文：结果：包含 data、error、reload 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing data, error, reload for caller state reads/operations
 */
export function useRemote<T>(request: Request, path: string, enabled = true, interval = 5000) {
  const [state, setState] = useState<{ request: Request; path: string; generation: string; snapshot: ResourceSnapshot<T> }>();
  useEffect(/** 中文：当依赖 [request, path, enabled, interval] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [request, path, enabled, interval] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => {
    if (!enabled) return;
    return resourceCache.watch<T>(request, path, snapshot => setState({ request, path, generation: resourceCache.generationFor(request, path), snapshot }), interval);
  }, [request, path, enabled, interval]);
  // 渲染时核对请求函数、路径和作用域代次，切换工作区后不能短暂展示上一订阅的数据。
  const current = enabled && state?.request === request && state.path === path && state.generation === resourceCache.generationFor(request, path) ? state.snapshot : undefined;
  return { data: current?.data ?? null, error: current?.error || '',
    /**
     * 中文：使当前请求能力和完整 URL 对应的缓存条目失效，推动现有订阅刷新而不创建第二套读取。
     * English: Invalidate the cache entry for the current request capability and full URL, refreshing existing subscriptions instead of creating a second read pipeline.
     */
    reload: useCallback(() => resourceCache.invalidate(request, path), [request, path]) };
}

if (typeof document !== 'undefined') {
  /**
   * 中文：把文档可见性同步给共享资源缓存；隐藏时暂停活动轮询，恢复时由缓存安排下一次核对。
   * English: Synchronize document visibility with the shared resource cache, pausing active polling while hidden and letting the cache schedule reconciliation on return.
   */
  const visibility = () => resourceCache.setVisible(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', visibility);
  visibility();
}
// 用 ref 同步拦住重复提交；卸载时取消请求，完成/失败回调只有在界面仍存活时更新状态。
/**
 * 中文：以同步 ref 防止双击并发提交，为每次动作提供独立取消信号并公开 busy/error/message。卸载撤销请求，完成回调只在仍存活时写入状态；finally 释放提交锁，即使动作失败也可继续操作。
 * English: Use a synchronous ref to reject double submissions, give each action its own cancellation signal and expose busy/error/message state. Abort on unmount and update completion state only while alive; finally releases the submission lock even after failure.
 * 中文：结果：包含 busy、error、message、run、clear 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing busy, error, message, run, clear for caller state reads/operations
 */
export function useAction() {
  const pending = useRef(false),
    alive = useRef(true),
    controller = useRef<AbortController | null>(null);
  useEffect(/** 中文：当依赖 [] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    alive.current = true;
    /**
     * 中文：在共享资源订阅、受控动作状态与任务反馈流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Shared resource subscriptions, controlled action state and job feedback, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  /**
   * 中文：拒绝卸载后或已有动作在途时的重复执行，建立本次取消寿命并清空旧反馈；只在界面存活时更新结果/错误，finally 释放 pending 和 busy，卸载会取消当前动作。
   * English: Reject execution after disposal or while another action is pending. Establish this action's cancellation lifetime and clear old feedback; update success/error only while mounted, release pending/busy in finally and cancel on unmount.
   * 中文：输入：action：本次动作或状态机输入；success：此处理器的调用值（缺省 ''）
   * English: Inputs: action: current action/state-machine input; success: the invocation value for this handler (default '')
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const run = async (action: /** 中文：在调用者提供的取消信号范围内执行用户动作，失败以拒绝或抛错传回；这是 useAction.run 的调用契约 | English: Execute a user action within the supplied cancellation signal, propagating failure through rejection/throw; this is the callable contract of useAction.run | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (signal: AbortSignal) => Promise<unknown>, success = '') => {
    if (!alive.current || pending.current) return;
    pending.current = true;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action(abort.signal);
      if (alive.current) setMessage(success);
    } catch (e) {
      if (alive.current) {
        if ((e as Error).name === 'AbortError') setMessage('操作已取消');
        else setError((e as Error).message);
      }
    } finally {
      pending.current = false;
      if (controller.current === abort) controller.current = null;
      if (alive.current) setBusy(false);
    }
  };
  /**
   * 中文：仅清除错误和成功提示，保留当前动作与忙碌状态，避免把隐藏反馈误当作取消操作。
   * English: Clear only error/success feedback while retaining the current action and busy state, avoiding treating dismissed feedback as cancellation.
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const clear = () => {
    setError('');
    setMessage('');
  };
  return { busy, error, message, run, clear };
}
/**
 * 中文：呈现共享资源订阅、受控动作状态与任务反馈中的 Feedback 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the Feedback surface for Shared resource subscriptions, controlled action state and job feedback. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ error, message } 提供 error（错误反馈）、message（完成提示） 上下文字段
 * English: Inputs: { error, message } provides context fields error (error feedback), message (completion message)
 */
export function Feedback({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="machine-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="feature-success">
          {message}
        </p>
      )}
    </>
  );
}
/**
 * 中文：呈现共享资源订阅、受控动作状态与任务反馈中的 JobLog 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the JobLog surface for Shared resource subscriptions, controlled action state and job feedback. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ job } 提供 job（job 状态） 上下文字段
 * English: Inputs: { job } provides context fields job (job state)
 */
export function JobLog({ job }: { job?: JobView | null }) {
  return job ? (
    <div className="job-block">
      <span
        className={`badge ${job.status === 'running' ? 'starting' : job.status === 'done' ? 'running' : 'error'}`}
      >
        {jobPresentation(job).label}
      </span>
      <Feedback error={job.error} />
      {jobPresentation(job).detail && <p className="subtle-note">{jobPresentation(job).detail}</p>}
      {job.errorCode && <p className="subtle-note"><code>{job.errorCode}</code></p>}
      {job.logPruned && !job.log && (
        <p className="subtle-note">日志已按保留策略清理（{formatDateTime(new Date(job.logPruned.at))}）。</p>
      )}
      {job.log && (
        <pre className="feature-log" aria-label="操作日志">
          {job.log}
        </pre>
      )}
    </div>
  ) : null;
}
/**
 * 中文：先为文件或实例导出请求一次下载票据，只接受精确相对票据路径；用 no-referrer 临时 anchor 下载后移除，票据申请失败不触发浏览器下载。
 * English: Request a download ticket for a file or VM export and accept only its exact relative ticket path. Download with a temporary no-referrer anchor then remove it; failed ticket requests never trigger browser download.
 * 中文：输入：request：带身份和权限作用域的传输能力；id：目标资源标识；target：事件目标或操作目标
 * English: Inputs: request: transport capability bound to identity/authority scope; id: target resource identifier; target: event/operation target
 * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
 * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
 * 中文：拒绝原因：无效的下载地址。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 无效的下载地址. These errors reach the direct caller or this function's catch handler
 */
export async function download(
  request: Request,
  id: string,
  target: { type: 'file'; path: string } | { type: 'export' },
) {
  const { url } = await request<{ url: string }>(`/vms/${id}/download`, 'POST', target);
  // 下载票据只能指向本站固定下载路由，避免把服务端回复直接当成任意导航地址。
  if (!/^\/api\/downloads\/[a-f0-9]{64}$/.test(url)) throw new Error('无效的下载地址');
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.referrerPolicy = 'no-referrer';
  document.body.append(a);
  a.click();
  a.remove();
}
