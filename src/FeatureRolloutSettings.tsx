import { useState } from 'react';
import type { RolloutPolicy } from '../server/feature-rollouts';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './features.css';

type Draft = Pick<RolloutPolicy, 'pluginId' | 'enabled' | 'percentage' | 'cohortVersion'>;
type Decision = { pluginId: string; allowed: boolean; bucket: number | null;
  policy?: RolloutPolicy };
type RolloutView = {
  hostId: string;
  plugins: Array<Decision & { id: string; name: string }>;
  policies: RolloutPolicy[];
  selected: string[];
  active: string[];
};
const initial = (pluginId: string): Draft => ({
  pluginId, enabled: true, percentage: 100, cohortVersion: 'v1',
});

export function FeatureRolloutSettings({ request }: { request: Request }) {
  const remote = useRemote<RolloutView>(request, '/feature-rollouts', true, 5000);
  const action = useAction();
  const [draft, setDraft] = useState<Draft>(initial(''));
  const [preview, setPreview] = useState<Decision | null>(null);
  const pluginId = draft.pluginId || remote.data?.plugins[0]?.id || '';
  const plugin = remote.data?.plugins.find((item) => item.id === pluginId);
  const saved = remote.data?.policies.find((item) => item.pluginId === pluginId);
  const current = draft.pluginId === pluginId ? draft : saved ? {
    pluginId, enabled: saved.enabled, percentage: saved.percentage,
    cohortVersion: saved.cohortVersion,
  } : initial(pluginId);
  const choose = (id: string) => {
    const policy = remote.data?.policies.find((item) => item.pluginId === id);
    setDraft(policy ? { pluginId: id, enabled: policy.enabled,
      percentage: policy.percentage, cohortVersion: policy.cohortVersion } : initial(id));
    setPreview(null);
    action.clear();
  };
  const save = () => void action.run(async (signal) => {
    await request('/feature-rollouts', 'POST', {
      operation: 'save', ...(saved ? { revision: saved.revision } : {}), policy: current,
    }, signal);
    setPreview(null);
    remote.reload();
  }, '灰度策略已保存，重启 Sakura 服务后应用到插件启动');
  const remove = () => void action.run(async (signal) => {
    if (!saved) return;
    await request('/feature-rollouts', 'POST', {
      operation: 'remove', pluginId, revision: saved.revision,
    }, signal);
    setDraft(initial(pluginId));
    setPreview(null);
    remote.reload();
  }, '灰度策略已删除，重启 Sakura 服务后恢复默认启动');
  const inspect = () => void action.run(async (signal) => {
    setPreview(await request<Decision>('/feature-rollouts', 'POST',
      { operation: 'preview', policy: current }, signal));
  });
  return <section className="system-card feature-rollout-settings" aria-label="插件功能灰度">
    <div className="panel-heading">
      <div><h3>插件功能灰度</h3><p>按当前主机的稳定分桶决定插件是否启动；策略在下次服务启动时生效。</p></div>
      <button className="secondary compact" onClick={remote.reload}>刷新</button>
    </div>
    <Feedback error={action.error || remote.error} message={action.message} />
    <div className="feature-card">
      <div className="shortcut-fields">
        <div className="feature-rollout-field"><label htmlFor="rollout-plugin">插件</label>
          <select id="rollout-plugin" value={pluginId}
            onChange={(event) => choose(event.target.value)}>
            {remote.data?.plugins.map((item) => <option key={item.id} value={item.id}>
              {item.name} ({item.id})</option>)}
          </select>
        </div>
        <label>灰度版本<input value={current.cohortVersion} maxLength={64}
          onChange={(event) => { setDraft({ ...current, cohortVersion: event.target.value });
            setPreview(null); }} /></label>
        <label>放行比例（0–100%）<input type="number" min={0} max={100}
          value={current.percentage} onChange={(event) => {
            setDraft({ ...current, percentage: Number(event.target.value) }); setPreview(null);
          }} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={current.enabled}
        onChange={(event) => { setDraft({ ...current, enabled: event.target.checked });
          setPreview(null); }} />启用该插件的灰度策略</label>
      <p className="subtle-note">关闭开关或设置 0% 会在下次启动时跳过插件；没有策略时按插件中心的选择启动。</p>
      <p>当前服务：{plugin && remote.data?.active.includes(pluginId) ? '已激活' :
        remote.data?.selected.includes(pluginId) ? '未激活' : '未在插件中心选择'}；
        已保存策略的下次启动分桶：{plugin?.allowed ? '命中' : '未命中'}。
        {plugin?.bucket !== null && plugin?.bucket !== undefined &&
          ` 分桶值 ${plugin.bucket} / 10000。`}</p>
      {preview && <p>当前草稿预览：{preview.allowed ? '将命中' : '将跳过'}；
        分桶值 {preview.bucket} / 10000。</p>}
      <div className="feature-actions">
        <button className="secondary compact" disabled={action.busy || !pluginId ||
          !current.cohortVersion.trim() || current.percentage < 0 || current.percentage > 100}
          onClick={inspect}>预览当前主机</button>
        <button className="primary compact" disabled={action.busy || !pluginId ||
          !current.cohortVersion.trim() || current.percentage < 0 || current.percentage > 100}
          onClick={save}>保存灰度策略</button>
        {saved && <button className="secondary compact" disabled={action.busy}
          onClick={remove}>删除策略</button>}
      </div>
    </div>
  </section>;
}
