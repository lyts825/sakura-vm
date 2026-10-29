/**
 * 模块职责（中文）：配置 Webhook 订阅与事件筛选，展示投递记录并提供测试投递入口。
 * Module responsibility (English): Editing subscription filters and presenting delivery and test feedback.
 * 详细范围（中文）：公开入口包括 WebhookSettings；职责覆盖编辑订阅过滤并展示投递和测试反馈，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include WebhookSettings. The scope covers Editing subscription filters and presenting delivery and test feedback. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from './localization';
import { useRef, useState } from 'react';
import './settings-feedback.css';
import {
  webhookTypes,
  webhookJobStatuses,
  webhookAlertKinds,
  type WebhookView,
  type WebhookSubscription,
  type WebhookFilter,
} from '../shared/webhooks';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

type Draft = WebhookFilter & { name: string; url: string; enabled: boolean };
/**
 * 中文：构造默认禁用的 webhook 草稿，预选告警事件并初始化空筛选集合，不立即向外部地址投递。
 * English: Create a disabled webhook draft with alerts preselected/empty filters, without immediately delivering to an external URL.
 * 中文：结果：Draft，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: Draft carrying the described computation/transport result; throwing branches do not provide success
 */
const fresh = (): Draft => ({
  name: '',
  url: '',
  enabled: false,
  types: ['alert.raised'],
  vmIds: [],
  projectIds: [],
  tags: [],
  statuses: [],
  kinds: [],
});
const labels: Record<string, string> = {
  'job.finished': '任务完成',
  'alert.raised': '新告警',
  done: '成功',
  error: '失败',
  cancelled: '已取消',
  interrupted: '中断',
  cpu: 'CPU',
  memory: '内存',
  disk: '磁盘',
  service: '服务',
  backup: '备份',
  task: '任务',
  secret: '密钥轮换',
  pending: '等待重试',
  sending: '投递中',
  delivered: '已送达',
  failed: '投递失败',
  test: '测试事件',
};
/**
 * 中文：按英文/中文逗号和换行拆分筛选输入，去空白空项并按首次出现顺序去重。
 * English: Split filters by ASCII/Chinese commas/newlines, trim/drop empties and deduplicate in first-occurrence order.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const split = (value: string) => [
  ...new Set(
    value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
/**
 * 中文：呈现编辑订阅过滤并展示投递和测试反馈中的 WebhookSettings 界面，订阅 /webhooks，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the WebhookSettings surface for Editing subscription filters and presenting delivery and test feedback, subscribing to /webhooks. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 */
