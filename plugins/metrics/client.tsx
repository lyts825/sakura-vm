/**
 * 模块职责（中文）：“资源采样”插件的CPU、内存、磁盘和进程资源监控标签，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for guest resource and process sampling.
 * 详细范围（中文）：公开入口包括 MetricsPanel, tabs；职责覆盖客户机资源与进程采样的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include MetricsPanel, tabs. The scope covers UI interaction and state presentation for guest resource and process sampling. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from '../../src/localization';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useRemote, Feedback, formatBytes, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';
type Metrics = OperationResponse<'metrics.sample'>;
/**
 * 中文：呈现客户机资源与进程采样的界面交互与状态呈现中的 MetricsPanel 界面，订阅 /vms/{vm.id}/metrics，组合 RefreshCw，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MetricsPanel surface for UI interaction and state presentation for guest resource and process sampling, subscribing to /vms/{vm.id}/metrics and composing RefreshCw. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { vm, request } provides context fields vm (vm state), request (transport capability bound to identity/authority scope)
 */
export function MetricsPanel({ vm, request }: FeatureProps) {
  const remote = useRemote<Metrics>(request, `/vms/${vm.id}/metrics`, vm.status === 'running');
  const [history, setHistory] = useState<number[]>([]);
  useEffect(/** 中文：当依赖 [remote.data] 变化时history 状态；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [remote.data] change, history state. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (remote.data) setHistory((h) => [...h.slice(-29), remote.data!.cpuPercent]);
  }, [remote.data]);
  const m = remote.data;
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>实时资源</h3>
          <p>客户机实际使用量 · 每 5 秒采样</p>
        </div>
        <button className="icon-button" aria-label="刷新资源" onClick={remote.reload}>
          <RefreshCw size={16} />
        </button>
      </div>
      <Feedback error={remote.error} />
      {!m ? (
        <p className="muted">{vm.status === 'running' ? '正在采样…' : '启动发行版后查看实时资源。'}</p>
      ) : (
        <>
          <div className="metrics-grid">
            {[
              ['CPU', `${formatDecimal(m.cpuPercent, 1)}%`, m.cpuPercent],
              [
                '内存',
                `${formatBytes(m.memoryUsed)} / ${formatBytes(m.memoryTotal)}`,
                (100 * m.memoryUsed) / m.memoryTotal,
              ],
              [
                '根分区',
                `${formatBytes(m.diskUsed)} / ${formatBytes(m.diskTotal)}`,
                (100 * m.diskUsed) / m.diskTotal,
              ],
            ].map(([title, value, percent]) => (
              <div className="metric-tile" key={title}>
                <span>{title}</span>
                <strong>{value}</strong>
                <progress max={100} value={Number(percent)} />
              </div>
            ))}
          </div>
          <p>
            网络接收：
            {m.networkReceiveBytesPerSecond == null
              ? '等待连续采样'
              : formatBytes(m.networkReceiveBytesPerSecond) + '/s'}{' '}
            · 发送：
            {m.networkTransmitBytesPerSecond == null
              ? '等待连续采样'
              : formatBytes(m.networkTransmitBytesPerSecond) + '/s'}
          </p>
          <svg className="cpu-history" viewBox="0 0 600 100" role="img" aria-label="最近 30 次 CPU 使用率">
            <path d="M0 95H600 M0 50H600 M0 5H600" stroke="var(--line)" fill="none" />
            <polyline
              points={history.map((n, i) => `${(i * 600) / 29},${95 - n * 0.9}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
            />
          </svg>
          <p className="muted">
            运行 {Math.floor(m.uptime / 3600)} 小时 {Math.floor((m.uptime % 3600) / 60)} 分钟 · 更新于{' '}
            {new Date(m.sampledAt).toLocaleTimeString()}
          </p>
          <h4>内存占用最高的进程</h4>
          <div className="feature-list">
            {m.processes.map((p, i) => (
              <div key={i}>
                <code>{p.name}</code>
                <span>{formatBytes(p.memory)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const tabs = { metrics: MetricsPanel };
