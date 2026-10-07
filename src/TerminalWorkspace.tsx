/**
 * 模块职责（中文）：提供终端标签、分屏和布局操作，并管理共享终端授权与观看者界面。
 * Module responsibility (English): Providing terminal tabs/splits and sharing-grant surfaces.
 * 详细范围（中文）：公开入口包括 TerminalWorkspace；职责覆盖提供终端标签分屏与共享授权界面，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include TerminalWorkspace. The scope covers Providing terminal tabs/splits and sharing-grant surfaces. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from './localization';
import { Columns2, Plus, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Request } from './feature-shared';
import { getTerminalStore } from './terminal-store';
import { restoreLayouts } from './terminal-layouts';
import { controllerSession } from './controller-session';
import { terminalStoreKey } from '../shared/terminal-scope';
import { workspacePath } from './workspace-request';

type SharedViewer = { id: string; username: string; role: 'owner' | 'viewer';
  vmIds: string[]; expiresAt: number | null };
type TerminalGrant = { id: string; vmId: string; session: string;
  projectId?: string; viewerId: string; expiresAt: number };

/**
 * 中文：呈现提供终端标签分屏与共享授权界面中的 TerminalWorkspace 界面，组合 Plus、Columns2、TerminalShareControls，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the TerminalWorkspace surface for Providing terminal tabs/splits and sharing-grant surfaces and composing Plus, Columns2, TerminalShareControls. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  id,
  projectId,
  request,
  render,
} 提供 id（目标资源标识）、projectId（当前项目标识）、request（带身份和权限作用域的传输能力）、render（render 状态） 上下文字段
 * English: Inputs: {
  id,
  projectId,
  request,
  render,
} provides context fields id (target resource identifier), projectId (current project identifier), request (transport capability bound to identity/authority scope), render (render state)
 */