export function WebhookSettings({ request }: { request: Request }) {
  const remote = useRemote<WebhookView>(request, '/webhooks', true, 5000);
  const action = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Draft>(fresh);
  const [editing, setEditing] = useState<{ id: string; version: number }>();
  const [tags, setTags] = useState(''),
    [vms, setVms] = useState(''),
    [projects, setProjects] = useState('');
  const [secret, setSecret] = useState(''),
    [reveal, setReveal] = useState(false);
  /**
   * 中文：在编辑订阅过滤并展示投递和测试反馈流程中编辑草稿；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing subscription filters and presenting delivery and test feedback, editing draft. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：key：签名所示 T 业务值；value：待校验、转换或保存的输入值
   * English: Inputs: key: the T domain value in the signature; value: input value to validate/transform/save
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const change = <T extends keyof Draft>(key: T, value: Draft[T]) => {
    setDraft({ ...draft, [key]: value });
    action.clear();
  };
  /**
   * 中文：在编辑订阅过滤并展示投递和测试反馈流程中editing 状态，编辑草稿，tags 状态，vms 状态，projects 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing subscription filters and presenting delivery and test feedback, editing state, editing draft, tags state, vms state, projects state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const clear = () => {
    setEditing(undefined);
    setDraft(fresh());
    setTags('');
    setVms('');
    setProjects('');
  };
  /**
   * 中文：在编辑订阅过滤并展示投递和测试反馈流程中editing 状态，编辑草稿，tags 状态，vms 状态，projects 状态，secret 状态；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Editing subscription filters and presenting delivery and test feedback, editing state, editing draft, tags state, vms state, projects state, secret state. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：输入：subscription：签名所示 WebhookSubscription 业务值
   * English: Inputs: subscription: the WebhookSubscription domain value in the signature
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const edit = (subscription: WebhookSubscription) => {
    setEditing({ id: subscription.id, version: subscription.version });
    const { name, url, enabled, types, vmIds, projectIds, tags, statuses, kinds } = subscription;
    setDraft({ name, url, enabled, types, vmIds, projectIds, tags, statuses, kinds });
    setTags(tags.join(', '));
    setVms(vmIds.join(', '));
    setProjects(projectIds.join(', '));
    setSecret('');
    action.clear();
    requestAnimationFrame(() => formRef.current?.querySelector('input')?.focus());
  };
  /**
   * 中文：提交 POST /webhooks，完成编辑订阅过滤并展示投递和测试反馈的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /webhooks for Editing subscription filters and presenting delivery and test feedback. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：body：待按操作契约编码的请求正文；message：签名所示 string 业务值；reset：此处理器的调用值（缺省 false）
   * English: Inputs: body: request body to encode under the operation contract; message: the string domain value in the signature; reset: the invocation value for this handler (default false)
   */
  const run = (body: unknown, message: string, reset = false) =>
    action.run(/** 中文：提交 POST /webhooks，完成编辑订阅过滤并展示投递和测试反馈的数据交互并更新secret 状态、reveal 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /webhooks for Editing subscription filters and presenting delivery and test feedback and update secret state, reveal state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      const value = await request<WebhookView & { secret?: string }>('/webhooks', 'POST', body, signal);
      setSecret(value.secret || '');
      setReveal(false);
      if (reset) clear();
      remote.reload();
    }, message);
  return (
    <section className="system-card webhook-settings" aria-label="事件与告警通知设置">
      <h3>事件与告警通知</h3>
      {!remote.data && !remote.error && <p role="status">正在读取接收端与投递记录…</p>}
      {remote.error && <button className="secondary compact" disabled={action.busy} onClick={remote.reload}>重新读取通知设置</button>}
      {action.busy && <p className="webhook-action-status" role="status">正在处理通知设置，请等待操作完成。</p>}
      <p className="subtle-note">
        订阅保存后接收新事件。可按实例、项目和标签路由到 HTTPS
        接收端；空条件匹配全部，多个标签须全部命中。告警来源需要启用自动化调度和实例告警策略。
      </p>
      <p className="subtle-note">
        仅发送标识、类型、状态和实例标签，不发送命令、告警正文、日志或密钥值。后台每 5 秒检查，最多重试 5
        次；接收端需按投递标识去重并校验时间戳和 HMAC 签名。锁定控制面后，已启用的投递继续运行。
      </p>
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (action.busy || !remote.data || !draft.types.length) return;
          void run(
            {
              action: 'save',
              ...editing,
              subscription: { ...draft, tags: split(tags), vmIds: split(vms), projectIds: split(projects) },
            },
            '订阅已保存，新事件将按此配置处理。',
            true,
          );
        }}
      >
        <fieldset disabled={action.busy || !remote.data}>
          <legend>{editing ? '编辑接收端' : '添加接收端'}</legend>
          <div className="shortcut-fields">
            <label>
              接收端名称
              <input
                value={draft.name}
                maxLength={64}
                required
                onChange={(event) => change('name', event.target.value)}
              />
            </label>
            <label>
              Webhook 接收地址
              <input
                type="url"
                value={draft.url}
                maxLength={2048}
                placeholder="https://receiver.example/events"
                required
                onChange={(event) => change('url', event.target.value)}
              />
            </label>
            <label>
              匹配全部标签
              <input
                value={tags}
                placeholder="production, backend"
                onChange={(event) => setTags(event.target.value)}
              />
            </label>
            <label>
              实例标识（逗号分隔）
              <input value={vms} onChange={(event) => setVms(event.target.value)} />
            </label>
            <label>
              项目标识（逗号分隔）
              <input value={projects} onChange={(event) => setProjects(event.target.value)} />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => change('enabled', event.target.checked)}
            />
            启用自动投递
          </label>
          <div className="webhook-choices" role="group" aria-label="事件类型">
            {webhookTypes.map((type) => (
              <label className="check" key={type}>
                <input
                  type="checkbox"
                  checked={draft.types.includes(type)}
                  onChange={(event) =>
                    change(
                      'types',
                      event.target.checked
                        ? [...draft.types, type]
                        : draft.types.filter((item) => item !== type),
                    )
                  }
                />
                {labels[type]}
              </label>
            ))}
          </div>
          {draft.types.includes('job.finished') && (
            <fieldset className="webhook-choices">
              <legend>任务状态（空选匹配全部）</legend>
              {webhookJobStatuses.map((status) => (
                <label className="check" key={status}>
                  <input
                    type="checkbox"
                    checked={draft.statuses.includes(status)}
                    onChange={(event) =>
                      change(
                        'statuses',
                        event.target.checked
                          ? [...draft.statuses, status]
                          : draft.statuses.filter((item) => item !== status),
                      )
                    }
                  />
                  {labels[status]}
                </label>
              ))}
            </fieldset>
          )}
          {draft.types.includes('alert.raised') && (
            <fieldset className="webhook-choices">
              <legend>告警类型（空选匹配全部）</legend>
              {webhookAlertKinds.map((kind) => (
                <label className="check" key={kind}>
                  <input
                    type="checkbox"
                    checked={draft.kinds.includes(kind)}
                    onChange={(event) =>
                      change(
                        'kinds',
                        event.target.checked
                          ? [...draft.kinds, kind]
                          : draft.kinds.filter((item) => item !== kind),
                      )
                    }
                  />
                  {labels[kind]}
                </label>
              ))}
            </fieldset>
          )}
          <div className="button-row">
            <button className="secondary compact" disabled={!draft.types.length} type="submit">
              {editing ? '保存接收端' : '添加接收端'}
            </button>
            {editing && (
              <button type="button" className="text-button" onClick={clear}>
                取消编辑
              </button>
            )}
          </div>
        </fieldset>
      </form>
      {secret && (
        <div className="webhook-secret">
          <label>
            本次签名密钥（仅显示一次）
            <input readOnly type={reveal ? 'text' : 'password'} value={secret} autoComplete="off" />
          </label>
          <button className="text-button" onClick={() => setReveal(!reveal)}>
            {reveal ? '隐藏签名密钥' : '显示签名密钥'}
          </button>
          <button className="text-button" onClick={() => setSecret('')}>
            清除显示
          </button>
        </div>
      )}
      <Feedback error={action.error || remote.error || remote.data?.error} message={action.message} />
      <h4 className="webhook-section-heading">已保存接收端{remote.data && <span>{remote.data.subscriptions.length} 个</span>}</h4>
      {remote.data && !remote.data.subscriptions.length && <p className="webhook-empty">还没有接收端。填写上方表单后，可以保存第一个订阅。</p>}
      {remote.data?.subscriptions.map((subscription) => (
        <article
          className="webhook-subscription"
          key={subscription.id}
          aria-label={`接收端 ${subscription.name}`}
        >
          <h4>
            <span data-locale-ignore>{subscription.name}</span><span className="webhook-enabled-state">{subscription.enabled ? '已启用' : '已停用'}</span>
          </h4>
          <p className="subtle-note webhook-endpoint" data-locale-ignore>{subscription.url}</p>
          <p className="subtle-note">
            {subscription.types.map((type) => labels[type]).join('、')} · 标签：
            {subscription.tags.join('、') || '全部'} · 版本 {subscription.version}
          </p>
          <div className="button-row">
            <button className="secondary compact" disabled={action.busy} onClick={() => edit(subscription)}>
              编辑接收端
            </button>
            <button
              className="secondary compact"
              disabled={action.busy}
              onClick={() =>
                void run(
                  { action: 'test', id: subscription.id, version: subscription.version },
                  '测试事件已排队，请查看投递记录。',
                )
              }
            >
              测试投递
            </button>
            <button
              className="text-button"
              disabled={action.busy}
              onClick={() =>
                void run(
                  { action: 'rotate', id: subscription.id, version: subscription.version },
                  '签名密钥已轮换，请在接收端更新密钥。',
                )
              }
            >
              轮换签名密钥
            </button>
            <button
              className="text-button danger"
              disabled={action.busy}
              onClick={() =>
                void run(
                  { action: 'remove', id: subscription.id, version: subscription.version },
                  '订阅已移除，等待投递已取消。',
                )
              }
            >
              移除接收端
            </button>
          </div>
        </article>
      ))}
      <h4 className="webhook-section-heading">投递记录{remote.data && <span>显示 {Math.min(50, remote.data.deliveries.length)} / {remote.data.deliveries.length} 项</span>}</h4>
      <p className="subtle-note">
        更改、停用或移除订阅会取消其积压投递；已经送达的内容无法撤回。新配置只匹配之后发生的事件。最多保留 500
        项待投递和最近 200 项已结束记录，来源检查范围为最近 24 小时。
      </p>
      {remote.data && !remote.data.deliveries.length && <p className="webhook-empty">暂无投递记录。</p>}
      {remote.data?.deliveries.slice(0, 50).map((delivery) => (
        <details className="webhook-delivery" key={delivery.id}>
          <summary>
            {labels[delivery.event.type]} · {labels[delivery.status]} · 尝试 {delivery.attempts} 次 ·{' '}
            {remote.data?.subscriptions.find((item) => item.id === delivery.subscriptionId)?.name ||
              '已移除接收端'}
          </summary>
          <p className="subtle-note">
            投递标识：{delivery.id}
            <br />
            更新时间：{formatDateTime(new Date(delivery.updatedAt))}
            {delivery.status === 'pending' && (
              <> · 下次尝试：{formatDateTime(new Date(delivery.nextAttemptAt))}</>
            )}
          </p>
          {delivery.error && <p className="subtle-note">{delivery.error}</p>}
          <pre className="api-json" tabIndex={0} role="region" aria-label={`投递事件 ${delivery.id}`}>{JSON.stringify(delivery.event, null, 2)}</pre>
          {delivery.status === 'failed' && (
            <button
              className="secondary compact"
              disabled={action.busy}
              onClick={() => void run({ action: 'retry', id: delivery.id }, '失败投递已重新排队。')}
            >
              重试此投递
            </button>
          )}
          {['pending', 'sending'].includes(delivery.status) && (
            <button
              className="secondary compact"
              disabled={action.busy}
              onClick={() => void run({ action: 'cancel', id: delivery.id }, '投递已取消。')}
            >
              取消此投递
            </button>
          )}
        </details>
      ))}
      {!!remote.data && remote.data.deliveries.length > 50 && (
        <p className="subtle-note">显示最近 50 项；完整记录可通过 API 查看。</p>
      )}
    </section>
  );
}
