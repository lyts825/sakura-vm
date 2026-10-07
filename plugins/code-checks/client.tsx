/**
 * 模块职责（中文）：“代码与调试工具”插件的DAP 调试连接、断点、调用栈和变量面板，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for code checks, language services and debugging.
 * 详细范围（中文）：公开入口包括 DebugPanel；职责覆盖代码检查、语言服务与调试的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include DebugPanel. The scope covers UI interaction and state presentation for code checks, language services and debugging. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useState } from 'react';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type DebugView = OperationResponse<'code-checks.legacy.get.vms.vmId.debugger'>;
type VariableResult = Extract<OperationResponse<'code-checks.legacy.post.vms.vmId.debugger'>, { variables: unknown[] }>;
type Variable = VariableResult['variables'][number];
/**
 * 中文：按逗号或空白解析断点行，限制至多 100 条且每条为 1–100000 整数；去重后按数值排序，无输入返回空列表。
 * English: Parse comma/whitespace-separated breakpoints, cap at one hundred integer lines in one-to-one-hundred-thousand, deduplicate/numerically sort and return no breakpoints for empty input.
 * 中文：输入：text：待处理的文本内容
 * English: Inputs: text: text content to process
 * 中文：拒绝原因：请用逗号或空格填写 1–100000 的断点行号。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 请用逗号或空格填写 1–100000 的断点行号. These errors reach the direct caller or this function's catch handler
 */
function breakpointLines(text: string) {
  if (!text.trim()) return [];
  const lines = text.split(/[,，\s]+/).map(Number);
  if (lines.length > 100 || lines.some((line) => !Number.isInteger(line) || line < 1 || line > 100000))
    throw new Error('请用逗号或空格填写 1–100000 的断点行号');
  return [...new Set(lines)].sort((a, b) => a - b);
}
/**
 * 中文：呈现代码检查、语言服务与调试的界面交互与状态呈现中的 DebugPanel 界面，订阅 /vms/{vmId}/debugger，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DebugPanel surface for UI interaction and state presentation for code checks, language services and debugging, subscribing to /vms/{vmId}/debugger. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, request, path, dirty, openPath } 提供 vmId（当前实例标识）、request（带身份和权限作用域的传输能力）、path（目标文件或请求路径）、dirty（dirty 状态）、openPath（openPath 状态） 上下文字段
 * English: Inputs: { vmId, request, path, dirty, openPath } provides context fields vmId (current VM identifier), request (transport capability bound to identity/authority scope), path (target file/request path), dirty (dirty state), openPath (openPath state)
 */
