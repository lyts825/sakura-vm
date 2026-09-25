import { Boxes, Inbox, Play, Save, Square, Star } from 'lucide-react';
import { lazy, useState } from 'react';
import type { VMView } from '../../server/model';
import type { Request } from '../../src/feature-shared';
import { Feedback, formatBytes, useAction } from '../../src/feature-shared';
import '../../src/features.css';
import { PluginGate } from '../../src/plugin-context';
const RecipeImporter = lazy(() =>
  import('../recipes/client').then((module) => ({ default: module.RecipeImporter })),
);

export function OrganizationCard({
  vm,
  request,
  refresh,
  selected,
  toggle,
}: {
  vm: VMView;
  request: Request;
  refresh: () => Promise<unknown>;
  selected: boolean;
  toggle: () => void;
}) {
  const [group, setGroup] = useState(vm.organization?.group || ''),
    [tags, setTags] = useState(vm.organization?.tags.join(', ') || '');
  const action = useAction();
  const save = (favorite = !!vm.organization?.favorite) =>
    action.run(async () => {
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

export function LibraryPanel({
  request,
  vms,
  refresh,
}: {
  request: Request;
  vms: VMView[];
  refresh: () => Promise<unknown>;
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
  const batch = (kind: 'start' | 'stop') =>
    action.run(async () => {
      const result = await request('/vms/batch', 'POST', { ids: chosen.map((v) => v.id), action: kind });
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
        <RecipeImporter request={request} refresh={refresh} />
      </PluginGate>
    </div>
  );
}

export const pages = { library: LibraryPanel };
