/**
 * 模块职责（中文）：搜索和管理客户机软件包，预览安装/移除变化并查看包任务结果。
 * Module responsibility (English): UI interaction and state presentation for resource policy, packages and engineering tasks.
 * 详细范围（中文）：公开入口包括 PackageWorkbenchPanel；职责覆盖资源策略、软件包与工程任务的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PackageWorkbenchPanel. The scope covers UI interaction and state presentation for resource policy, packages and engineering tasks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type Mode = 'installed' | 'search' | 'updates';
type Change = 'install' | 'remove' | 'upgrade' | 'upgrade-all';
type Item = { name: string; version: string; description?: string;
  installedVersion?: string; availableVersion?: string };
type Listing = { vmId: string; mode: Mode; query: string; manager: 'apk' | 'apt';
  items: Item[]; total: number; page: number; hasMore: boolean; warning?: string };
type Preview = { token: string; expiresAt: number; plan: string;
  change: Change; name: string | null };

/**
 * 中文：呈现资源策略、软件包与工程任务的界面交互与状态呈现中的 PackageWorkbenchPanel 界面，订阅 path，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PackageWorkbenchPanel surface for UI interaction and state presentation for resource policy, packages and engineering tasks, subscribing to path. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vmId, running, request, onSubmitted } 提供 vmId（当前实例标识）、running（running 状态）、request（带身份和权限作用域的传输能力）、onSubmitted（onSubmitted 状态） 上下文字段
 * English: Inputs: { vmId, running, request, onSubmitted } provides context fields vmId (current VM identifier), running (running state), request (transport capability bound to identity/authority scope), onSubmitted (onSubmitted state)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function PackageWorkbenchPanel({ vmId, running, request, onSubmitted }: {
  vmId: string; running: boolean; request: Request; onSubmitted: /** 中文：在包任务提交后通知父级核对索引或任务状态；这是 PackageWorkbenchPanel 的调用契约 | English: Notify the parent to reconcile indexes/job state after package-job submission; this is the callable contract of PackageWorkbenchPanel | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
}) {
  const [mode, setMode] = useState<Mode>('installed');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const action = useAction();
  const base = `/vms/${vmId}/packages`;
  const path = `${base}?mode=${mode}&query=${encodeURIComponent(query)}&page=${page}&limit=50`;
  const remote = useRemote<Listing>(request, path,
    running && (mode !== 'search' || query.length >= 2), 30_000);
  useEffect(/** 中文：当依赖 [vmId, mode, query] 变化时preview 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [vmId, mode, query] change, preview state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => { setPreview(null); }, [vmId, mode, query]);
  /**
   * 中文：在资源策略、软件包与工程任务的界面交互与状态呈现流程中mode 状态，编辑草稿，搜索或查询文本，页面选择；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In UI interaction and state presentation for resource policy, packages and engineering tasks, mode state, editing draft, search/query text, page selection. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：value：待校验、转换或保存的输入值
   * English: Inputs: value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const select = (value: Mode) => {
    setMode(value);
    setDraft('');
    setQuery('');
    setPage(1);
  };
  /**
   * 中文：提交 POST base，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST base for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：change：签名所示 Change 业务值；name：目标名称或文件名
   * English: Inputs: change: the Change domain value in the signature; name: target name/filename
   */
  const previewChange = (change: Change, name?: string) => void action.run(/** 中文：提交 POST base，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互并更新preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST base for UI interaction and state presentation for resource policy, packages and engineering tasks and update preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    const result = await request<Preview>(base, 'POST', { operation: 'preview', change,
      ...(name ? { name } : {}) }, signal);
    setPreview(result);
  });
  /**
   * 中文：提交 POST base，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST base for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const apply = () => {
    if (!preview) return;
    void action.run(/** 中文：提交 POST base，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互并更新preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST base for UI interaction and state presentation for resource policy, packages and engineering tasks and update preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      await request(base, 'POST', { operation: 'apply', token: preview.token }, signal);
      setPreview(null);
      onSubmitted();
      remote.reload();
    }, '软件包变更已提交；执行进度见下方任务日志。');
  };
  /**
   * 中文：提交 POST base，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST base for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const refreshIndex = () => void action.run(/** 中文：提交 POST base，完成资源策略、软件包与工程任务的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST base for UI interaction and state presentation for resource policy, packages and engineering tasks. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request(base, 'POST', { operation: 'refresh-index' }, signal);
    onSubmitted();
  }, '软件源索引更新任务已提交。');
  const listing = remote.data?.vmId === vmId && remote.data?.mode === mode &&
    remote.data?.query === query && remote.data?.page === page ? remote.data : null;
  const items = listing?.items || [];
  return <div className="feature-card" role="region" aria-label="发行版包管理器">
    <h4>发行版包管理器</h4>
    <p className="subtle-note">查看客户机已安装软件、搜索软件源和可升级版本。安装、卸载及升级需先复核发行版包管理器的模拟计划。</p>
    <Feedback error={remote.error || action.error} message={action.message} />
    <div className="inline-form">
      <label>视图
        <select value={mode} onChange={(event) => select(event.target.value as Mode)}>
          <option value="installed">已安装</option>
          <option value="search">搜索软件源</option>
          <option value="updates">可升级</option>
        </select>
      </label>
      <label>筛选或搜索
        <input value={draft} onChange={(event) => setDraft(event.target.value)}
          placeholder={mode === 'search' ? '至少输入 2 个字符' : '按软件包名称筛选'} />
      </label>
      <button className="secondary compact" disabled={!running || mode === 'search' && draft.trim().length < 2}
        onClick={() => { setQuery(draft.trim()); setPage(1); remote.reload(); }}>
        查询软件包
      </button>
      <button className="secondary compact" disabled={!running || action.busy}
        onClick={refreshIndex}>更新软件源索引</button>
      <button className="secondary compact" disabled={!running || !listing}
        onClick={() => remote.reload()}>刷新列表</button>
    </div>
    {listing?.warning && <p className="subtle-note" role="status">{listing.warning}</p>}
    {!running ? <p className="muted">启动发行版后查看软件包。</p> :
      mode === 'search' && query.length < 2 ?
        <p className="muted">输入至少 2 个字符并查询软件源。</p> :
        <>
          <p className="subtle-note">{listing?.manager === 'apk' ? 'Alpine apk' :
            listing?.manager === 'apt' ? 'Debian/Ubuntu apt' : '正在读取'} ·
            共 {listing?.total ?? 0} 项</p>
          <div className="package-workbench-list">
            {items.map((item) => <div className="package-workbench-row" key={item.name}>
              <div><strong>{item.name}</strong>
                <span className="subtle-note">{item.availableVersion
                  ? `${item.installedVersion} → ${item.availableVersion}` : item.version}</span>
                {item.description && <p className="subtle-note">{item.description}</p>}
              </div>
              <div className="inline-form">
                {mode === 'installed' && <button className="secondary compact"
                  disabled={action.busy} onClick={() => previewChange('remove', item.name)}>
                  卸载
                </button>}
                {mode === 'search' && <button className="secondary compact"
                  disabled={action.busy} onClick={() => previewChange('install', item.name)}>
                  安装
                </button>}
                {mode === 'updates' && <button className="secondary compact"
                  disabled={action.busy} onClick={() => previewChange('upgrade', item.name)}>
                  升级
                </button>}
              </div>
            </div>)}
          </div>
          {listing && items.length === 0 && <p className="muted">没有匹配的软件包。</p>}
          <div className="inline-form">
            <button className="secondary compact" disabled={page <= 1}
              onClick={() => setPage(page - 1)}>上一页</button>
            <span>第 {page} 页</span>
            <button className="secondary compact" disabled={!listing?.hasMore}
              onClick={() => setPage(page + 1)}>下一页</button>
            {mode === 'updates' && (listing?.total ?? 0) > 0 &&
              <button className="secondary compact" disabled={action.busy}
                onClick={() => previewChange('upgrade-all')}>预览全部升级</button>}
          </div>
        </>}
    {preview && <div className="feature-card" role="region" aria-label="软件包变更预览">
      <h5>确认{preview.change === 'install' ? '安装' : preview.change === 'remove' ? '卸载' : '升级'}
        {preview.name ? ` ${preview.name}` : '全部软件包'}</h5>
      <pre className="feature-log" aria-label="软件包模拟计划">{preview.plan}</pre>
      <button className="secondary compact" disabled={action.busy || Date.now() >= preview.expiresAt}
        onClick={apply}>确认执行此计划</button>
      <button className="secondary compact" onClick={() => setPreview(null)}>取消</button>
    </div>}
  </div>;
}