export function DebugPanel({ vmId, request, path, dirty, openPath }: {
  vmId: string; request: Request; path: string; dirty: boolean;
  openPath: /** 中文：把调试定位的文件路径交给编辑器打开入口；这是 DebugPanel 的调用契约 | English: Pass debugger-located file paths to the editor opening entry point; this is the callable contract of DebugPanel | 中文：输入：path：目标文件或请求路径；line：签名所示 number 业务值 | English: Inputs: path: target file/request path; line: the number domain value in the signature | 中文：结果：Promise<void>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<void>; callers depend on this type contract, with promise rejection representing asynchronous failure */ (path: string, line?: number) => Promise<void>;
}) {
  const remote = useRemote<DebugView>(request, `/vms/${vmId}/debugger`, true, 1000);
  const action = useAction();
  const [breakpoints, setBreakpoints] = useState('');
  const [stopOnEntry, setStopOnEntry] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, Variable[]>>({});
  const view = remote.data;
  const session = view && 'token' in view ? view : null;
  const details = view && 'variables' in view ? view : null;
  useEffect(/** 中文：当依赖 [session?.token, session?.state, details?.selectedFrame, details?.frames[0]?.line] 变化时expanded 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [session?.token, session?.state, details?.selectedFrame, details?.frames[0]?.line] change, expanded state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership */ () => setExpanded({}), [session?.token, session?.state, details?.selectedFrame, details?.frames[0]?.line]);
  useEffect(/** 中文：当依赖 [details?.token] 变化时breakpoints 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [details?.token] change, breakpoints state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (details?.token) setBreakpoints(details.breakpoints.map((item) => item.line).join(', '));
  }, [details?.token]);
  /**
   * 中文：提交 POST /vms/{vmId}/debugger，完成代码检查、语言服务与调试的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vmId}/debugger for UI interaction and state presentation for code checks, language services and debugging. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：input：尚待校验的输入数据；success：签名所示 string 业务值
   * English: Inputs: input: input data requiring validation; success: the string domain value in the signature
   */
  const run = (input: Record<string, unknown>, success: string) => void action.run(/** 中文：提交 POST /vms/{vmId}/debugger，完成代码检查、语言服务与调试的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vmId}/debugger for UI interaction and state presentation for code checks, language services and debugging. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request(`/vms/${vmId}/debugger`, 'POST', input, signal);
    remote.reload();
  }, success);
  const token = session?.token;
  const pending = view && 'pending' in view ? view.pending : session?.needsReview && token ? [{ token }] : [];
  return (
    <div className="feature-card">
      <div className="panel-heading"><h4>Python 调试器</h4>
        <span className="muted">{session?.state || (view?.installed ? '就绪' : '未安装')}</span>
      </div>
      <Feedback error={action.error || remote.error || session?.error} message={action.message} />
      {view?.installed === false && <button className="secondary compact" disabled={action.busy}
        onClick={() => run({ action: 'install' }, '调试器已安装')}>
        安装 Python 调试器
      </button>}
      {!!pending.length && <div role="status">
        <p className="subtle-note">上次调试尚未完成清理，请先清理原会话再启动。</p>
        {pending.map((item, index) => <button key={item.token} className="secondary compact" disabled={action.busy}
          onClick={() => run({ action: 'stop', token: item.token }, '原调试会话已清理')}>
          清理上次调试{pending.length > 1 ? ` ${index + 1}` : ''}
        </button>)}
      </div>}
      {view?.installed && !view.active && !pending.length && <>
        <label>断点行号（逗号或空格分隔）
          <input aria-label="断点行号" value={breakpoints} onChange={(event) => setBreakpoints(event.target.value)}
            placeholder="例如 3, 8" />
        </label>
        <label className="checkbox-row"><input type="checkbox" checked={stopOnEntry}
          onChange={(event) => setStopOnEntry(event.target.checked)} />进入第一行时暂停</label>
        <button className="primary compact" disabled={action.busy || dirty}
          onClick={/** 中文：校验断点行号后提交调试启动，带当前入口路径和 stopOnEntry 选择；失败由动作反馈保留表单。 | English: Validate breakpoints before debugger startup using current entry path/stopOnEntry, retaining the form on failure through action feedback. | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
            try { run({ action: 'start', path, breakpoints: breakpointLines(breakpoints), stopOnEntry }, '调试会话已启动'); }
            catch (error) { void action.run(async () => { throw error; }); }
          }}>
          开始调试
        </button>
        {dirty && <p className="subtle-note">保存当前 Python 文件后可启动调试。</p>}
      </>}
      {view?.active && token && details && <>
        <p className="muted">正在调试 {details.path}{details.reason ? ` · ${details.reason}` : ''}</p>
        <div className="feature-actions">
          {details.state === 'running' && <button className="secondary compact" disabled={action.busy}
            onClick={() => run({ action: 'pause', token }, '已请求暂停')}>暂停</button>}
          {details.state === 'stopped' && <>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'continue', token }, '继续运行')}>继续</button>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'next', token }, '单步越过')}>单步越过</button>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'stepIn', token }, '单步进入')}>单步进入</button>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => run({ action: 'stepOut', token }, '单步跳出')}>单步跳出</button>
          </>}
          <button className="secondary compact" disabled={action.busy}
            onClick={() => run({ action: 'stop', token }, '调试已停止')}>停止调试</button>
        </div>
        <div className="feature-actions">
          <label>断点行号
            <input aria-label="运行中的断点行号" value={breakpoints}
              onChange={(event) => setBreakpoints(event.target.value)} />
          </label>
          <button className="secondary compact" disabled={action.busy}
            onClick={/** 中文：校验当前断点文本后按现有调试 token 更新断点，操作确认后显示完成提示。 | English: Validate breakpoint text before updating the current debugger token's breakpoints, showing completion after confirmation. | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
              try { run({ action: 'breakpoints', token, lines: breakpointLines(breakpoints) }, '断点已更新'); }
              catch (error) { void action.run(async () => { throw error; }); }
            }}>更新断点</button>
        </div>
        {!!details.breakpoints.length && <p className="subtle-note">断点：{details.breakpoints.map((item) =>
          `${item.line}${item.verified ? ' ✓' : ` 未确认${item.message ? `（${item.message}）` : ''}`}`).join(' · ')}</p>}
        {details.state === 'stopped' && <div className="feature-grid">
          <div className="feature-card"><h4>调用栈</h4>
            {details.frames.map((frame) => <button key={frame.id} className="text-button"
              aria-pressed={details.selectedFrame === frame.id}
              onClick={() => {
                run({ action: 'inspect', token, frameId: frame.id }, '已选中栈帧');
                if (details.directory && frame.path.startsWith(`${details.directory}/`))
                  void openPath(frame.path, frame.line);
              }}>
              {frame.name} · {frame.path}:{frame.line}
            </button>)}
          </div>
          <div className="feature-card"><h4>变量</h4>
            {details.variables.map((item, index) => <div key={`${item.name}:${index}`}>
              {item.variablesReference > 0 ? <button className="text-button" onClick={() =>
                void action.run(/** 中文：提交 POST /vms/{vmId}/debugger，完成代码检查、语言服务与调试的界面交互与状态呈现的数据交互并更新expanded 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vmId}/debugger for UI interaction and state presentation for code checks, language services and debugging and update expanded state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：取消边界：执行前或关键异步步骤检查已取消信号，取消后不继续提交下一步工作 | English: Cancellation boundary: check aborted signals before execution/key asynchronous steps; canceled work must not submit the next step */ async (signal) => {
                  const result = await request<VariableResult>(`/vms/${vmId}/debugger`, 'POST',
                    { action: 'expand', token, reference: item.variablesReference }, signal);
                  signal.throwIfAborted();
                  setExpanded((current) => ({ ...current, [item.variablesReference]: result.variables }));
                })}>
                {item.name}: {item.value} ({item.type}) ▸
              </button> : <p>{item.name}: {item.value} ({item.type})</p>}
              {expanded[item.variablesReference]?.map((child, childIndex) => <p key={childIndex} className="muted">
                ↳ {child.name}: {child.value}
              </p>)}
            </div>)}
          </div>
        </div>}
      </>}
      {!!details?.output && <details open={details.state === 'terminated'}><summary>程序输出</summary>
        <pre className="feature-log">{details.output}</pre>
      </details>}
    </div>
  );
}
