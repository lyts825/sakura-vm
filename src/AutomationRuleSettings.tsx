import { formatDateTime } from './localization';
import { useState } from 'react';
import type { AutomationRule, AutomationView } from '../server/automation-rules';
import {
  webhookAlertKinds, webhookJobStatuses, webhookTypes,
  type WebhookEvent,
} from '../shared/webhooks';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './features.css';

type Draft = Pick<AutomationRule, 'name' | 'enabled' | 'previewOnly' | 'filter' | 'action' | 'steps' | 'cooldownSeconds'>;
type Preview = { rule: AutomationRule; matches: Array<{
  event: WebhookEvent; targetVmId: string | null; action: Draft['action']; wouldExecute: boolean;
}>; approval?: string };
const fresh = (): Draft => ({
  name: '', enabled: false, previewOnly: true, action: 'start', steps: [], cooldownSeconds: 300,
  filter: { types: ['alert.raised'], vmIds: [], projectIds: [], tags: [], statuses: [], kinds: [] },
});
const labels: Record<string, string> = {
  'job.finished': '任务完成', 'alert.raised': '新告警',
  done: '成功', error: '失败', cancelled: '已取消', interrupted: '中断',
  cpu: 'CPU', memory: '内存', disk: '磁盘', service: '服务',
  backup: '备份', task: '任务', secret: '密钥轮换',
  start: '启动实例', stop: '正常停止实例', suspend: '暂停实例', resume: '恢复实例',
  runbook: '自动修复 Runbook',
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
    setDraft({ name: rule.name, enabled: rule.enabled,
      previewOnly: rule.action === 'runbook' ? true : rule.previewOnly,
      filter: rule.filter, action: rule.action, steps: rule.steps, cooldownSeconds: rule.cooldownSeconds });
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
      rule: { ...draft, previewOnly: draft.action === 'runbook' ? true : draft.previewOnly,
        filter: { ...draft.filter,
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
  const approve = () => void action.run(async (signal) => {
    if (!preview?.approval || preview.rule.action !== 'runbook') return;
    const rule = preview.rule;
    await request('/automation-rules', 'POST', { operation: 'save', id: rule.id,
      version: rule.version, approval: preview.approval,
      rule: { name: rule.name, enabled: true, previewOnly: false, filter: rule.filter,
        action: rule.action, steps: rule.steps, cooldownSeconds: rule.cooldownSeconds } }, signal);
    clear();
    remote.reload();
  }, '已批准并启用自动修复');
  return <section className="system-card automation-rule-settings" aria-label="事件自动化规则">
    <div className="panel-heading">
      <div><h3>事件自动化规则</h3><p>根据任务和告警事件执行实例操作或修复 Runbook。新规则默认只预览。</p></div>
      <button className="secondary compact" onClick={remote.reload}>刷新</button>
    </div>
    <Feedback error={action.error || remote.error || remote.data?.error} message={action.message} />
    <div className="feature-card">
      <h4>{editing ? '编辑规则' : '新建规则'}</h4>
      <div className="shortcut-fields">
        <label>规则名称<input value={draft.name} maxLength={64}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>实例操作<select value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value as Draft['action'],
            steps: e.target.value === 'runbook' ? draft.steps : [] })}>
          {(['start', 'stop', 'suspend', 'resume', 'runbook'] as const).map((value) =>
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
      {draft.action === 'runbook' && <div className="feature-card">
        <h4>修复步骤</h4>
        <p className="subtle-note">按顺序在匹配实例的项目目录执行 Shell 命令；任一步骤失败即停止。最多 8 步，总超时 600 秒。</p>
        {draft.steps.map((step, index) => <div key={index} className="shortcut-fields">
          <label>步骤名称<input value={step.name} maxLength={80}
            onChange={(e) => setDraft({ ...draft, steps: draft.steps.map((item, at) =>
              at === index ? { ...item, name: e.target.value } : item) })} /></label>
          <label>Shell 命令<input value={step.command} maxLength={2048}
            onChange={(e) => setDraft({ ...draft, steps: draft.steps.map((item, at) =>
              at === index ? { ...item, command: e.target.value } : item) })} /></label>
          <label>超时秒数<input type="number" min={1} max={120} value={step.timeout}
            onChange={(e) => setDraft({ ...draft, steps: draft.steps.map((item, at) =>
              at === index ? { ...item, timeout: Number(e.target.value) } : item) })} /></label>
          <button className="secondary compact" onClick={() => setDraft({ ...draft,
            steps: draft.steps.filter((_, at) => at !== index) })}>移除步骤</button>
        </div>)}
        <button className="secondary compact" disabled={draft.steps.length >= 8}
          onClick={() => setDraft({ ...draft, steps: [...draft.steps,
            { name: '', command: '', timeout: 30 }] })}>添加步骤</button>
      </div>}
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
      <label className="check"><input type="checkbox" checked={draft.action !== 'runbook' && !draft.previewOnly}
        disabled={draft.action === 'runbook'}
        onChange={(e) => setDraft({ ...draft, previewOnly: !e.target.checked })} />
        实际执行实例操作（Runbook 需先保存、预览并单独批准）</label>
      <div className="feature-actions">
        <button className="primary compact" disabled={action.busy || !draft.name.trim() ||
          !draft.filter.types.length || (draft.action === 'runbook' && !draft.steps.length)} onClick={save}>保存规则</button>
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
      {preview.rule.action === 'runbook' && <div>
        <p>以下命令将在匹配实例的项目目录中顺序运行：</p>
        {preview.rule.steps.map((step, index) => <p key={index}>
          {index + 1}. {step.name} · {step.timeout} 秒 · <code>{step.command}</code>
        </p>)}
        {preview.rule.previewOnly && preview.approval && <button className="primary compact"
          disabled={action.busy} onClick={approve}>批准并启用自动修复</button>}
      </div>}
      {!preview.matches.length && <p>最近没有匹配事件。</p>}
      {preview.matches.map(({ event, action: operation, targetVmId, wouldExecute }) =>
        <p key={event.id}>{event.occurredAt} · {labels[event.type]} · {targetVmId || '无实例'} ·
          {labels[operation]} · {wouldExecute ? '当前为执行模式，仍需通过冷却及实例检查' : '仅预览'}</p>)}
    </div>}
    <div className="feature-card"><h4>最近执行</h4>
      {!remote.data?.executions.length && <p className="subtle-note">尚无匹配事件。</p>}
      {remote.data?.executions.slice(0, 30).map((item) => <p key={item.id}>
        {formatDateTime(new Date(item.startedAt))} · {labels[item.action]} ·
        {item.vmId || '无实例'} · {labels[item.status] || item.status}
        {item.reason ? ` · ${item.reason}` : ''}
        {item.steps?.length ? ` · 步骤：${item.steps.map((step) =>
          `${step.name}(${step.code === -1 ? '跳过' : step.code})`).join('、')}` : ''}
      </p>)}
    </div>
  </section>;
}
