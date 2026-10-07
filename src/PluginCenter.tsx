/**
 * 模块职责（中文）：展示插件/插件包依赖、启用选择、生命周期和恢复入口，提交用户的插件配置。
 * Module responsibility (English): Managing plugin selection, dependencies, lifecycle and recovery entry points.
 * 详细范围（中文）：公开入口包括 PluginCenter；职责覆盖管理插件选择、依赖、生命周期与恢复入口，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginCenter. The scope covers Managing plugin selection, dependencies, lifecycle and recovery entry points. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Clock3,
  FlaskConical,
  Layers,
  LoaderCircle,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-react';
import { emptySelection, type PluginManifest, type PluginStatus } from '../shared/plugins';
import { resolvePlugins } from '../shared/plugin-selection';
import type { Request } from './feature-shared';
import { pageLabels, sectionLabels, tabLabels } from './plugin-navigation';
import './plugins.css';
import { CommunityPluginCenter } from './CommunityPluginCenter';
import { PluginErrorBoundary } from './plugin-boundary';

/**
 * 中文：呈现管理插件选择、依赖、生命周期与恢复入口中的 DeferredRecoveryPanel 界面，组合 Panel，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the DeferredRecoveryPanel surface for Managing plugin selection, dependencies, lifecycle and recovery entry points and composing Panel. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
function DeferredRecoveryPanel({ request }: { request: Request }) {
  const [attempt, retry] = useState(0);
  const Panel = useMemo(/** 中文：在 memo 中创建恢复面板 lazy 组件，延后下载恢复代码并保持同一依赖周期内组件类型稳定。 | English: Create the recovery-panel lazy component inside memo, deferring its code download and retaining stable component identity within the dependency lifetime. */ () => lazy(/** 中文：在 memo 中创建恢复面板 lazy 组件，延后下载恢复代码并保持同一依赖周期内组件类型稳定。 | English: Create the recovery-panel lazy component inside memo, deferring its code download and retaining stable component identity within the dependency lifetime. */ () => import('./RecoveryPanel').then(module => ({ default: module.RecoveryPanel }))), [attempt]);
  return <PluginErrorBoundary key={attempt} label="资源恢复" retryLabel="重试恢复面板" retry={() => retry(value => value + 1)}>
    <Suspense fallback={<p role="status">正在加载恢复目录…</p>}>
      <Panel request={request} />
    </Suspense>
  </PluginErrorBoundary>;
}

const categories = {
  foundation: { label: '基础配套', icon: Layers },
  workspace: { label: '工作空间', icon: TerminalSquare },
  development: { label: '项目开发', icon: Wrench },
  operations: { label: '运维管理', icon: ShieldCheck },
  experimental: { label: '实验扩展', icon: FlaskConical },
};
type View = 'plugins' | 'packs' | 'selected';
type StateFilter = 'all' | 'active' | 'pending' | 'errors';
const stateLabels: Record<StateFilter, string> = {
  all: '全部状态',
  active: '运行中',
  pending: '待重启生效',
  errors: '启动异常',
};
const packOrder = [
  'essentials',
  'developer',
  'operations',
  'desktop',
  'development',
  'environment',
  'monitoring',
  'lab',
  'complete',
];
const categoryOrder = Object.keys(categories);
const systemServiceNames: Record<string, string> = {
  terminalSharing: '共享终端', browserExtensions: '浏览器扩展', memoryReclaim: '内存回收',
  gpuProfiles: 'GPU 配置', buildFarm: '构建任务', native: '原生集成', nativeClipboard: '原生剪贴板',
  assistant: '本地助手', webhooks: 'Webhook', automationRules: '自动化规则', retention: '日志保留',
  graph: 'GraphQL',
};

/**
 * 中文：为管理插件选择、依赖、生命周期与恢复入口构造包含 label、tone、icon 的局部数据对象，字段取自本次输入和明确默认值，供后续表单或状态流程使用
 * English: Build a local data object containing label, tone, icon for Managing plugin selection, dependencies, lifecycle and recovery entry points, using current inputs/explicit defaults for subsequent form/state processing
 * 中文：输入：status：签名所示 PluginStatus 业务值；id：目标资源标识
 * English: Inputs: status: the PluginStatus domain value in the signature; id: target resource identifier
 * 中文：结果：包含 label、tone、icon 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing label, tone, icon for caller state reads/operations
 */