export function TerminalWorkspace({
  id,
  projectId,
  request,
  render,
}: {
  id: string;
  projectId?: string;
  request: Request;
  render: /** 中文：按指定终端会话生成对应界面，布局所有者复用返回节点；这是 TerminalWorkspace 的调用契约 | English: Render the specified terminal session for reuse by the layout owner; this is the callable contract of TerminalWorkspace | 中文：输入：session：目标终端或桌面会话 | English: Inputs: session: target terminal/desktop session | 中文：结果：ReactNode；调用者依赖此类型约定 | English: Result: ReactNode; callers depend on this type contract */ (session: string) => ReactNode;
}) {
  const scopeKey = terminalStoreKey(id, projectId);
  const store = getTerminalStore(scopeKey);
  const principal = useSyncExternalStore(controllerSession.subscribe, controllerSession.getPrincipal);
  const { tabs, active, closing, error, suspended } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const dispatch = store.dispatch;
  const [split, setSplit] = useState(false);
  const [secondary, setSecondary] = useState('');
  const [layoutName, setLayoutName] = useState('');
  const [layoutError, setLayoutError] = useState('');
  const [layouts, setLayouts] = useState(/** 中文：在提供终端标签分屏与共享授权界面流程中按指定 Schema 校验并解码，读取浏览器缓存值；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Providing terminal tabs/splits and sharing-grant surfaces, validate/decode with the specified schema, read a browser-cache value. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation */ () => {
    try {
      return restoreLayouts(JSON.parse(localStorage.getItem('sakura-terminal-layouts') || '[]'));
    } catch {
      return [];
    }
  });
  useEffect(/** 中文：当依赖 [scopeKey] 变化时按指定 Schema 校验并解码，读取浏览器缓存值，split 状态，secondary 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [scopeKey] change, validate/decode with the specified schema, read a browser-cache value, split state, secondary state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    try {
      const saved = JSON.parse(localStorage.getItem('sakura-terminal-view-' + scopeKey) || '{}');
      setSplit(saved.split === true);
      setSecondary(typeof saved.secondary === 'string' ? saved.secondary : '');
    } catch {
      setSplit(false);
      setSecondary('');
    }
  }, [scopeKey]);
  /**
   * 中文：在提供终端标签分屏与共享授权界面流程中split 状态，secondary 状态，layoutError 状态，持久化浏览器缓存值；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Providing terminal tabs/splits and sharing-grant surfaces, split state, secondary state, layoutError state, persist a browser-cache value. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：nextSplit：签名所示 boolean 业务值；nextSecondary：签名所示 string 业务值
   * English: Inputs: nextSplit: the boolean domain value in the signature; nextSecondary: the string domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const saveView = (nextSplit: boolean, nextSecondary: string) => {
    setSplit(nextSplit);
    setSecondary(nextSecondary);
    try {
      localStorage.setItem(
        'sakura-terminal-view-' + scopeKey,
        JSON.stringify({ split: nextSplit, secondary: nextSecondary }),
      );
    } catch {
      setLayoutError('浏览器存储不可用，布局仅在当前页面生效');
    }
  };
  const second =
    secondary !== active && tabs.some((tab) => tab.id === secondary)
      ? secondary
      : tabs.find((t) => t.id !== active)?.id;
  return (
    <div className="terminal-workspace">
      <div className="terminal-tabs" role="tablist" aria-label="终端会话">
        {tabs.map(/** 中文：提交 POST workspacePath(`/vms/${id}/terminal-session`, projectId)，完成提供终端标签分屏与共享授权界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST workspacePath(`/vms/${id}/terminal-session`, projectId) for Providing terminal tabs/splits and sharing-grant surfaces. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：t：此处理器的调用值 | English: Inputs: t: the invocation value for this handler */ (t) => (
          <div className={`terminal-tab ${t.id === active ? 'active' : ''}`} key={t.id}>
            <button
              role="tab"
              id={`${scopeKey}-terminal-tab-${t.id}`}
              aria-controls={`${scopeKey}-terminal-pane-${t.id}`}
              tabIndex={t.id === active ? 0 : -1}
              aria-selected={t.id === active}
              onClick={() => dispatch({ type: 'select', id: t.id })}
              onKeyDown={/**
               * 中文功能：处理左右键及 Home/End 的终端标签选择，循环定位目标并同步 reducer 状态和对应 DOM 焦点。
               * English: Handle left/right/Home/End terminal-tab selection, wrap the target and synchronize reducer state with the corresponding DOM focus.
               * 输入 / Inputs: event.
               * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
               * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
               */
              (event) => {
                const index = tabs.findIndex((tab) => tab.id === t.id);
                const next =
                  event.key === 'ArrowRight'
                    ? tabs[(index + 1) % tabs.length]
                    : event.key === 'ArrowLeft'
                      ? tabs[(index + tabs.length - 1) % tabs.length]
                      : event.key === 'Home'
                        ? tabs[0]
                        : event.key === 'End'
                          ? tabs[tabs.length - 1]
                          : null;
                if (!next) return;
                event.preventDefault();
                dispatch({ type: 'select', id: next.id });
                document.getElementById(`${scopeKey}-terminal-tab-${next.id}`)?.focus();
              }}
              onDoubleClick={() => {
                const name = prompt('终端名称', t.name);
                if (name?.trim()) dispatch({ type: 'rename', id: t.id, name });
              }}
            >
              {t.name}
            </button>
            {tabs.length > 1 && (
              <button
                aria-label={`关闭 ${t.name}`}
                disabled={Boolean(closing)}
                onClick={/** 中文：提交 POST workspacePath(`/vms/${id}/terminal-session`, projectId)，完成提供终端标签分屏与共享授权界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST workspacePath(`/vms/${id}/terminal-session`, projectId) for Providing terminal tabs/splits and sharing-grant surfaces. Propagate asynchronous failure to this catch path or the outer action feedback */ () =>
                  void store.close(t.id, () =>
                    request(workspacePath(`/vms/${id}/terminal-session`, projectId), 'POST', { session: t.id }),
                  )
                }
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        <button
          aria-label="新建终端"
          disabled={tabs.length >= 8}
          onClick={() => {
            dispatch({ type: 'add', id: crypto.randomUUID() });
          }}
        >
          <Plus size={14} />
        </button>
        <button
          aria-pressed={split}
          disabled={tabs.length < 2}
          onClick={() => saveView(!split, second || '')}
        >
          <Columns2 size={14} />
          分屏
        </button>
        <button disabled={Boolean(closing)} onClick={() => void store.stopAll(() =>
          request(workspacePath(`/vms/${id}/terminal-session`, projectId), 'POST', { action: 'stop-all' }))}>
          {closing === '*' ? '正在停止…' : '停止项目终端'}
        </button>
        {suspended && <button disabled={Boolean(closing)} onClick={() => store.resume()}>打开终端</button>}
      </div>
      <details className="terminal-layout-controls">
        <summary>终端布局预设</summary>
        <div className="feature-actions">
          <input
            aria-label="布局名称"
            maxLength={40}
            value={layoutName}
            onChange={(event) => setLayoutName(event.target.value)}
            placeholder="例如：开发与日志"
          />
          <button
            disabled={!layoutName.trim() || layouts.length >= 20}
            onClick={/** 中文：在提供终端标签分屏与共享授权界面流程中layouts 状态，layoutName 状态，layoutError 状态，持久化浏览器缓存值；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Providing terminal tabs/splits and sharing-grant surfaces, layouts state, layoutName state, layoutError state, persist a browser-cache value. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
              const next = [
                ...layouts,
                { id: crypto.randomUUID(), name: layoutName.trim(), tabs, active, split, secondary: second },
              ];
              try {
                localStorage.setItem('sakura-terminal-layouts', JSON.stringify(next));
                setLayouts(next);
                setLayoutName('');
                setLayoutError('');
              } catch {
                setLayoutError('无法保存布局，请检查浏览器存储');
              }
            }}
          >
            保存当前布局
          </button>
          {split && (
            <label>
              副窗格
              <select
                aria-label="副窗格"
                value={second || ''}
                onChange={(event) => saveView(true, event.target.value)}
              >
                {tabs
                  .filter((tab) => tab.id !== active)
                  .map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      {tab.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        {layouts.map((layout) => (
          <div className="feature-actions" key={layout.id}>
            <span>
              {layout.name} · {layout.tabs.length} 个终端 · {layout.split ? '分屏' : '单窗格'}
            </span>
            <button
              disabled={!!closing}
              onClick={/** 中文：在提供终端标签分屏与共享授权界面流程中layoutError 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Providing terminal tabs/splits and sharing-grant surfaces, layoutError state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
                try {
                  store.applyLayout(layout);
                  saveView(layout.split, layout.secondary || '');
                  setLayoutError('');
                } catch (error) {
                  setLayoutError((error as Error).message);
                }
              }}
            >
              应用布局
            </button>
            <button
              onClick={/** 中文：在提供终端标签分屏与共享授权界面流程中layouts 状态，layoutError 状态，持久化浏览器缓存值；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致 | English: In Providing terminal tabs/splits and sharing-grant surfaces, layouts state, layoutError state, persist a browser-cache value. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
                const next = layouts.filter((item) => item.id !== layout.id);
                try {
                  localStorage.setItem('sakura-terminal-layouts', JSON.stringify(next));
                  setLayouts(next);
                } catch {
                  setLayoutError('无法删除布局');
                }
              }}
            >
              删除预设
            </button>
          </div>
        ))}
        <p className="muted">预设保存在此浏览器，可用于不同实例；应用时保留其他已有会话。</p>
        {layoutError && <p role="alert">{layoutError}</p>}
      </details>
      {error && (
        <p role="alert" className="machine-error">
          {error}
        </p>
      )}
      <div className={`terminal-panes ${split && second ? 'split' : ''}`}>
        {tabs.map((t) => (
          <div
            className="terminal-pane"
            id={`${scopeKey}-terminal-pane-${t.id}`}
            role="tabpanel"
            aria-labelledby={`${scopeKey}-terminal-tab-${t.id}`}
            hidden={t.id !== active && !(split && t.id === second)}
            key={t.id}
          >
            {suspended ? <div className="terminal-offline">
              <p>项目终端已断开，标签和布局已保留。停止完成后可修改项目目录或网络模式。</p>
            </div> : render(t.id)}
          </div>
        ))}
      </div>
      <p className="terminal-session-note">
        双击标签重命名 · 会话按项目恢复；关闭标签会结束该会话。停止项目终端可结束所有后台会话并保留布局。
      </p>
      {principal?.role === 'owner' && !suspended && <TerminalShareControls vmId={id} session={active} projectId={projectId}
        request={request} />}
    </div>
  );
}

/**
 * 中文：呈现提供终端标签分屏与共享授权界面中的 TerminalShareControls 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the TerminalShareControls surface for Providing terminal tabs/splits and sharing-grant surfaces. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, session, projectId, request } 提供 vmId（当前实例标识）、session（目标终端或桌面会话）、projectId（当前项目标识）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vmId, session, projectId, request } provides context fields vmId (current VM identifier), session (target terminal/desktop session), projectId (current project identifier), request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function TerminalShareControls({ vmId, session, projectId, request }: {
  vmId: string; session: string; projectId?: string; request: Request;
}) {
  const [viewers, setViewers] = useState<SharedViewer[]>([]);
  const [grants, setGrants] = useState<TerminalGrant[]>([]);
  const [viewerId, setViewerId] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /**
   * 中文：读取 GET /access/users；GET workspacePath('/access/terminal-shares?vmId=' + encodeURIComponent(vmId), projectId)，完成提供终端标签分屏与共享授权界面的数据交互并更新viewers 状态、grants 状态、viewerId 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform GET /access/users; GET workspacePath('/access/terminal-shares?vmId=' + encodeURIComponent(vmId), projectId) for Providing terminal tabs/splits and sharing-grant surfaces and update viewers state, grants state, viewerId state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const refresh = async () => {
    const [users, shared] = await Promise.all([
      request<{ users: SharedViewer[] }>('/access/users'),
      request<{ grants: TerminalGrant[] }>(workspacePath('/access/terminal-shares?vmId=' + encodeURIComponent(vmId), projectId)),
    ]);
    const eligible = users.users.filter((item) => item.role === 'viewer' &&
      item.vmIds.includes(vmId) && (item.expiresAt === null || item.expiresAt > Date.now()));
    setViewers(eligible);
    setGrants(shared.grants);
    setViewerId((current) => eligible.some((item) => item.id === current) ? current : eligible[0]?.id || '');
  };
  useEffect(/** 中文：当依赖 [vmId, projectId] 变化时重新核对父级远端视图；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, projectId] change, reconcile the parent's remote view. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { void refresh().catch((reason) => setError(String(reason.message || reason))); },
    [vmId, projectId]);
  return <section className="system-card" aria-label="共享终端管理">
    <h3>共享当前终端</h3>
    <p>只读账户可实时查看此 tmux 会话；输入和尺寸调整会在服务端拒绝。</p>
    <form onSubmit={/** 中文：提交 POST /access/terminal-shares，完成提供终端标签分屏与共享授权界面的数据交互并更新忙碌标记、错误反馈；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /access/terminal-shares for Providing terminal tabs/splits and sharing-grant surfaces and update busy flag, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：event：触发本处理器的事件及其数据 | English: Inputs: event: triggering event and its data | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async (event) => {
      event.preventDefault(); setBusy(true); setError('');
      try {
        await request('/access/terminal-shares', 'POST', { vmId, session, projectId, viewerId, minutes });
        await refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : '无法共享终端'); }
      finally { setBusy(false); }
    }}>
      <label>只读账户<select value={viewerId} disabled={busy || !viewers.length}
        onChange={(event) => setViewerId(event.target.value)}>
        {viewers.map((item) => <option key={item.id} value={item.id}>{item.username}</option>)}
      </select></label>
      <label>有效分钟<input type="number" min={1} max={480} value={minutes} disabled={busy}
        onChange={(event) => setMinutes(Number(event.target.value))} /></label>
      <button className="secondary compact" disabled={busy || !viewerId}>共享</button>
    </form>
    {!viewers.length && <p>先在“账户与只读分享”为此实例创建只读账户。</p>}
    <ul>{grants.filter((item) => item.session === session).map((item) => <li key={item.id}>
      {viewers.find((viewer) => viewer.id === item.viewerId)?.username || '已撤销账户'}
      {' · 到期 '}{formatDateTime(new Date(item.expiresAt))}
      <button className="secondary compact" disabled={busy} onClick={/** 中文：提交 DELETE '/access/terminal-shares/' + item.id，完成提供终端标签分屏与共享授权界面的数据交互并更新忙碌标记、错误反馈；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform DELETE '/access/terminal-shares/' + item.id for Providing terminal tabs/splits and sharing-grant surfaces and update busy flag, error feedback. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断 | English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately */ async () => {
        setBusy(true); setError('');
        try { await request('/access/terminal-shares/' + item.id, 'DELETE'); await refresh(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '无法撤销共享'); }
        finally { setBusy(false); }
      }}>撤销</button>
    </li>)}</ul>
    <button className="secondary compact" disabled={busy} onClick={() => void refresh()
      .catch((reason) => setError(String(reason.message || reason)))}>刷新共享状态</button>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}
