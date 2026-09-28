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

export function PackageWorkbenchPanel({ vmId, running, request, onSubmitted }: {
  vmId: string; running: boolean; request: Request; onSubmitted: () => void;
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
  useEffect(() => { setPreview(null); }, [vmId, mode, query]);
  const select = (value: Mode) => {
    setMode(value);
    setDraft('');
    setQuery('');
    setPage(1);
  };
  const previewChange = (change: Change, name?: string) => void action.run(async (signal) => {
    const result = await request<Preview>(base, 'POST', { operation: 'preview', change,
      ...(name ? { name } : {}) }, signal);
    setPreview(result);
  });
  const apply = () => {
    if (!preview) return;
    void action.run(async (signal) => {
      await request(base, 'POST', { operation: 'apply', token: preview.token }, signal);
      setPreview(null);
      onSubmitted();
      remote.reload();
    }, '软件包变更已提交；执行进度见下方任务日志。');
  };
  const refreshIndex = () => void action.run(async (signal) => {
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
