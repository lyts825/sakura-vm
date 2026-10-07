/**
 * 模块职责（中文）：“实例整理”插件的实例分组、标签、收藏和批量操作页面，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for VM grouping, tags and batch operations.
 * 详细范围（中文）：公开入口包括 OrganizationCard, LibraryPanel, pages；职责覆盖实例分组、标签与批量操作的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include OrganizationCard, LibraryPanel, pages. The scope covers UI interaction and state presentation for VM grouping, tags and batch operations. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { embeddedPluginComponent } from '../../src/plugin-client';
import { Boxes, Inbox, Play, Save, Square, Star } from 'lucide-react';
import { Suspense, useState } from 'react';
import type { VMView } from '../../shared/contracts/vm.ts';
import type { Request } from '../../src/feature-shared';
import { Feedback, formatBytes, useAction } from '../../src/feature-shared';
import '../../src/features.css';
import { PluginGate } from '../../src/plugin-context';
import { PluginBoundary } from '../../src/plugin-boundary';
/**
 * 中文：懒加载 ../recipes/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../recipes/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadRecipeImporter = () =>
  import('../recipes/client').then((module) => ({ default: module.RecipeImporter }));

/**
 * 中文：呈现实例分组、标签与批量操作的界面交互与状态呈现中的 OrganizationCard 界面，组合 Star、Save，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the OrganizationCard surface for UI interaction and state presentation for VM grouping, tags and batch operations and composing Star, Save. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  vm,
  request,
  refresh,
  selected,
  toggle,
} 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、refresh（refresh 状态）、selected（当前选择）、toggle（toggle 状态） 上下文字段
 * English: Inputs: {
  vm,
  request,
  refresh,
  selected,
  toggle,
} provides context fields vm (vm state), request (transport capability bound to identity/authority scope), refresh (refresh state), selected (current selection), toggle (toggle state)
 */
