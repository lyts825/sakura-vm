import type { JobView } from '../../server/jobs';
import type { ProjectService } from '../../server/project-services';
import type { HealthView } from '../../server/service-health';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

export function HealthEditor({
  value,
  change,
}: {
  value?: ProjectService['health'];
  change: (value: ProjectService['health']) => void;
}) {
  return (
    <details className="feature-card" open={!!value}>
      <summary>持续健康检查</summary>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            change(
              e.target.checked
                ? {
                    command: '',
                    interval: 30,
                    timeout: 5,
                    failures: 3,
                    restart: false,
                    maxRestarts: 3,
                    backoff: 10,
                  }
                : undefined,
            )
          }
        />
        启用健康检查
      </label>
      {value && (
        <>
          <label>
            检查命令
            <input
              value={value.command}
              onChange={(e) => change({ ...value, command: e.target.value })}
              placeholder="curl -fsS http://127.0.0.1:3000/health"
            />
          </label>
          <div className="feature-grid">
            {(
              [
                ['interval', '检查间隔（秒）', 5, 3600],
                ['timeout', '检查超时（秒）', 1, 30],
                ['failures', '连续失败次数', 1, 10],
                ['maxRestarts', '自动重启上限', 0, 5],
                ['backoff', '退避基数（秒）', 5, 300],
              ] as const
            ).map(([key, label, min, max]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={value[key]}
                  onChange={(e) => change({ ...value, [key]: +e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={value.restart}
              onChange={(e) => change({ ...value, restart: e.target.checked })}
            />
            异常时自动重启
          </label>
          <p className="subtle-note">
            失败达到阈值后按退避间隔重试；手动启动会重置次数，手动停止后不再自动重启。
          </p>
        </>
      )}
    </details>
  );
}

export function HealthPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<{ services: HealthView[]; job: JobView | null }>(
    request,
    `/vms/${vm.id}/health`,
    true,
    5000,
  );
  const labels = {
    waiting: '等待检查',
    healthy: '健康',
    unhealthy: '异常',
    restarting: '重启中',
    stopped: '未启用监控',
    exhausted: '重启次数已用尽',
  };
  return (
    <>
      <Feedback error={remote.error} />
      {!!remote.data?.services.length && (
        <div className="feature-card">
          <h4>服务健康状态</h4>
          {remote.data.services.map((service) => (
            <div className="development-row" key={service.name}>
              <b>{service.name}</b>
              <div>
                <span
                  className={`badge ${service.status === 'healthy' ? 'running' : ['unhealthy', 'exhausted'].includes(service.status) ? 'error' : ''}`}
                >
                  {labels[service.status]}
                </span>
                <p className="subtle-note">
                  连续失败 {service.failures} 次 · 自动重启 {service.restarts} 次
                  {service.checkedAt ? ` · ${new Date(service.checkedAt).toLocaleTimeString()}` : ''}
                </p>
                {service.error && <p className="danger-text">{service.error}</p>}
              </div>
            </div>
          ))}
          <JobLog job={remote.data.job} />
        </div>
      )}
    </>
  );
}
