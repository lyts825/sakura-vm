/**
 * 模块职责（中文）：展示控制面事件与通知，提供事件详情和用户可操作的反馈。
 * Module responsibility (English): Presenting controller events and notification details.
 * 详细范围（中文）：公开入口包括 NotificationCenter；职责覆盖呈现控制面事件与通知详情，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include NotificationCenter. The scope covers Presenting controller events and notification details. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from './localization';
import { useEffect, useRef, useState } from 'react';
import type { AlertEvent } from '../server/feature-suite';
import { saveText } from './export-file';

type Event = Pick<
  AlertEvent,
  'id' | 'kind' | 'message' | 'createdAt' | 'acknowledged' | 'jobId' | 'projectId'
>;
/**
 * 中文：呈现呈现控制面事件与通知详情中的 NotificationCenter 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the NotificationCenter surface for Presenting controller events and notification details. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  events,
  onAcknowledge,
  busy,
} 提供 events（events 状态）、onAcknowledge（onAcknowledge 状态）、busy（忙碌标记） 上下文字段
 * English: Inputs: {
  events,
  onAcknowledge,
  busy,
} provides context fields events (events state), onAcknowledge (onAcknowledge state), busy (busy flag)
 */
export function NotificationCenter({
  events,
  onAcknowledge,
  busy,
}: {
  events: Event[];
  onAcknowledge: /** 中文：把事件确认通知外层，以更新通知中心未读状态；这是 NotificationCenter 的调用契约 | English: Notify the outer owner of event acknowledgment to update unread state; this is the callable contract of NotificationCenter | 中文：输入：id：目标资源标识 | English: Inputs: id: target resource identifier | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (id: string) => void;
  busy: boolean;
}) {
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [limit, setLimit] = useState(50);
  const [permissionError, setPermissionError] = useState('');
  const seen = useRef<Set<string> | null>(null);
  useEffect(/** 中文：当依赖 [events, permission, supported] 变化时登记集合或存储条目，按指定 Schema 校验并解码；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [events, permission, supported] change, register collection/storage entries, validate/decode with the specified schema. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (seen.current === null) {
      seen.current = new Set(events.map((event) => event.id));
      return;
    }
    for (const event of events) {
      const known = seen.current.has(event.id);
      seen.current.add(event.id);
      if (
        !known &&
        supported &&
        permission === 'granted' &&
        !event.acknowledged &&
        Date.now() - Date.parse(event.createdAt) < 300000
      ) {
        try {
          new Notification('Sakura 运行告警', { body: event.message, tag: event.id });
        } catch {
          /* The in-app event remains available. */
        }
      }
    }
  }, [events, permission, supported]);
  const visible = events.filter((event) => !unreadOnly || !event.acknowledged);
  return (
    <section className="feature-card" aria-label="通知中心">
      <h3>通知中心 · {events.filter((event) => !event.acknowledged).length} 条未确认</h3>
      <div className="feature-actions">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />
          仅显示未确认告警
        </label>
        {supported && permission === 'default' && (
          <button
            className="secondary compact"
            onClick={/** 中文：由用户触发申请浏览器通知权限，结果更新权限状态，浏览器拒绝请求时显示站点权限检查提示。 | English: Request browser-notification permission from a user action, update permission state on fulfillment and display site-permission guidance if the browser rejects it. | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
              void Notification.requestPermission()
                .then(setPermission)
                .catch(() => setPermissionError('无法启用浏览器通知，请检查站点权限。'));
            }}
          >
            启用浏览器告警通知
          </button>
        )}
        <button
          className="secondary compact"
          disabled={!events.length}
          onClick={() => saveText('sakura-alerts.json', events)}
        >
          导出告警
        </button>
      </div>
      <p className="subtle-note">
        {permission === 'granted'
          ? '浏览器通知已允许；此页面打开时提示新告警。'
          : permission === 'denied'
            ? '浏览器通知被禁用，可在站点权限中修改；告警仍保留在此处。'
            : '告警保存在本机，浏览器通知需手动允许。'}{' '}
        系统保留最近 500 条。
      </p>
      {permissionError && <p role="alert">{permissionError}</p>}
      {!visible.length && <p className="muted">没有符合条件的告警。</p>}
      <div className="event-list">
        {visible.slice(0, limit).map((event) => (
          <div className="diagnostic-row" key={event.id}>
            <p>
              <b>{event.message}</b>
              <br />
              <small>
                {formatDateTime(new Date(event.createdAt))}
                {event.projectId ? ` · 项目 ${event.projectId}` : ''}
                {event.jobId ? ` · 任务 ${event.jobId}` : ''}
              </small>
            </p>
            {event.acknowledged ? (
              <span>已确认</span>
            ) : (
              <button
                className="secondary compact"
                disabled={busy}
                aria-label={'确认告警：' + event.message}
                onClick={() => onAcknowledge(event.id)}
              >
                确认
              </button>
            )}
          </div>
        ))}
      </div>
      {visible.length > limit && (
        <button className="secondary compact" onClick={() => setLimit(limit + 50)}>
          显示更多告警
        </button>
      )}
    </section>
  );
}