function pluginState(status: PluginStatus, id: string) {
  const instance = status.runtime?.instances.find(item => item.source === 'official' && item.pluginId === id);
  if (instance?.phase === 'cleanup-pending') return { label: '清理待恢复', tone: 'error', icon: CircleAlert };
  if (instance?.phase === 'draining') return { label: '排空中', tone: 'pending', icon: Clock3 };
  if (instance?.phase === 'activating') return { label: '激活中', tone: 'pending', icon: Clock3 };
  const active = status.active.includes(id);
  const planned = status.planned.includes(id);
  if (status.errors[id] || ['failed', 'skipped'].includes(status.lifecycle?.[id]?.phase))
    return {
      label: status.lifecycle?.[id]?.phase === 'skipped' ? '依赖未就绪' : '启动失败',
      tone: 'error',
      icon: CircleAlert,
    };
  if (active && !planned) return { label: '待停用', tone: 'pending', icon: Clock3 };
  if (!active && planned) return { label: '待启用', tone: 'pending', icon: Clock3 };
  if (active) return { label: '运行中', tone: 'active', icon: CircleDot };
  return { label: '未启用', tone: 'idle', icon: Plus };
}

/**
 * 中文：把插件声明的页面、实例分区和开发分区转成分类显示标签，未知标签回退插件名。
 * English: Turn declared pages/VM tabs/development sections into categorized labels, falling back to the plugin name for unknown labels.
 * 中文：输入：plugin：签名所示 PluginManifest 业务值
 * English: Inputs: plugin: the PluginManifest domain value in the signature
 */
function surfaceLabels(plugin: PluginManifest) {
  return [
    ...plugin.contributes.pages.map((id) => `导航 · ${pageLabels[id] || plugin.name}`),
    ...plugin.contributes.tabs.map((id) => `实例 · ${tabLabels[id] || plugin.name}`),
    ...plugin.contributes.developmentSections.map((id) => `开发 · ${sectionLabels[id] || plugin.name}`),
  ];
}

