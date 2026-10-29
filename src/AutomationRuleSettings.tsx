/**
 * 模块职责（中文）：编辑事件自动化规则、筛选条件与动作，并提供执行预览和最近执行记录。
 * Module responsibility (English): Editing event rules, filtered actions, approvals and execution previews.
 * 详细范围（中文）：公开入口包括 AutomationRuleSettings；职责覆盖事件规则、筛选动作、审批与执行预览的编辑界面，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include AutomationRuleSettings. The scope covers Editing event rules, filtered actions, approvals and execution previews. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from './localization';
import { useId, useRef, useState } from 'react';
import type { AutomationRule, AutomationView } from '../server/automation-rules';
import {
  webhookAlertKinds, webhookJobStatuses, webhookTypes,
  type WebhookEvent,
} from '../shared/webhooks';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './features.css';
import './automation-rule-settings.css';

type Draft = Pick<AutomationRule, 'name' | 'enabled' | 'previewOnly' | 'filter' | 'action' | 'steps' | 'cooldownSeconds'>;
type Preview = { rule: AutomationRule; matches: Array<{
  event: WebhookEvent; targetVmId: string | null; action: Draft['action']; wouldExecute: boolean;
}>; approval?: string };
/**
 * 中文：构造新的禁用自动化规则草稿，附带默认事件、动作和筛选集合，不立即提交或启用。
 * English: Create a disabled automation-rule draft with default event/action/filter collections without submitting or activating it.
 * 中文：结果：Draft，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Draft carrying the described computation/transport result; throwing branches do not provide success
 */
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
/**
 * 中文：把逗号分隔标签去除空白并丢弃空项，供规则筛选输入使用。
 * English: Trim comma-separated labels and discard empty entries for rule-filter inputs.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const split = (value: string) => [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];

/**
 * 中文：呈现事件规则、筛选动作、审批与执行预览的编辑界面中的 AutomationRuleSettings 界面，订阅 /automation-rules，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the AutomationRuleSettings surface for Editing event rules, filtered actions, approvals and execution previews, subscribing to /automation-rules. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function AutomationRuleSettings({ request }: { request: Request }) {
  const remote = useRemote<AutomationView>(request, '/automation-rules', true, 5000);
  const action = useAction();
  const [draft, setDraft] = useState<Draft>(fresh);
  const [editing, setEditing] = useState<{ id: string; version: number }>();
  const [vmIds, setVmIds] = useState(''), [projects, setProjects] = useState(''),
    [tags, setTags] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const cooldownValid = Number.isInteger(draft.cooldownSeconds) && draft.cooldownSeconds >= 60 && draft.cooldownSeconds <= 86400;
  const stepSeconds = draft.steps.reduce((sum, step) => sum + step.timeout, 0);
  const stepsValid = draft.action !== 'runbook' || (draft.steps.length > 0 && stepSeconds <= 600 && draft.steps.every(step =>
    step.name.trim() && step.command.trim() && Number.isInteger(step.timeout) && step.timeout >= 1 && step.timeout <= 120));
  /**
   * 中文：在事件规则、筛选动作、审批与执行预览的编辑界面流程中编辑草稿，editing 状态，vmIds 状态，projects 状态，tags 状态，preview 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing event rules, filtered actions, approvals and execution previews, editing draft, editing state, vmIds state, projects state, tags state, preview state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const clear = () => {
    setDraft(fresh()); setEditing(undefined); setVmIds(''); setProjects(''); setTags(''); setPreview(null);
  };
  /**
   * 中文：在事件规则、筛选动作、审批与执行预览的编辑界面流程中editing 状态，编辑草稿，vmIds 状态，projects 状态，tags 状态，preview 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing event rules, filtered actions, approvals and execution previews, editing state, editing draft, vmIds state, projects state, tags state, preview state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：rule：签名所示 AutomationRule 业务值
   * English: Inputs: rule: the AutomationRule domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
    requestAnimationFrame(() => editorRef.current?.querySelector('input')?.focus());
  };
  /**
   * 中文：在事件规则、筛选动作、审批与执行预览的编辑界面流程中编辑草稿；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing event rules, filtered actions, approvals and execution previews, editing draft. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：field：签名所示 'types' | 'statuses' | 'kinds' 业务值；value：待校验、转换或保存的输入值
   * English: Inputs: field: the 'types' | 'statuses' | 'kinds' domain value in the signature; value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const toggle = (field: 'types' | 'statuses' | 'kinds', value: string) => {
    const current = draft.filter[field] as string[];
    setDraft({ ...draft, filter: { ...draft.filter,
      [field]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    } });
  };
  /**
   * 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const save = () => void action.run(/** 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
  /**
   * 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：rule：签名所示 AutomationRule 业务值
   * English: Inputs: rule: the AutomationRule domain value in the signature
   */
  const remove = (rule: AutomationRule) => void action.run(/** 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request('/automation-rules', 'POST',
      { operation: 'remove', id: rule.id, version: rule.version }, signal);
    if (editing?.id === rule.id) clear();
    remote.reload();
  }, '自动化规则已删除');
  /**
   * 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：rule：签名所示 AutomationRule 业务值
   * English: Inputs: rule: the AutomationRule domain value in the signature
   */
  const inspect = (rule: AutomationRule) => void action.run(/** 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互并更新preview 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews and update preview state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setPreview(await request<Preview>('/automation-rules', 'POST',
      { operation: 'preview', id: rule.id }, signal));
  });
  /**
   * 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const approve = () => void action.run(/** 中文：提交 POST /automation-rules，完成事件规则、筛选动作、审批与执行预览的编辑界面的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /automation-rules for Editing event rules, filtered actions, approvals and execution previews. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
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
      <button className="secondary compact" disabled={action.busy} onClick={remote.reload}>刷新</button>
    </div>
    <Feedback error={action.error || remote.error || remote.data?.error} message={action.message} />
    {!remote.data && !remote.error && <p role="status">正在读取自动化规则与执行记录…</p>}
    {remote.error && remote.data && <p className="subtle-note">规则列表与执行记录可能不是最新，请刷新后核对。</p>}
    {action.busy && <p className="automation-operation-state" role="status">正在处理规则操作，请等待完成…</p>}
    <div className="feature-card automation-rule-editor" ref={editorRef}>
      <h4>{editing ? '编辑规则' : '新建规则'}</h4>
      <p className="automation-draft-state">当前草稿：{!draft.enabled ? '已停用' : draft.action === 'runbook' || draft.previewOnly ? '仅预览' : '实际执行'}{editing ? ` · 编辑版本 ${editing.version}` : ' · 尚未创建规则'}</p>
      <fieldset className="automation-draft-fields" disabled={action.busy}>
      <div className="shortcut-fields">
        <label>规则名称<input value={draft.name} maxLength={64}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>实例操作<select aria-label="实例操作" value={draft.action}
          onChange={(e) => setDraft({ ...draft, action: e.target.value as Draft['action'],
            steps: e.target.value === 'runbook' ? draft.steps : [] })}>
          {(['start', 'stop', 'suspend', 'resume', 'runbook'] as const).map((value) =>
            <option key={value} value={value}>{labels[value]}</option>)}</select></label>
        <label>冷却秒数<input type="number" min={60} max={86400} step={1} value={draft.cooldownSeconds}
          aria-label="冷却秒数" aria-invalid={!cooldownValid || undefined} aria-describedby={`${hintId}-cooldown`}
          onChange={(e) => setDraft({ ...draft, cooldownSeconds: Number(e.target.value) })} />
          <small id={`${hintId}-cooldown`} className={!cooldownValid ? 'automation-field-error' : undefined}>填写 60～86,400 秒的整数，限制同一规则重复执行的频率。</small></label>
        <label>实例 ID（逗号分隔，留空表示全部）<input value={vmIds}
          onChange={(e) => setVmIds(e.target.value)} /></label>
        <label>项目 ID（逗号分隔）<input value={projects}
          onChange={(e) => setProjects(e.target.value)} /></label>
        <label>实例标签（逗号分隔，必须全部匹配）<input value={tags}
          onChange={(e) => setTags(e.target.value)} /></label>
      </div>
      {draft.action === 'runbook' && <div className="feature-card automation-runbook">
        <h4>修复步骤</h4>
        <p className="subtle-note">按顺序在匹配实例的项目目录执行 Shell 命令；任一步骤失败即停止。最多 8 步，总超时 600 秒。</p>
        <p className={stepSeconds > 600 ? 'automation-field-error' : 'automation-step-count'}>{draft.steps.length} / 8 步 · 累计超时 {stepSeconds} / 600 秒</p>
        {draft.steps.map((step, index) => <div key={index} className="automation-step">
          <h5>步骤 {index + 1}</h5><div className="shortcut-fields">
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
        </div></div>)}
        {!stepsValid && <p className="automation-field-error">请添加完整的步骤名称和命令，每步超时为 1～120 秒的整数，总计不超过 600 秒。</p>}
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
          !draft.filter.types.length || !cooldownValid || !stepsValid} onClick={save}>保存规则</button>
        {editing && <button className="secondary compact" onClick={clear}>取消编辑</button>}
      </div>
      {!draft.filter.types.length && <p className="automation-field-error">至少选择一种事件类型后才能保存。</p>}
      </fieldset>
    </div>
    <div className="feature-card"><h4 className="automation-section-heading">已保存规则 <span>{remote.data ? `${remote.data.rules.length} 条` : '尚未读取'}</span></h4>
      {remote.data && !remote.data.rules.length && <p className="automation-empty">暂无规则。填写上方草稿，保存后可预览最近事件。</p>}
      {remote.data?.rules.map((rule) => <div key={rule.id} className="automation-rule-row automation-saved-rule">
        <div className="automation-rule-identity"><strong data-locale-ignore>{rule.name}</strong><span className="automation-rule-mode">{rule.enabled ?
          rule.previewOnly ? '预览中' : '实际执行' : '已停用'}</span></div>
        <p>{labels[rule.action]} · 冷却 {rule.cooldownSeconds} 秒 · 版本 {rule.version}</p>
        <div className="feature-actions">
        <button className="secondary compact" disabled={action.busy} onClick={() => edit(rule)}>编辑</button>
        <button className="secondary compact" disabled={action.busy} onClick={() => inspect(rule)}>预览最近事件</button>
        <button className="secondary compact" disabled={action.busy} onClick={() => remove(rule)}>删除</button>
        </div></div>)}
    </div>
    {preview && <div className="feature-card automation-preview"><h4>事件预览：<span data-locale-ignore>{preview.rule.name}</span></h4>
      <p className="automation-preview-context">基于已保存版本 {preview.rule.version} · {preview.matches.length} 个匹配事件</p>
      {preview.rule.action === 'runbook' && <div>
        <p>以下命令将在匹配实例的项目目录中顺序运行：</p>
        {preview.rule.steps.map((step, index) => <div key={index} className="automation-review-step">
          <p>{index + 1}. <span data-locale-ignore>{step.name}</span> · {step.timeout} 秒</p>
          <pre tabIndex={0} role="region" aria-label={`预览步骤 ${index + 1} 的命令`} data-locale-ignore>{step.command}</pre>
        </div>)}
        {preview.rule.previewOnly && preview.approval && <button className="primary compact"
          disabled={action.busy} onClick={approve}>批准并启用自动修复</button>}
      </div>}
      {!preview.matches.length && <p className="automation-empty">最近没有匹配事件。</p>}
      {preview.matches.map(({ event, action: operation, targetVmId, wouldExecute }) =>
        <div key={event.id} className="automation-event"><p>{formatDateTime(new Date(event.occurredAt))} · {labels[event.type]} · {labels[operation]}</p>
          <p>目标实例：<span data-locale-ignore>{targetVmId || '无实例'}</span></p>
          <p className="automation-event-outcome">{wouldExecute ? '当前为执行模式，仍需通过冷却及实例检查' : '仅预览'}</p></div>)}
    </div>}
    <div className="feature-card"><h4 className="automation-section-heading">最近执行 <span>{remote.data ? `显示 ${Math.min(30, remote.data.executions.length)} / ${remote.data.executions.length} 条` : '尚未读取'}</span></h4>
      {remote.data && !remote.data.executions.length && <p className="automation-empty">尚无匹配事件。</p>}
      {!!remote.data?.executions.length && <div className="automation-history-list" tabIndex={0} role="region" aria-label="最近执行记录，可滚动">
      {remote.data?.executions.slice(0, 30).map((item) => <div className="automation-event" key={item.id}>
        <p>{formatDateTime(new Date(item.startedAt))} · {labels[item.action]} · <strong>{labels[item.status] || item.status}</strong></p>
        <p>目标实例：<span data-locale-ignore>{item.vmId || '无实例'}</span></p>
        {item.reason && <p>{item.reason}</p>}
        {item.steps?.length ? <p>步骤：<span data-locale-ignore>{item.steps.map((step) =>
          `${step.name}(${step.code === -1 ? '跳过' : step.code})`).join('、')}</span></p> : null}
      </div>)}
      </div>}
    </div>
  </section>;
}
