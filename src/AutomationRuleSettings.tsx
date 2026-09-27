import { useState } from 'react';
import type { AutomationRule, AutomationView } from '../server/automation-rules';
import {
  webhookAlertKinds, webhookJobStatuses, webhookTypes,
  type WebhookEvent,
} from '../shared/webhooks';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './features.css';

type Draft = Pick<AutomationRule, 'name' | 'enabled' | 'previewOnly' | 'filter' | 'action' | 'cooldownSeconds'>;
type Preview = { rule: AutomationRule; matches: Array<{
  event: WebhookEvent; targetVmId: string | null; action: Draft['action']; wouldExecute: boolean;
}> };
const fresh = (): Draft => ({
  name: '', enabled: false, previewOnly: true, action: 'start', cooldownSeconds: 300,
  filter: { types: ['alert.raised'], vmIds: [], projectIds: [], tags: [], statuses: [], kinds: [] },
});
const labels: Record<string, string> = {
  'job.finished': '任务完成', 'alert.raised': '新告警',
  done: '成功', error: '失败', cancelled: '已取消', interrupted: '中断',
  cpu: 'CPU', memory: '内存', disk: '磁盘', service: '服务',
  backup: '备份', task: '任务', secret: '密钥轮换',
  start: '启动实例', stop: '正常停止实例', suspend: '暂停实例', resume: '恢复实例',
  preview: '仅预览', pending: '执行中', failed: '失败', skipped: '已跳过',
};
const split = (value: string) => [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];

