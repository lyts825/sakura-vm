/**
 * 模块职责（中文）：“服务健康检查”插件的项目服务健康策略编辑与持续检查状态面板，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for continuous project-service health checks.
 * 详细范围（中文）：公开入口包括 HealthEditor, HealthPanel；职责覆盖项目服务持续健康检查的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HealthEditor, HealthPanel. The scope covers UI interaction and state presentation for continuous project-service health checks. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { HealthView, ServiceHealthPolicy } from './contracts.ts';
import '../../src/development.css';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, JobLog, useRemote } from '../../src/feature-shared';
import '../../src/features.css';

/**
 * 中文：呈现项目服务持续健康检查的界面交互与状态呈现中的 HealthEditor 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the HealthEditor surface for UI interaction and state presentation for continuous project-service health checks. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{
  value,
  change,
} 提供 value（待校验、转换或保存的输入值）、change（change 状态） 上下文字段
 * English: Inputs: {
  value,
  change,
} provides context fields value (input value to validate/transform/save), change (change state)
 */
export function HealthEditor({
  value,
  change,
}: {
  value?: ServiceHealthPolicy;
  change: /** 中文：把修改后的字段或文档交给父级状态所有者；这是 HealthEditor 的调用契约 | English: Deliver modified fields/documents to the parent state owner; this is the callable contract of HealthEditor | 中文：输入：value：待校验、转换或保存的输入值 | English: Inputs: value: input value to validate/transform/save | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ (value: ServiceHealthPolicy) => void;
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

/**
 * 中文：呈现项目服务持续健康检查的界面交互与状态呈现中的 HealthPanel 界面，订阅 /vms/{vm.id}/health，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the HealthPanel surface for UI interaction and state presentation for continuous project-service health checks, subscribing to /vms/{vm.id}/health. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function HealthPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<HealthView>(
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
