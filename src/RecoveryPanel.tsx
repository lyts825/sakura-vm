/**
 * 模块职责（中文）：展示领域恢复目录、诊断和恢复记录，发起明确选定的恢复或重建操作。
 * Module responsibility (English): Requesting precise recovery or rebuilding after checking recovery-catalog evidence.
 * 详细范围（中文）：公开入口包括 RecoveryPanel；职责覆盖核对恢复目录证据后发起精确恢复或重建，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include RecoveryPanel. The scope covers Requesting precise recovery or rebuilding after checking recovery-catalog evidence. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  recoveryListSchema,
  recoveryViewSchema,
  type RecoveryView,
  type RecoveryDiagnostics,
} from '../shared/contracts/recovery';
import type { Request } from './feature-shared';
import { formatDateTime } from './localization';

/**
 * 中文：呈现核对恢复目录证据后发起精确恢复或重建中的 RecoveryPanel 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the RecoveryPanel surface for Requesting precise recovery or rebuilding after checking recovery-catalog evidence. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function RecoveryPanel({ request }: { request: Request }) {
  const [records, setRecords] = useState<RecoveryView[]>([]);
  const [diagnostics, setDiagnostics] = useState<RecoveryDiagnostics>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(20);
  const active = useRef<AbortController | null>(null);
  /**
   * 中文：读取 GET /recoveries，完成核对恢复目录证据后发起精确恢复或重建的数据交互并更新忙碌标记、错误反馈、records 状态、diagnostics 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform GET /recoveries for Requesting precise recovery or rebuilding after checking recovery-catalog evidence and update busy flag, error feedback, records state, diagnostics state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：拒绝原因：恢复目录响应格式无效，请刷新重试。。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 恢复目录响应格式无效，请刷新重试。. These errors reach the direct caller or this function's catch handler
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const load = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await request<unknown>('/recoveries', 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      const parsed = recoveryListSchema.safeParse(result);
      if (!parsed.success) throw new Error('恢复目录响应格式无效，请刷新重试。');
      setRecords(parsed.data.records);
      setDiagnostics(parsed.data.diagnostics);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '读取恢复记录失败，请重试。');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }, [request]);
  useEffect(/** 中文：当依赖 [load] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [load] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    void load();
    /**
     * 中文：在核对恢复目录证据后发起精确恢复或重建流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Requesting precise recovery or rebuilding after checking recovery-catalog evidence, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [load]);
  /**
   * 中文：提交 POST /recoveries，完成核对恢复目录证据后发起精确恢复或重建的数据交互并更新忙碌标记、错误反馈、records 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /recoveries for Requesting precise recovery or rebuilding after checking recovery-catalog evidence and update busy flag, error feedback, records state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：record：签名所示 RecoveryView 业务值；action：本次动作或状态机输入
   * English: Inputs: record: the RecoveryView domain value in the signature; action: current action/state-machine input
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：拒绝原因：恢复操作响应格式无效，请刷新重试。。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 恢复操作响应格式无效，请刷新重试。. These errors reach the direct caller or this function's catch handler
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const retry = async (record: RecoveryView, action: string) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await request<unknown>(
        '/recoveries',
        'POST',
        { id: record.id, digest: record.digest, action },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const parsed = recoveryViewSchema.safeParse(result);
      if (!parsed.success || parsed.data.id !== record.id)
        throw new Error('恢复操作响应格式无效，请刷新重试。');
      setRecords((values) => values.map((value) => (value.id === record.id ? parsed.data : value)));
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '执行恢复操作失败，请重试。');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  /**
   * 中文：提交 POST /recoveries/rebuild，完成核对恢复目录证据后发起精确恢复或重建的数据交互并更新忙碌标记、错误反馈、records 状态、diagnostics 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /recoveries/rebuild for Requesting precise recovery or rebuilding after checking recovery-catalog evidence and update busy flag, error feedback, records state, diagnostics state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：拒绝原因：重建响应格式无效，请刷新核对目录状态。。这些错误交给直接调用者或本函数 catch 处理
   * English: Refusal reasons: 重建响应格式无效，请刷新核对目录状态。. These errors reach the direct caller or this function's catch handler
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const rebuild = async () => {
    if (active.current || !diagnostics) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await request<unknown>(
        '/recoveries/rebuild',
        'POST',
        { revision: diagnostics.revision },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const parsed = recoveryListSchema.safeParse(result);
      if (!parsed.success) throw new Error('重建响应格式无效，请刷新核对目录状态。');
      setRecords(parsed.data.records);
      setDiagnostics(parsed.data.diagnostics);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '重建失败，原文件和领域票据仍保留。');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  const pending = records.filter((record) => record.state !== 'resolved');
  return (
    <details className="plugin-recovery">
      <summary>资源恢复{pending.length ? ` · ${pending.length} 项待处理` : ''}</summary>
      <div className="plugin-recovery-content">
        <button type="button" disabled={busy} onClick={() => void load()}>
          {busy ? '正在处理…' : '刷新恢复记录'}
        </button>
        {error && <p role="alert">{error}</p>}
        {diagnostics?.state === 'degraded' && (
          <div role="alert">
            <p>{diagnostics.message}</p>
            <p>
              目录已暂停恢复操作，迁移封锁与待清理资源继续保留。重建会先保留原文件副本，再从所属服务重新发现票据。
            </p>
            {!!diagnostics.sourceFailures.length && (
              <p>待检查服务：{diagnostics.sourceFailures.join('、')}</p>
            )}
            <button type="button" disabled={busy} onClick={() => void rebuild()}>
              保留原文件并重建目录
            </button>
          </div>
        )}
        {diagnostics?.quarantineFile && <p>原目录副本：{diagnostics.quarantineFile}</p>}
        {!pending.length && !error && diagnostics?.state !== 'degraded' && <p>没有待恢复资源。</p>}
        {pending.slice(0, limit).map((record) => (
          <article key={record.id} className="plugin-recovery-record">
            <strong>{record.binding.pluginInstanceId || record.binding.owner}</strong>
            <p>
              {record.binding.domain === 'plugin-lifecycle' ? '插件清理' : '资源所属服务'} ·{' '}
              {record.resourceIds.length} 项资源
            </p>
            {record.binding.vmId && (
              <p>
                实例：{record.binding.vmId}
                {record.binding.projectId ? ` · 项目：${record.binding.projectId}` : ''}
              </p>
            )}
            {record.error && <p>{record.error}</p>}
            {record.actions.length ? (
              record.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void retry(record, action.id)}
                >
                  {action.title}
                </button>
              ))
            ) : (
              <p>请通过所属服务的恢复入口处理；原清理票据仍保留。</p>
            )}
            <details>
              <summary>原始记录</summary>
              <p>记录：{record.id}</p>
              {record.binding.pluginGeneration && <p>代次：{record.binding.pluginGeneration}</p>}
              {record.binding.artifactDigest && <p>产物：{record.binding.artifactDigest}</p>}
              <p>
                首次发现：{formatDateTime(record.firstSeenAt)} · 已尝试 {record.attempts} 次
              </p>
            </details>
          </article>
        ))}
        {pending.length > limit && (
          <button type="button" onClick={() => setLimit((value) => value + 20)}>
            显示更多
          </button>
        )}
      </div>
    </details>
  );
}
