/**
 * 模块职责（中文）：管理单应用桌面会话，启动应用窗口并查看或终止已有会话。
 * Module responsibility (English): Starting and stopping single-application desktop sessions and configuring their policies.
 * 详细范围（中文）：公开入口包括 SingleAppWindowsPanel；职责覆盖启动和停止单应用桌面会话并配置策略，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SingleAppWindowsPanel. The scope covers Starting and stopping single-application desktop sessions and configuring their policies. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { ExternalLink, LoaderCircle, Square, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { VMView } from '../shared/contracts/vm.ts';
import { Feedback, useRemote, type Request } from './feature-shared';
import { connectSingleAppPopup, createSingleAppPopup } from './single-app-window';
import './single-app-windows.css';

type AppSession = {
  id: string;
  program: string;
  resolution: string;
  password: string;
  networkIsolation?: 'host' | 'private';
  dataDirectory: string;
  clipboard?: { copy: boolean; paste: boolean };
  status: 'running' | 'stopped' | 'relaunch-required' | 'preparing' | 'cleanup-pending' | 'review-required';
  cleanupPending?: boolean;
  lastError?: string;
  projectOwner?: { uid: number; user: string };
  applicationOwner?: { uid: number; user: string };
  startedAt: string;
};

/**
 * 中文：呈现启动和停止单应用桌面会话并配置策略中的 SingleAppWindowsPanel 界面，订阅 /vms/{vm.id}/single-app，组合 TerminalSquare、LoaderCircle、ExternalLink，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SingleAppWindowsPanel surface for Starting and stopping single-application desktop sessions and configuring their policies, subscribing to /vms/{vm.id}/single-app and composing TerminalSquare, LoaderCircle, ExternalLink. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, token, request } 提供 vm（vm 状态）、token（当前传输认证凭证）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, token, request } provides context fields vm (vm state), token (current transport credential), request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function SingleAppWindowsPanel({ vm, token, request }: {
  vm: VMView; token: string; request: Request;
}) {
  const [program, setProgram] = useState('xterm');
  const [args, setArgs] = useState('');
  const [resolution, setResolution] = useState('1024x768');
  const [allowCopy, setAllowCopy] = useState(true);
  const [allowPaste, setAllowPaste] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRemote<{ sessions: AppSession[];
    clipboardPolicies: Record<string, { copy: boolean; paste: boolean }> }>(request,
    `/vms/${vm.id}/single-app`, vm.status === 'running', 5000);
  const rules = list.data?.clipboardPolicies;
  const savedPolicy = rules && Object.hasOwn(rules, program.trim())
    ? rules[program.trim()] : undefined;
  const unsavedRelaxation = !!savedPolicy &&
    ((!savedPolicy.copy && allowCopy) || (!savedPolicy.paste && allowPaste));
  useEffect(/** 中文：当依赖 [program, savedPolicy?.copy, savedPolicy?.paste] 变化时allowCopy 状态，allowPaste 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [program, savedPolicy?.copy, savedPolicy?.paste] change, allowCopy state, allowPaste state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    setAllowCopy(savedPolicy?.copy ?? true);
    setAllowPaste(savedPolicy?.paste ?? true);
  }, [program, savedPolicy?.copy, savedPolicy?.paste]);

  /**
   * 中文：提交 POST /vms/{vm.id}/single-app，完成启动和停止单应用桌面会话并配置策略的数据交互并更新忙碌标记、错误反馈；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/single-app for Starting and stopping single-application desktop sessions and configuring their policies and update busy flag, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：remove：移除服务端会话的异步操作
   * English: Inputs: remove: asynchronous server-session removal
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
  const updatePolicy = async (remove: boolean) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await request(`/vms/${vm.id}/single-app`, 'POST', remove
        ? { action: 'clipboard-remove', program: program.trim() }
        : { action: 'clipboard-save', program: program.trim(),
          clipboard: { copy: allowCopy, paste: allowPaste } });
      list.reload();
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  /**
   * 中文：在启动和停止单应用桌面会话并配置策略流程中错误反馈，关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Starting and stopping single-application desktop sessions and configuring their policies, error feedback, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：session：目标终端或桌面会话
   * English: Inputs: session: target terminal/desktop session
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   */
  const open = async (session: AppSession) => {
    let popup: Window | undefined;
    try {
      popup = createSingleAppPopup();
      await connectSingleAppPopup(popup, vm.id, session, token);
    } catch (cause) {
      popup?.close();
      setError((cause as Error).message);
    }
  };

  /**
   * 中文：提交 POST /vms/{vm.id}/single-app，完成启动和停止单应用桌面会话并配置策略的数据交互并更新错误反馈、忙碌标记；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/single-app for Starting and stopping single-application desktop sessions and configuring their policies and update error feedback, busy flag. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
  const start = async () => {
    if (busy) return;
    if (unsavedRelaxation) {
      setError('放宽此程序的剪贴板权限前，请先保存新规则');
      return;
    }
    let popup: Window;
    try { popup = createSingleAppPopup(); }
    catch (cause) { setError((cause as Error).message); return; }
    setBusy(true);
    setError('');
    let session: AppSession | undefined;
    try {
      session = await request<AppSession>(`/vms/${vm.id}/single-app`, 'POST', {
        action: 'start', program: program.trim(),
        args: args.split('\n').filter((arg) => arg !== ''),
        resolution, clipboard: { copy: allowCopy, paste: allowPaste },
      });
      await connectSingleAppPopup(popup, vm.id, session, token);
    } catch (cause) {
      popup.close();
      let cleanupError: string | undefined;
      if (session) {
        try {
          await request(`/vms/${vm.id}/single-app`, 'POST', { action: 'stop', id: session.id });
        } catch (cleanupCause) { cleanupError = (cleanupCause as Error).message; }
      }
      setError((cause as Error).message + (cleanupError
        ? `；停止未确认：${cleanupError}。请在原窗口记录中重试停止。` : ''));
    } finally {
      list.reload();
      setBusy(false);
    }
  };

  /**
   * 中文：提交 POST /vms/{vm.id}/single-app，完成启动和停止单应用桌面会话并配置策略的数据交互并更新忙碌标记、错误反馈；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/single-app for Starting and stopping single-application desktop sessions and configuring their policies and update busy flag, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：session：目标终端或桌面会话
   * English: Inputs: session: target terminal/desktop session
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   */
  const stop = async (session: AppSession) => {
    setBusy(true);
    setError('');
    try {
      await request(`/vms/${vm.id}/single-app`, 'POST', { action: 'stop', id: session.id });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      list.reload();
      setBusy(false);
    }
  };

  return <section className="desktop-single-app" aria-label="单应用 Linux 窗口">
    <div className="desktop-single-app-head">
      <div>
        <h3><TerminalSquare size={17} /> 单应用窗口</h3>
        <p>在当前项目中运行 Linux 图形程序，沿用项目网络设置。每个窗口独立保存应用数据；每台实例最多四个。</p>
      </div>
      <span>试验功能</span>
    </div>
    <dl className="single-app-launch-context">
      <div><dt>目标实例</dt><dd data-locale-ignore>{vm.name}</dd></div>
      <div><dt>待启动程序</dt><dd><code>{program.trim() || '—'}</code></dd></div>
      <div><dt>窗口尺寸</dt><dd>{resolution.replace('x', ' × ')}</dd></div>
    </dl>
    <form className="desktop-single-app-form" onSubmit={(event) => {
      event.preventDefault();
      void start();
    }}>
      <label>程序名<input value={program} onChange={(event) => setProgram(event.target.value)}
        pattern="[A-Za-z][A-Za-z0-9+._-]{0,63}" maxLength={64} required
        placeholder="xterm" /></label>
      <label>参数（每行一个）<textarea value={args} onChange={(event) => setArgs(event.target.value)}
        placeholder="可选；空行忽略，每行空格保留" rows={2} /></label>
      <label>窗口尺寸<select value={resolution} onChange={(event) => setResolution(event.target.value)}>
        <option value="800x600">800 × 600</option>
        <option value="1024x768">1024 × 768</option>
        <option value="1280x800">1280 × 800</option>
      </select></label>
      <label className="single-app-clipboard-toggle"><input type="checkbox" checked={allowCopy}
        onChange={(event) => setAllowCopy(event.target.checked)} />允许复制到宿主</label>
      <label className="single-app-clipboard-toggle"><input type="checkbox" checked={allowPaste}
        onChange={(event) => setAllowPaste(event.target.checked)} />允许粘贴到应用</label>
      <button className="secondary compact" type="button" disabled={busy || !program.trim()}
        onClick={() => void updatePolicy(false)}>保存此程序规则</button>
      {savedPolicy && <button className="text-button" type="button" disabled={busy}
        onClick={() => void updatePolicy(true)}>移除程序规则</button>}
      {savedPolicy && <small>收紧规则会断开仍具旧权限的窗口，需停止并重开；放宽权限只适用于后续窗口。
        </small>}
      <button className="primary compact" type="submit"
        disabled={busy || vm.status !== 'running' || unsavedRelaxation}>
        {busy ? <LoaderCircle size={14} className="spin" /> : <ExternalLink size={14} />}
        启动应用
      </button>
    </form>
    {busy ? <p className="single-app-launch-hint" role="status">正在处理窗口请求，请等待当前操作完成。</p>
      : vm.status !== 'running' ? <p className="single-app-launch-hint">实例未运行，启动实例后才能打开应用窗口。</p>
        : unsavedRelaxation && <p className="single-app-launch-hint">放宽此程序的剪贴板权限前，请先保存新规则。</p>}
    <Feedback error={error} />
    <div className="single-app-list-heading">
      <h4>窗口记录{list.data && <span>{list.data.sessions.length} 个</span>}</h4>
      {list.error && vm.status === 'running' && <button type="button" className="secondary compact" disabled={busy}
        onClick={list.reload}>重新读取窗口记录</button>}
    </div>
    <Feedback error={list.error} />
    {vm.status === 'running' && !list.data && !list.error && <p className="single-app-empty" role="status">正在读取窗口记录…</p>}
    {list.data && !list.data.sessions.length && <div className="single-app-empty">
      <strong>暂无应用窗口</strong><p>填写上方程序和参数后，启动第一个窗口。</p>
    </div>}
    {!!list.data?.sessions.length && <div className="desktop-single-app-sessions">
      {list.data.sessions.map((session) => <article key={session.id} className="single-app-session"
        data-state={session.cleanupPending ? 'cleanup-pending' : session.status}>
        <header><h5 data-locale-ignore>{session.program}</h5><span className="single-app-session-state">{session.cleanupPending || session.status === 'cleanup-pending'
          ? '清理未确认，请重试停止' : session.status === 'running' ? '运行中'
            : session.status === 'preparing' ? '准备中' : session.status === 'review-required' ? '原归属待核对'
              : session.status === 'relaunch-required' ? '规则已收紧，需停止并重开' : '已退出'}</span></header>
        <dl className="single-app-session-details">
          <div><dt>尺寸</dt><dd>{session.resolution}</dd></div>
          <div><dt>剪贴板</dt><dd>复制{session.clipboard?.copy === false ? '关闭' : '开启'} · 粘贴{session.clipboard?.paste === false ? '关闭' : '开启'}</dd></div>
          <div><dt>网络</dt><dd>{session.networkIsolation === 'private' ? '私有网络'
            : session.networkIsolation === 'host' ? '共享网络' : '网络归属未核实'}</dd></div>
          <div className="single-app-directory"><dt>数据目录</dt><dd><code>{session.dataDirectory}</code></dd></div>
          {session.projectOwner && session.applicationOwner && <>
            <div><dt>项目账号</dt><dd><span data-locale-ignore>{session.projectOwner.user}</span>（UID {session.projectOwner.uid}）</dd></div>
            <div><dt>应用账号</dt><dd><span data-locale-ignore>{session.applicationOwner.user}</span>（UID {session.applicationOwner.uid}）</dd></div>
          </>}
        </dl>
        {session.lastError && <p className="single-app-session-error" data-locale-ignore>{session.lastError}</p>}
        <footer><code className="single-app-session-id" title={session.id}>{session.id}</code><div className="feature-actions">
        <button className="secondary compact" disabled={session.status !== 'running' || session.cleanupPending}
          onClick={() => void open(session)}><ExternalLink size={13} /> 打开</button>
        <button className="secondary compact" disabled={busy || session.status === 'review-required'}
          onClick={() => void stop(session)}><Square size={13} />
          {session.status === 'review-required' ? '归属待核对'
            : session.cleanupPending || session.status === 'cleanup-pending' ? '重试停止' : '停止'}</button>
        </div></footer>
      </article>)}
    </div>}
  </section>;
}