export function AutomationRuleSettings({ request }: { request: Request }) {
  const remote = useRemote<AutomationView>(request, '/automation-rules', true, 5000);
  const action = useAction();
  const [draft, setDraft] = useState<Draft>(fresh);
  const [editing, setEditing] = useState<{ id: string; version: number }>();
  const [vmIds, setVmIds] = useState(''), [projects, setProjects] = useState(''),
    [tags, setTags] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const clear = () => {
    setDraft(fresh()); setEditing(undefined); setVmIds(''); setProjects(''); setTags(''); setPreview(null);
  };
  const edit = (rule: AutomationRule) => {
    setEditing({ id: rule.id, version: rule.version });
    setDraft({ name: rule.name, enabled: rule.enabled, previewOnly: rule.previewOnly,
      filter: rule.filter, action: rule.action, cooldownSeconds: rule.cooldownSeconds });
    setVmIds(rule.filter.vmIds.join(', '));
    setProjects(rule.filter.projectIds.join(', '));
    setTags(rule.filter.tags.join(', '));
    setPreview(null);
    action.clear();
  };
  const toggle = (field: 'types' | 'statuses' | 'kinds', value: string) => {
    const current = draft.filter[field] as string[];
    setDraft({ ...draft, filter: { ...draft.filter,
      [field]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    } });
  };
  const save = () => void action.run(async (signal) => {
    await request('/automation-rules', 'POST', {
      operation: 'save', ...editing,
      rule: { ...draft, filter: { ...draft.filter,
        vmIds: split(vmIds), projectIds: split(projects), tags: split(tags),
      } },
    }, signal);
    clear();
    remote.reload();
  }, '自动化规则已保存');
  const remove = (rule: AutomationRule) => void action.run(async (signal) => {
    await request('/automation-rules', 'POST',
      { operation: 'remove', id: rule.id, version: rule.version }, signal);
    if (editing?.id === rule.id) clear();
    remote.reload();
  }, '自动化规则已删除');
  const inspect = (rule: AutomationRule) => void action.run(async (signal) => {
    setPreview(await request<Preview>('/automation-rules', 'POST',
      { operation: 'preview', id: rule.id }, signal));
  });
  return <section className="system-card automation-rule-settings" aria-label="事件自动化规则">
    <div className="panel-heading">
      <div><h3>事件自动化规则</h3><p>根据任务和告警事件执行受限的实例操作。新规则默认只预览。</p></div>
      <button className="secondary compact" onClick={remote.reload}>刷新</button>
    </div>
    <Feedback error={action.error || remote.error || remote.data?.error} message={action.message} />
    <div className="feature-card">
      <h4>{editing ? '编辑规则' : '新建规则'}</h4>
      <div className="shortcut-fields">
        <label>规则名称<input value={draft.name} maxLength={64}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>实例操作<select value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value as Draft['action'] })}>
          {(['start', 'stop', 'suspend', 'resume'] as const).map((value) =>
            <option key={value} value={value}>{labels[value]}</option>)}</select></label>
        <label>冷却秒数<input type="number" min={60} max={86400} value={draft.cooldownSeconds}
          onChange={(e) => setDraft({ ...draft, cooldownSeconds: Number(e.target.value) })} /></label>
        <label>实例 ID（逗号分隔，留空表示全部）<input value={vmIds}
          onChange={(e) => setVmIds(e.target.value)} /></label>
        <label>项目 ID（逗号分隔）<input value={projects}
          onChange={(e) => setProjects(e.target.value)} /></label>
        <label>实例标签（逗号分隔，必须全部匹配）<input value={tags}
          onChange={(e) => setTags(e.target.value)} /></label>
      </div>
      <fieldset className="webhook-choices"><legend>事件类型</legend>
        {webhookTypes.map((value) => <label key={value} className="check">
          <input type="checkbox" checked={draft.filter.types.includes(value)}
            onChange={() => toggle('types', value)} />{labels[value]}</label>)}
      </fieldset>
      <fieldset className="webhook-choices"><legend>任务状态（留空表示全部）</legend>
        {webhookJobStatuses.map((value) => <label key={value} className="check">
          <input type="checkbox" checked={draft.filter.statuses.includes(value)}
            onChange={() => toggle('statuses', value)} />{labels[value]}</label>)}
      </fieldset>
      <fieldset className="webhook-choices"><legend>告警类型（留空表示全部）</legend>
        {webhookAlertKinds.map((value) => <label key={value} className="check">
          <input type="checkbox" checked={draft.filter.kinds.includes(value)}
            onChange={() => toggle('kinds', value)} />{labels[value]}</label>)}
      </fieldset>
      <label className="check"><input type="checkbox" checked={draft.enabled}
        onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />启用规则</label>
      <label className="check"><input type="checkbox" checked={!draft.previewOnly}
        onChange={(e) => setDraft({ ...draft, previewOnly: !e.target.checked })} />
        实际执行实例操作（取消勾选时只记录预览）</label>
      <div className="feature-actions">
        <button className="primary compact" disabled={action.busy || !draft.name.trim() ||
          !draft.filter.types.length} onClick={save}>保存规则</button>
        {editing && <button className="secondary compact" onClick={clear}>取消编辑</button>}
      </div>
    </div>
    <div className="feature-card"><h4>已保存规则</h4>
      {!remote.data?.rules.length && <p className="subtle-note">暂无规则。</p>}
      {remote.data?.rules.map((rule) => <div key={rule.id} className="automation-rule-row">
        <strong>{rule.name}</strong> · {labels[rule.action]} · {rule.enabled ?
          rule.previewOnly ? '预览中' : '实际执行' : '已停用'}
        <button className="secondary compact" disabled={action.busy} onClick={() => edit(rule)}>编辑</button>
        <button className="secondary compact" disabled={action.busy} onClick={() => inspect(rule)}>预览最近事件</button>
        <button className="secondary compact" disabled={action.busy} onClick={() => remove(rule)}>删除</button>
      </div>)}
    </div>
    {preview && <div className="feature-card"><h4>事件预览：{preview.rule.name}</h4>
      {!preview.matches.length && <p>最近没有匹配事件。</p>}
      {preview.matches.map(({ event, action: operation, targetVmId, wouldExecute }) =>
        <p key={event.id}>{event.occurredAt} · {labels[event.type]} · {targetVmId || '无实例'} ·
          {labels[operation]} · {wouldExecute ? '当前为执行模式，仍需通过冷却及实例检查' : '仅预览'}</p>)}
    </div>}
    <div className="feature-card"><h4>最近执行</h4>
      {!remote.data?.executions.length && <p className="subtle-note">尚无匹配事件。</p>}
      {remote.data?.executions.slice(0, 30).map((item) => <p key={item.id}>
        {new Date(item.startedAt).toLocaleString()} · {labels[item.action]} ·
        {item.vmId || '无实例'} · {labels[item.status] || item.status}
        {item.reason ? ` · ${item.reason}` : ''}
      </p>)}
    </div>
  </section>;
}