export function OrganizationCard({
  vm,
  request,
  refresh,
  selected,
  toggle,
}: {
  vm: VMView;
  request: Request;
  refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 OrganizationCard 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of OrganizationCard | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
  selected: boolean;
  toggle: /** 中文：通知父级切换分组展开状态，不直接修改实例资源；这是 OrganizationCard 的调用契约 | English: Notify the parent to toggle group expansion without directly modifying VM resources; this is the callable contract of OrganizationCard | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void;
}) {
  const [group, setGroup] = useState(vm.organization?.group || ''),
    [tags, setTags] = useState(vm.organization?.tags.join(', ') || '');
  const action = useAction();
  /**
   * 中文：提交 PUT /vms/{vm.id}/organization，完成实例分组、标签与批量操作的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform PUT /vms/{vm.id}/organization for UI interaction and state presentation for VM grouping, tags and batch operations. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：favorite：此处理器的调用值（缺省 !!vm.organization?.favorite）
   * English: Inputs: favorite: the invocation value for this handler (default !!vm.organization?.favorite)
   */
  const save = (favorite = !!vm.organization?.favorite) =>
    action.run(/** 中文：提交 PUT /vms/{vm.id}/organization，完成实例分组、标签与批量操作的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PUT /vms/{vm.id}/organization for UI interaction and state presentation for VM grouping, tags and batch operations. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
      await request(`/vms/${vm.id}/organization`, 'PUT', {
        group,
        tags: tags
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean),
        favorite,
      });
      await refresh();
    }, '已保存');
  return (
    <div className="feature-card">
      <div className="panel-heading">
        <label className="checkbox-label">
          <input type="checkbox" checked={selected} onChange={toggle} />
          {vm.name}
        </label>
        <button
          className="icon-button"
          aria-label={`收藏 ${vm.name}`}
          aria-pressed={!!vm.organization?.favorite}
          disabled={action.busy}
          onClick={() => void save(!vm.organization?.favorite)}
        >
          <Star size={17} fill={vm.organization?.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      <p className="subtle-note">
        {vm.cpus} vCPU · {vm.memoryMiB} MiB ·{' '}
        {
          {
            running: '运行中',
            paused: '已暂停',
            stopped: '已停止',
            starting: '启动中',
            stopping: '停止中',
            error: '需要检查',
          }[vm.status]
        }
      </p>
      <label>
        项目分组
        <input value={group} maxLength={40} onChange={(e) => setGroup(e.target.value)} />
      </label>
      <label>
        标签（逗号分隔）
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      <button className="secondary compact" disabled={action.busy} onClick={() => void save()}>
        <Save size={14} />
        保存分组与标签
      </button>
      <Feedback error={action.error} message={action.message} />
    </div>
  );
}

/**
 * 中文：呈现实例分组、标签与批量操作的界面交互与状态呈现中的 LibraryPanel 界面，组合 Boxes、Play、Square、Inbox，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the LibraryPanel surface for UI interaction and state presentation for VM grouping, tags and batch operations and composing Boxes, Play, Square, Inbox. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  request,
  vms,
  refresh,
} 提供 request（带身份和权限作用域的传输能力）、vms（vms 状态）、refresh（refresh 状态） 上下文字段
 * English: Inputs: {
  request,
  vms,
  refresh,
} provides context fields request (transport capability bound to identity/authority scope), vms (vms state), refresh (refresh state)
 */
export function LibraryPanel({
  request,
  vms,
  refresh,
}: {
  request: Request;
  vms: VMView[];
  refresh: /** 中文：请求父级重新核对远端视图；完成异步刷新后才兑现返回值；这是 LibraryPanel 的调用契约 | English: Ask the parent to reconcile remote state and fulfill only after asynchronous refresh; this is the callable contract of LibraryPanel | 中文：结果：Promise<unknown>；调用者依赖此类型约定，Promise 拒绝表示异步失败 | English: Result: Promise<unknown>; callers depend on this type contract, with promise rejection representing asynchronous failure */ () => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [group, setGroup] = useState('all'),
    [query, setQuery] = useState(''),
    [favorites, setFavorites] = useState(false);
  const [results, setResults] = useState<{ id: string; ok: boolean; error?: string }[]>([]),
    action = useAction();
  const visible = vms
    .filter(
      (v) =>
        (group === 'all' || (v.organization?.group || '') === group) &&
        (!favorites || v.organization?.favorite) &&
        [v.name, ...(v.organization?.tags || [])].join(' ').toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => Number(!!b.organization?.favorite) - Number(!!a.organization?.favorite));
  const chosen = vms.filter((v) => selected.includes(v.id));
  /**
   * 中文：提交 POST /vms/batch，完成实例分组、标签与批量操作的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/batch for UI interaction and state presentation for VM grouping, tags and batch operations. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：kind：签名所示 'start' | 'stop' 业务值
   * English: Inputs: kind: the 'start' | 'stop' domain value in the signature
   */
  const batch = (kind: 'start' | 'stop') =>
    action.run(/** 中文：提交 POST /vms/batch，完成实例分组、标签与批量操作的界面交互与状态呈现的数据交互并更新results 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/batch for UI interaction and state presentation for VM grouping, tags and batch operations and update results state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
      const result = await request<{ results: { id: string; ok: boolean; error?: string }[] }>('/vms/batch', 'POST', { ids: chosen.map((v) => v.id), action: kind });
      setResults(result.results);
      await refresh();
    });
  return (
    <div className="content-panel feature-panel management-page">
      <div className="management-header">
        <div>
          <div className="eyebrow">
            <Boxes size={14} /> WORKSPACE ORGANIZER
          </div>
          <h2>实例管理</h2>
          <p className="muted">用分组、标签和批量操作整理本机 Linux 工作空间。</p>
        </div>
        <span className="page-status">
          <span className="tiny-dot" />
          {vms.length} 个实例
        </span>
      </div>
      <div className="feature-grid management-filters">
        <label>
          搜索名称或标签
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label>
          项目分组
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">全部分组</option>
            {[...new Set(vms.map((v) => v.organization?.group || ''))].map((name) => (
              <option key={name} value={name}>
                {name || '未分组'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="feature-actions">
        <label className="checkbox-label">
          <input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} />
          仅显示收藏
        </label>
        <button className="text-button" onClick={() => setSelected(visible.map((v) => v.id))}>
          选择当前列表
        </button>
        <button className="text-button" onClick={() => setSelected([])}>
          清空选择
        </button>
      </div>
      <div className="feature-card">
        <p>
          已选 {chosen.length} 个实例 · {chosen.reduce((sum, v) => sum + v.cpus, 0)} vCPU ·{' '}
          {formatBytes(chosen.reduce((sum, v) => sum + v.memoryMiB * 1024 ** 2, 0))} 内存
        </p>
        <div className="feature-actions">
          <button
            className="primary compact"
            disabled={!chosen.length || action.busy}
            onClick={() => void batch('start')}
          >
            <Play size={14} />
            批量启动
          </button>
          <button
            className="secondary compact"
            disabled={!chosen.length || action.busy}
            onClick={() => void batch('stop')}
          >
            <Square size={14} />
            批量停止
          </button>
        </div>
        <p className="subtle-note">最多同时运行 4 个实例；每个实例单独显示操作结果。</p>
        {results.map((result) => (
          <p key={result.id} className={result.ok ? 'feature-success' : 'danger-text'}>
            {vms.find((v) => v.id === result.id)?.name || result.id}：{result.ok ? '操作成功' : result.error}
          </p>
        ))}
        <Feedback error={action.error} />
      </div>
      <div className="feature-grid library-grid">
        {visible.map((vm) => (
          <OrganizationCard
            key={vm.id}
            vm={vm}
            request={request}
            refresh={refresh}
            selected={selected.includes(vm.id)}
            toggle={() =>
              setSelected((values) =>
                values.includes(vm.id) ? values.filter((v) => v !== vm.id) : [...values, vm.id],
              )
            }
          />
        ))}
      </div>
      {!visible.length && (
        <div className="management-empty">
          <span className="empty-icon">
            <Inbox size={24} />
          </span>
          <h3>没有匹配的实例</h3>
          <p>调整搜索、项目分组或收藏筛选后再试。</p>
        </div>
      )}
      <PluginGate id="recipes">
        <PluginBoundary identity="official:recipes" request={request} label="配方导入">
          {(scopedRequest, lifetime) => {
            const RecipeImporter = embeddedPluginComponent('recipes', 'recipe-importer', lifetime, loadRecipeImporter);
            return <Suspense fallback={<p role="status">正在加载配方导入…</p>}>
              <RecipeImporter request={scopedRequest} refresh={refresh} />
            </Suspense>;
          }}
        </PluginBoundary>
      </PluginGate>
    </div>
  );
}

export const pages = { library: LibraryPanel };
