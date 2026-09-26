import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function pluginState(status: PluginStatus, id: string) {
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

function surfaceLabels(plugin: PluginManifest) {
  return [
    ...plugin.contributes.pages.map((id) => `导航 · ${pageLabels[id] || plugin.name}`),
    ...plugin.contributes.tabs.map((id) => `实例 · ${tabLabels[id] || plugin.name}`),
    ...plugin.contributes.developmentSections.map((id) => `开发 · ${sectionLabels[id] || plugin.name}`),
  ];
}

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
  useEffect(() => {
    void load();
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [load]);
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
  const pluginName = (id: string) => status?.plugins.find((plugin) => plugin.id === id)?.name || id;
  const added = status?.planned.filter((id) => !status.active.includes(id)) || [];
  const removed = status?.active.filter((id) => !status.planned.includes(id)) || [];
  const affected = new Set([
    ...(status?.active || []),
    ...(status?.planned || []),
    ...Object.keys(status?.errors || {}),
  ]);
  const failed = status?.plugins.filter((plugin) => pluginState(status, plugin.id).tone === 'error') || [];
  const needle = query.trim().toLocaleLowerCase();
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
            所有插件均随 Sakura 提供。选择保存在本机，停用后数据仍保留。
          </p>
        </>
      )}
    </div>
  );
}