/**
 * 中文：呈现管理插件选择、依赖、生命周期与恢复入口中的 PluginCenter 界面，组合 Puzzle、RefreshCw、CircleAlert、LoaderCircle、TerminalSquare、Check、ArrowUpRight、ArrowDownRight，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the PluginCenter surface for Managing plugin selection, dependencies, lifecycle and recovery entry points and composing Puzzle, RefreshCw, CircleAlert, LoaderCircle, TerminalSquare, Check, ArrowUpRight, ArrowDownRight. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function PluginCenter({ request }: { request: Request }) {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<View>('plugins');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const pending = useRef<AbortController | null>(null);
  /**
   * 中文：读取 GET /plugins，完成管理插件选择、依赖、生命周期与恢复入口的数据交互并更新忙碌标记、错误反馈、status 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform GET /plugins for Managing plugin selection, dependencies, lifecycle and recovery entry points and update busy flag, error feedback, status state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const load = useCallback(async () => {
    if (pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy('load');
    setError('');
    try {
      const data = await request<PluginStatus>('/plugins', 'GET', undefined, abort.signal);
      if (!abort.signal.aborted) setStatus(data);
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (pending.current === abort) {
        pending.current = null;
        setBusy('');
      }
    }
  }, [request]);
  useEffect(/** 中文：当依赖 [load] 变化时同步该依赖对应的本地派生状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [load] change, synchronize local derived state for these dependencies. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用 | English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary */ () => {
    void load();
    /**
     * 中文：在管理插件选择、依赖、生命周期与恢复入口流程中取消捕获的异步寿命；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
     * English: In Managing plugin selection, dependencies, lifecycle and recovery entry points, abort the captured asynchronous lifetime. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
     * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
     * English: Result: deliver through the described state/resource effects without returning business data
     */
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [load]);
  /**
   * 中文：提交 PATCH /plugins，完成管理插件选择、依赖、生命周期与恢复入口的数据交互并更新忙碌标记、错误反馈、notice 状态、status 状态；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform PATCH /plugins for Managing plugin selection, dependencies, lifecycle and recovery entry points and update busy flag, error feedback, notice state, status state. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：kind：签名所示 'plugin' | 'pack' 业务值；id：目标资源标识；enabled：是否启用本能力或读取流程
   * English: Inputs: kind: the 'plugin' | 'pack' domain value in the signature; id: target resource identifier; enabled: whether this capability/read flow is enabled
   * 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝
   * English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting
   * 中文：设计：成功和失败均执行 finally 释放本轮在途或资源标记，保持下一次调用可继续；释放与业务成功分别判断
   * English: Design: finally releases this pass's in-flight/resource markers after either success or failure, permitting future calls; resource release and business success are assessed separately
   * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
   * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
   */
  const change = async (kind: 'plugin' | 'pack', id: string, enabled: boolean) => {
    if (pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(`${kind}:${id}`);
    setError('');
    setNotice('');
    try {
      const next = await request<PluginStatus>('/plugins', 'PATCH', { kind, id, enabled }, abort.signal);
      if (!abort.signal.aborted) {
        setStatus(next);
        const name =
          (kind === 'plugin' ? next.plugins : next.packs).find((item) => item.id === id)?.name || id;
        setNotice(
          `${name}的选择已保存${next.restartRequired ? '，重启 Sakura 后生效。' : '。当前运行配置无需重启。'}`,
        );
      }
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (pending.current === abort) {
        pending.current = null;
        setBusy('');
      }
    }
  };
  const packContents = useMemo(
    () =>
      new Map(
        status?.packs.map((pack) => [
          pack.id,
          resolvePlugins({ ...emptySelection(), packs: [pack.id] }, status.plugins, status.packs),
        ]),
      ),
    [status],
  );
  /**
   * 中文：在管理插件选择、依赖、生命周期与恢复入口流程中服务端视图，搜索或查询文本，category 状态，stateFilter 状态，moreOptionsOpen 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Managing plugin selection, dependencies, lifecycle and recovery entry points, server view, search/query text, category state, stateFilter state, moreOptionsOpen state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：next：待采用的新状态或数据
   * English: Inputs: next: new state/data to adopt
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const chooseView = (next: View) => {
    setView(next);
    setQuery('');
    setCategory('all');
    setStateFilter('all');
    setMoreOptionsOpen(false);
  };
  const filterSummary = [
    category !== 'all' ? categories[category as keyof typeof categories].label : '',
    stateFilter !== 'all' ? stateLabels[stateFilter] : '',
  ]
    .filter(Boolean)
    .join(' · ');
  /**
   * 中文：从当前目录按插件 ID 查名称，未找到时保留 ID 用于解释依赖与迁移。
   * English: Find a plugin name in the current catalog by ID, retaining the ID when absent for dependency/migration explanations.
   * 中文：输入：id：目标资源标识
   * English: Inputs: id: target resource identifier
   */
  const pluginName = (id: string) => status?.plugins.find((plugin) => plugin.id === id)?.name || id;
  const added = status?.planned.filter((id) => !status.active.includes(id)) || [];
  const removed = status?.active.filter((id) => !status.planned.includes(id)) || [];
  const affected = new Set([
    ...(status?.active || []),
    ...(status?.planned || []),
    ...Object.keys(status?.errors || {}),
  ]);
  const failed = status?.plugins.filter((plugin) => pluginState(status, plugin.id).tone === 'error') || [];
  const failedSystemServices = status?.runtime?.instances.filter(instance =>
    instance.source === 'system' && (['failed', 'cleanup-pending'].includes(instance.phase) ||
      (instance.phase === 'inactive' && !!instance.error))) || [];
  const needle = query.trim().toLocaleLowerCase();
  /**
   * 中文：根据  判断管理插件选择、依赖、生命周期与恢复入口中的输入或条目是否符合条件，返回布尔判断供调用者筛选/保护分支
   * English: Evaluate  to test inputs/entries in Managing plugin selection, dependencies, lifecycle and recovery entry points, returning a boolean for filtering/guard branches
   * 中文：输入：values：签名所示 string[] 业务值
   * English: Inputs: values: the string[] domain value in the signature
   */
  const matches = (values: string[]) => values.join(' ').toLocaleLowerCase().includes(needle);
  const plugins =
    status?.plugins
      .filter((plugin) => {
        const state = pluginState(status, plugin.id);
        return (
          (view !== 'selected' || affected.has(plugin.id)) &&
          (category === 'all' || plugin.category === category) &&
          (stateFilter === 'all' ||
            (stateFilter === 'active' && status.active.includes(plugin.id)) ||
            (stateFilter === 'pending' && (added.includes(plugin.id) || removed.includes(plugin.id))) ||
            (stateFilter === 'errors' && state.tone === 'error')) &&
          matches([plugin.id, plugin.name, plugin.description, categories[plugin.category].label])
        );
      })
      .sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category)) || [];
  const packs =
    status?.packs
      .filter(
        (pack) =>
          (view !== 'selected' || status.selection.packs.includes(pack.id)) &&
          matches([
            pack.id,
            pack.name,
            pack.description,
            ...(packContents.get(pack.id) || []).map(pluginName),
          ]),
      )
      .sort(
        (a, b) =>
          (packOrder.indexOf(a.id) < 0 ? packOrder.length : packOrder.indexOf(a.id)) -
          (packOrder.indexOf(b.id) < 0 ? packOrder.length : packOrder.indexOf(b.id)),
      ) || [];

  /**
   * 中文：按显式选择、计划、活动状态和依赖根渲染插件卡片；仍被其他根需要的插件不能简单取消，入口同时显示贡献、风险和权限信息。
   * English: Render a plugin card from explicit selection, plan, active state and dependency roots. A plugin still required by other roots cannot simply be deselected; show contributions/risks/authority information.
   * 中文：输入：plugin：签名所示 PluginManifest 业务值
   * English: Inputs: plugin: the PluginManifest domain value in the signature
   */
  const renderPlugin = (plugin: PluginManifest) => {
    if (!status) return null;
    const selected = status.selection.plugins.includes(plugin.id);
    const planned = status.planned.includes(plugin.id);
    const active = status.active.includes(plugin.id);
    const state = pluginState(status, plugin.id);
    const CategoryIcon = categories[plugin.category].icon;
    const roots = (status.reasons[plugin.id] || []).filter(
      (root) => root.kind !== 'plugin' || root.id !== plugin.id,
    );
    const rootNames = roots.map(
      (root) =>
        (root.kind === 'plugin' ? status.plugins : status.packs).find((item) => item.id === root.id)?.name ||
        root.id,
    );
    const blocked = selected && roots.length > 0;
    const surfaces = surfaceLabels(plugin);
    return (
      <article
        className={`plugin-card ${planned ? 'is-selected' : ''}`}
        key={plugin.id}
        aria-label={plugin.name}
      >
        <div className="plugin-card-heading">
          <span className={`plugin-icon category-${plugin.category}`}>
            <CategoryIcon size={20} />
          </span>
          <span className={`plugin-state ${state.tone}`}>
            <state.icon size={12} />
            {state.label}
          </span>
        </div>
        <div>
          <div className="plugin-card-title">
            <h3>{plugin.name}</h3>
            {plugin.experimental && <span className="plugin-experimental">实验</span>}
          </div>
          <p className="plugin-description">{plugin.description}</p>
        </div>
        <div className="plugin-selection-source">
          {selected && (
            <span>
              <Check size={12} />
              独立选择
            </span>
          )}
          {rootNames.length > 0 && (
            <span>
              <Layers size={12} />由 {rootNames.join('、')} 引入
            </span>
          )}
          {!planned && <span>{active ? '重启后停止加载，数据保留' : '按需启用 · 自动补齐必需依赖'}</span>}
        </div>
        {state.tone === 'error' && (
          <p className="plugin-inline-error">
            {status.errors[plugin.id] || '依赖插件未能启动，请检查依赖状态。'}
          </p>
        )}
        <details className="plugin-details">
          <summary aria-label={`${plugin.name}的更多选项`}>
            更多选项 <span>功能与依赖</span>
          </summary>
          <dl>
            <dt>功能入口</dt>
            <dd>{surfaces.length ? surfaces.join('、') : '为已有界面或后台服务提供配套能力'}</dd>
            <dt>必需依赖</dt>
            <dd>
              {plugin.requires.length
                ? plugin.requires.map((pin) => pluginName(pin.id)).join('、')
                : '可独立启用'}
            </dd>
            {plugin.optional.length > 0 && (
              <>
                <dt>可选配套</dt>
                <dd>{plugin.optional.map((pin) => pluginName(pin.id)).join('、')}（需另行选择）</dd>
              </>
            )}
            <dt>当前进程</dt>
            <dd>
              {active ? '运行中' : '未运行'}
              {status.lifecycle?.[plugin.id]?.phase === 'active' &&
                ` · 启动耗时 ${status.lifecycle[plugin.id].activationMs} ms`}
            </dd>
            <dt>下次启动</dt>
            <dd>{planned ? '加载此插件' : '不加载此插件'}</dd>
            <dt>插件版本</dt>
            <dd>
              <code>{plugin.id}</code> · v{plugin.version}
            </dd>
          </dl>
          {planned && !selected && (
            <div className="plugin-independent-option">
              <p>需要在移除整合包或来源插件后继续使用？可以保留为独立选择。</p>
              <button
                className="secondary compact"
                disabled={!!busy}
                onClick={() => void change('plugin', plugin.id, true)}
              >
                {busy === `plugin:${plugin.id}` ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Plus size={14} />
                )}
                保留为独立选择
              </button>
            </div>
          )}
        </details>
        <div className="plugin-card-footer">
          {blocked && <small>先移除引用来源：{rootNames.join('、')}。</small>}
          {planned && !selected ? (
            <span className="plugin-included-note">
              <Check size={14} />
              随来源启用
            </span>
          ) : (
            <button
              className={`${planned ? 'secondary' : 'primary'} compact`}
              disabled={!!busy || blocked}
              onClick={() => void change('plugin', plugin.id, !selected)}
            >
              {busy === `plugin:${plugin.id}` ? (
                <LoaderCircle size={14} className="spin" />
              ) : selected ? (
                <Check size={14} />
              ) : (
                <Plus size={14} />
              )}
              {blocked ? '被其他选择引用' : selected ? '取消独立选择' : '启用插件'}
            </button>
          )}
          {!blocked && (
            <small>
              {selected ? '停用后保留数据' : planned ? '可在更多选项中独立保留' : `v${plugin.version}`}
            </small>
          )}
        </div>
      </article>
    );
  };
  /**
   * 中文：预解析切换插件包后的选择，显示新增/移除和仍由其他选择保留的成员；卡片预览不直接改变服务生命周期。
   * English: Pre-resolve selection after toggling a pack and show added/removed members plus those retained by other roots; card preview does not directly change service lifetimes.
   * 中文：输入：pack：签名所示 PluginStatus['packs'][number] 业务值
   * English: Inputs: pack: the PluginStatus['packs'][number] domain value in the signature
   */
  const renderPack = (pack: PluginStatus['packs'][number]) => {
    if (!status) return null;
    const selected = status.selection.packs.includes(pack.id);
    const resolved = packContents.get(pack.id) || [];
    const next = resolvePlugins(
      {
        ...status.selection,
        packs: selected
          ? status.selection.packs.filter((id) => id !== pack.id)
          : [...status.selection.packs, pack.id],
      },
      status.plugins,
      status.packs,
    );
    const changed = selected
      ? status.planned.filter((id) => !next.includes(id))
      : next.filter((id) => !status.planned.includes(id));
    const retained = resolved.filter((id) => next.includes(id));
    const experimental = resolved.filter(
      (id) => status.plugins.find((plugin) => plugin.id === id)?.experimental,
    );
    return (
      <article
        className={`plugin-card plugin-pack ${selected ? 'is-selected' : ''}`}
        key={pack.id}
        aria-label={pack.name}
      >
        <div className="plugin-card-heading">
          <span className="plugin-icon">
            <Boxes size={22} />
          </span>
          <span className={`plugin-state ${selected ? 'active' : 'idle'}`}>
            {selected && <Check size={12} />}
            {selected ? '已选择' : '整合包'}
          </span>
        </div>
        <div>
          <h3>{pack.name}</h3>
          <p className="plugin-description">{pack.description}</p>
        </div>
        <div className="plugin-pack-members">
          {pack.members.slice(0, 5).map((pin) => (
            <span key={`${pin.kind}:${pin.id}`}>
              {pin.kind === 'pack' && <Boxes size={12} />}
              {(pin.kind === 'pack' ? status.packs : status.plugins).find((item) => item.id === pin.id)
                ?.name || pin.id}
            </span>
          ))}
          {pack.members.length > 5 && <span>另 {pack.members.length - 5} 项</span>}
        </div>
        <details className="plugin-details">
          <summary aria-label={`${pack.name}的更多选项`}>
            更多选项 <span>含依赖共 {resolved.length} 个插件</span>
          </summary>
          <p>{resolved.map(pluginName).join('、')}</p>
          {selected && retained.length > 0 && (
            <p>移除此整合包后仍保留：{retained.map(pluginName).join('、')}。</p>
          )}
        </details>
        {experimental.length > 0 && (
          <p className="plugin-experiment-note">
            <FlaskConical size={13} />含 {experimental.length} 个实验插件
          </p>
        )}
        <div className="plugin-card-footer">
          <small>
            {selected ? `移除后减少 ${changed.length} 个计划插件` : `选用后新增 ${changed.length} 个计划插件`}
          </small>
          <button
            className={`${selected ? 'secondary' : 'primary'} compact`}
            disabled={!!busy}
            onClick={() => void change('pack', pack.id, !selected)}
          >
            {busy === `pack:${pack.id}` ? (
              <LoaderCircle size={14} className="spin" />
            ) : selected ? (
              <Check size={14} />
            ) : (
              <Plus size={14} />
            )}
            {selected ? '移除整合包' : '选用整合包'}
          </button>
        </div>
      </article>
    );
  };
  return (
    <div className="plugins-page">
      <div className="page-heading plugin-page-heading">
        <div>
          <div className="eyebrow">
            <Puzzle size={14} /> MAKE ROOM FOR POSSIBILITY
          </div>
          <h1>
            让工作空间，<span className="accent-text">按需生长。</span>
          </h1>
          <p>从一个终端开始，选择适合你的工具，组合自己的 Sakura。</p>
        </div>
        <button
          className="secondary compact"
          disabled={!!busy}
          onClick={() => void load()}
          aria-label="刷新插件状态"
        >
          <RefreshCw size={14} className={busy === 'load' ? 'spin' : ''} />
          刷新状态
        </button>
      </div>
      <div className="plugin-feedback" aria-live="polite">
        {notice}
      </div>
      {error && (
        <div className="plugin-error-banner" role="alert">
          <CircleAlert size={18} />
          <p>{error}</p>
          <button className="secondary compact" disabled={!!busy} onClick={() => void load()}>
            重新读取
          </button>
        </div>
      )}
      {!status ? (
        <div className="plugin-empty" role="status">
          {busy ? <LoaderCircle size={28} className="spin" /> : <CircleAlert size={28} />}
          <h2>{busy ? '正在读取插件目录…' : '暂时无法读取插件'}</h2>
          <p>{busy ? '正在获取当前运行状态与下次启动配置。' : '请检查服务连接，然后重新读取。'}</p>
        </div>
      ) : (
        <>
          <div className="plugin-overview">
            <div className="plugin-core">
              <span className="plugin-core-icon">
                <TerminalSquare size={23} />
              </span>
              <div>
                <h2>
                  轻盈的起点{' '}
                  <span>
                    <Check size={12} />
                    始终可用
                  </span>
                </h2>
                <p>Linux 实例、单终端与基础配置，开箱即用。</p>
              </div>
            </div>
            <div className="plugin-summary" aria-label="插件配置概览">
              <div>
                <b>{status.active.length}</b>
                <span>个插件运行中</span>
              </div>
              <div>
                <b>{status.planned.length}</b>
                <span>下次启动加载</span>
              </div>
              <div>
                <b>{status.selection.packs.length}</b>
                <span>已选整合包</span>
              </div>
            </div>
          </div>
          {failedSystemServices.length > 0 && (
            <div className="plugin-error-banner" role="alert">
              <CircleAlert size={18} />
              <div>
                <h3>附属服务暂时不可用</h3>
                <p>基础管理仍可使用。检查下列诊断，修复配置后用原启动命令重启 Sakura。</p>
                <ul>
                  {failedSystemServices.map(instance => (
                    <li key={instance.identity}>
                      <b>{systemServiceNames[instance.pluginId] || instance.pluginId}</b>（{instance.pluginId}）
                      ：{instance.phase === 'cleanup-pending' ? '清理待确认' :
                        instance.phase === 'inactive' ? '已清理，等待重启' : '启动失败'}
                      {instance.error && <p>{instance.error}</p>}
                    </li>
                  ))}
                </ul>
                {failedSystemServices.some(instance => instance.phase === 'cleanup-pending') &&
                  <p>清理待确认的服务保留原实例及依赖资源；请先在资源恢复面板处理清理，再重启。</p>}
                <p>刷新浏览器不会重新加载服务。原配置文件保留，未自动重置。</p>
              </div>
            </div>
          )}
          {status.restartRequired && (
            <div className="plugin-restart" role="status">
              <span className="plugin-restart-icon">
                <RefreshCw size={19} />
              </span>
              <div>
                <h3>选择已保存，重启 Sakura 后生效</h3>
                <p>
                  新增 {added.length} 个 · 停用 {removed.length} 个。当前会话继续使用运行中的插件。
                </p>
                <details>
                  <summary>查看变更与重启方式</summary>
                  {added.length > 0 && (
                    <p>
                      <ArrowUpRight size={13} />
                      下次加载：{added.map(pluginName).join('、')}
                    </p>
                  )}
                  {removed.length > 0 && (
                    <p>
                      <ArrowDownRight size={13} />
                      下次停用：{removed.map(pluginName).join('、')}
                    </p>
                  )}
                  <p>
                    在运行 Sakura 的终端按 Ctrl+C，等待退出后，用原启动命令重新运行（例如 npm start 或 npm run
                    dev）。刷新浏览器不会重启服务。
                  </p>
                  <p>重启会停止正在运行的实例；停用插件会保留实例、文件和插件配置。</p>
                </details>
              </div>
            </div>
          )}
          {failed.length > 0 && (
            <div className="plugin-error-banner" role="alert">
              <CircleAlert size={18} />
              <p>
                {failed.length} 个插件未能启动：{failed.map((plugin) => plugin.name).join('、')}。
              </p>
              <button
                className="secondary compact"
                onClick={() => {
                  chooseView('plugins');
                  setStateFilter('errors');
                  setMoreOptionsOpen(true);
                }}
              >
                查看异常
              </button>
            </div>
          )}
          {status.migrations.map((message) => (
            <p key={message} className="plugin-migration">
              {message}
            </p>
          ))}
          <div className="plugin-catalog-bar">
            <div className="plugin-views" role="group" aria-label="插件浏览方式">
              {(
                [
                  ['plugins', '插件目录', status.plugins.length, Puzzle],
                  ['packs', '整合包', status.packs.length, Boxes],
                  ['selected', '我的配置', affected.size, Check],
                ] as const
              ).map(([id, label, count, Icon]) => (
                <button key={id} aria-pressed={view === id} onClick={() => chooseView(id)}>
                  <Icon size={15} />
                  {label}
                  <span>{count}</span>
                </button>
              ))}
            </div>
            <label className="plugin-search">
              <Search size={16} />
              <input
                type="search"
                aria-label="搜索插件或整合包"
                placeholder={view === 'packs' ? '搜索整合包或成员…' : '搜索名称、用途或标识…'}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button aria-label="清除搜索" onClick={() => setQuery('')}>
                  <X size={14} />
                </button>
              )}
            </label>
          </div>
          {view !== 'packs' && (
            <div className="plugin-more-options">
              <button
                className="plugin-options-trigger"
                aria-label="插件筛选更多选项"
                aria-expanded={moreOptionsOpen}
                aria-controls="plugin-filters"
                onClick={() => setMoreOptionsOpen((open) => !open)}
              >
                <SlidersHorizontal size={14} />
                更多选项
                <span className={filterSummary ? 'has-filters' : ''}>
                  {filterSummary || '用途与运行状态'}
                </span>
                <ChevronDown size={14} className="plugin-options-chevron" />
              </button>
              <div className="plugin-filters" id="plugin-filters" hidden={!moreOptionsOpen}>
                <div className="plugin-categories" role="group" aria-label="按用途查看">
                  {[['all', '全部'], ...Object.entries(categories).map(([id, item]) => [id, item.label])].map(
                    ([id, label]) => (
                      <button key={id} aria-pressed={category === id} onClick={() => setCategory(id)}>
                        {label}
                      </button>
                    ),
                  )}
                </div>
                <div className="plugin-filter-actions">
                  <select
                    value={stateFilter}
                    aria-label="按插件状态筛选"
                    onChange={(event) => setStateFilter(event.target.value as StateFilter)}
                  >
                    {Object.entries(stateLabels).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {filterSummary && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setCategory('all');
                        setStateFilter('all');
                      }}
                    >
                      重置筛选
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="plugin-results-heading">
            <p>
              {view === 'packs'
                ? '按场景组合，必需依赖自动补齐；共享插件只加载一次。'
                : view === 'selected'
                  ? '独立选择与整合包共同决定下次启动的插件。'
                  : '随当前版本提供，按需启用。可选配套需另行选择。'}
            </p>
            <span role="status">
              {view === 'packs' ? packs.length : plugins.length} 个{view === 'packs' ? '整合包' : '插件'}
            </span>
          </div>
          {view === 'selected' && packs.length > 0 && category === 'all' && stateFilter === 'all' && (
            <section aria-label="已选整合包">
              <h2 className="plugin-section-heading">已选整合包</h2>
              <div className="plugin-grid">{packs.map(renderPack)}</div>
              <h2 className="plugin-section-heading">插件与依赖</h2>
            </section>
          )}
          {(view === 'packs' ? packs.length === 0 : plugins.length === 0) ? (
            <div className="plugin-empty">
              <Puzzle size={30} />
              <h2>
                {view === 'selected' && affected.size === 0 ? '从基础版开始，也很好。' : '没有找到匹配的插件'}
              </h2>
              <p>
                {view === 'selected' && affected.size === 0
                  ? '终端与配置已就绪。需要更多功能时，可以选择插件或整合包。'
                  : '试试其他关键词，或清除筛选条件。'}
              </p>
              <button
                className="secondary compact"
                onClick={() => chooseView(view === 'selected' && affected.size === 0 ? 'plugins' : view)}
              >
                {view === 'selected' && affected.size === 0 ? '浏览插件目录' : '清除筛选'}
              </button>
            </div>
          ) : (
            <div className="plugin-grid">
              {view === 'packs' ? packs.map(renderPack) : plugins.map(renderPlugin)}
            </div>
          )}
          <p className="plugin-footnote">
            <ShieldCheck size={14} />
            上方为随 Sakura 提供的内置插件。选择保存在本机，停用后数据仍保留。
          </p>
          <DeferredRecoveryPanel request={request} />
          <CommunityPluginCenter request={request} />
        </>
      )}
    </div>
  );
}
