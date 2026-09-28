import { formatDateTime } from './localization';
import { useState } from 'react';
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
const split = (value: string) => [
  ...new Set(
    value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
export function WebhookSettings({ request }: { request: Request }) {
  const remote = useRemote<WebhookView>(request, '/webhooks', true, 5000);
  const action = useAction();
  const [draft, setDraft] = useState<Draft>(fresh);
  const [editing, setEditing] = useState<{ id: string; version: number }>();
  const [tags, setTags] = useState(''),
    [vms, setVms] = useState(''),
    [projects, setProjects] = useState('');
  const [secret, setSecret] = useState(''),
    [reveal, setReveal] = useState(false);
  const change = <T extends keyof Draft>(key: T, value: Draft[T]) => {
    setDraft({ ...draft, [key]: value });
    action.clear();
  };
  const clear = () => {
    setEditing(undefined);
    setDraft(fresh());
    setTags('');
    setVms('');
    setProjects('');
  };
  const edit = (subscription: WebhookSubscription) => {
    setEditing({ id: subscription.id, version: subscription.version });
    const { name, url, enabled, types, vmIds, projectIds, tags, statuses, kinds } = subscription;
    setDraft({ name, url, enabled, types, vmIds, projectIds, tags, statuses, kinds });
    setTags(tags.join(', '));
    setVms(vmIds.join(', '));
    setProjects(projectIds.join(', '));
    setSecret('');
    action.clear();
  };
  const run = (body: unknown, message: string, reset = false) =>
    action.run(async (signal) => {
      const value = await request<WebhookView & { secret?: string }>('/webhooks', 'POST', body, signal);
      setSecret(value.secret || '');
      setReveal(false);
      if (reset) clear();
      remote.reload();
    }, message);
  return (
    <section className="system-card webhook-settings" aria-label="事件与告警通知设置">
      <h3>事件与告警通知</h3>
      <p className="subtle-note">
        订阅保存后接收新事件。可按实例、项目和标签路由到 HTTPS
        接收端；空条件匹配全部，多个标签须全部命中。告警来源需要启用自动化调度和实例告警策略。
      </p>
      <p className="subtle-note">
        仅发送标识、类型、状态和实例标签，不发送命令、告警正文、日志或密钥值。后台每 5 秒检查，最多重试 5
        次；接收端需按投递标识去重并校验时间戳和 HMAC 签名。锁定控制面后，已启用的投递继续运行。
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
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
      {remote.data?.subscriptions.map((subscription) => (
        <article
          className="webhook-subscription"
          key={subscription.id}
          aria-label={`接收端 ${subscription.name}`}
        >
          <h4>
            {subscription.name} · {subscription.enabled ? '已启用' : '已停用'}
          </h4>
          <p className="subtle-note">{subscription.url}</p>
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
      <h4>投递记录</h4>
      <p className="subtle-note">
        更改、停用或移除订阅会取消其积压投递；已经送达的内容无法撤回。新配置只匹配之后发生的事件。最多保留 500
        项待投递和最近 200 项已结束记录，来源检查范围为最近 24 小时。
      </p>
      {!remote.data?.deliveries.length && <p className="subtle-note">暂无投递记录。</p>}
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
          <pre className="api-json">{JSON.stringify(delivery.event, null, 2)}</pre>
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
