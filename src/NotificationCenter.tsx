import { useEffect, useRef, useState } from 'react';
import type { AlertEvent } from '../server/feature-suite';
import { saveText } from './export-file';

type Event = Pick<
  AlertEvent,
  'id' | 'kind' | 'message' | 'createdAt' | 'acknowledged' | 'jobId' | 'projectId'
>;
export function NotificationCenter({
  events,
  onAcknowledge,
  busy,
}: {
  events: Event[];
  onAcknowledge: (id: string) => void;
  busy: boolean;
}) {
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'unsupported');
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [limit, setLimit] = useState(50);
  const [permissionError, setPermissionError] = useState('');
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
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
            onClick={() => {
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
                {new Date(event.createdAt).toLocaleString()}
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
