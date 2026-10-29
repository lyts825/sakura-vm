/**
 * 模块职责（中文）：读取主机磁盘健康报告并呈现设备指标、告警及检查结果。
 * Module responsibility (English): Presenting host disk metrics, warnings and health reports.
 * 详细范围（中文）：公开入口包括 HostDiskHealthReport；职责覆盖显示主机磁盘指标、告警与健康报告，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HostDiskHealthReport. The scope covers Presenting host disk metrics, warnings and health reports. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime, formatDecimal } from './localization';
import type { hostDiskHealth } from '../server/host-disk-health';
import './host-disk-health.css';

/**
 * 中文：呈现显示主机磁盘指标、告警与健康报告中的 HostDiskHealthReport 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the HostDiskHealthReport surface for Presenting host disk metrics, warnings and health reports. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ report } 提供 report（向调用者交付状态或进度的回调） 上下文字段
 * English: Inputs: { report } provides context fields report (callback delivering status/progress to the caller)
 */
export function HostDiskHealthReport({ report }: { report: Awaited<ReturnType<typeof hostDiskHealth>> }) {
  const states: Record<string, string> = {
    healthy: '未发现已报告异常',
    warning: '存在检查提示',
    critical: '设备报告异常',
    unknown: '健康数据不完整',
  };
  /**
   * 中文：缺失指标显示未知，有值时附指定单位；不把未采集数据伪装成零。
   * English: Display unknown for absent metrics and append the supplied unit for present values, never presenting uncollected data as zero.
   * 中文：输入：value：待校验、转换或保存的输入值；unit：此处理器的调用值（缺省 ''）
   * English: Inputs: value: input value to validate/transform/save; unit: the invocation value for this handler (default '')
   */
  const reading = (value: number | null | undefined, unit = '') => (value == null ? '未知' : value + unit);
  const severities = { critical: '异常', warning: '提示', unknown: '未知' };
  const checkedAt = report.checkedAt && Number.isFinite(Date.parse(report.checkedAt)) ? report.checkedAt : null;
  return (
    <section className={`feature-card host-disk-report host-disk-report-${report.status}`} aria-label="主机磁盘健康报告">
      <header className="host-disk-heading">
        <div><p className="host-disk-caption">报告结论</p><h4>{states[report.status] || states.unknown}</h4></div>
        <span className="host-disk-count">{report.disks.length} 个磁盘 · {report.findings.length} 条检查提示</span>
      </header>
      <p className="host-disk-checked">{checkedAt ? <>检查时间 <time dateTime={checkedAt}>{formatDateTime(new Date(checkedAt))}</time></> : '未提供检查时间'}</p>
      <dl className="host-disk-overview">
        <div><dt>可用空间</dt><dd>{formatDecimal((report.capacity.availableBytes / 1024 ** 3), 1)} GiB</dd></div>
        <div><dt>可用比例</dt><dd>{report.capacity.freePercent === null ? '比例未知' : formatDecimal(report.capacity.freePercent, 1) + '%'}</dd></div>
        <div><dt>卷状态</dt><dd data-locale-ignore>{report.volume?.health || '未知'}</dd></div>
      </dl>
      <div className="host-disk-directory"><span>数据目录</span><code data-locale-ignore>{report.directory}</code></div>
      <h5 className="host-disk-section-title">检查提示</h5>
      {report.findings.length ? <div className="host-disk-findings" role="region" aria-label="磁盘检查提示，可滚动" tabIndex={0}><ul>
        {report.findings.map((item, index) => (
          <li key={index} className={`host-disk-finding host-disk-finding-${item.severity}`}>
            <span className="host-disk-severity">{severities[item.severity]}</span>
            <p>{item.disk !== undefined && <strong>磁盘 {item.disk}：</strong>}{item.message}</p>
          </li>
        ))}
      </ul></div> : <p className="host-disk-empty">本次报告没有检查提示。</p>}
      <h5 className="host-disk-section-title">设备指标</h5>
      {!report.disks.length && <p className="host-disk-empty">未取得磁盘明细。当前报告未提供可展示的物理设备信息。</p>}
      {report.disks.map((disk) => {
        const metrics = [
          { label: '当前温度', value: disk.counters?.temperatureC, unit: ' °C' },
          { label: '已消耗寿命', value: disk.counters?.wearPercent, unit: '%' },
          { label: '通电时间', value: disk.counters?.powerOnHours, unit: ' 小时' },
          { label: '不可纠正读错误', value: disk.counters?.readErrorsUncorrected },
          { label: '不可纠正写错误', value: disk.counters?.writeErrorsUncorrected },
        ];
        return <section className="host-disk-device" key={disk.number} aria-label={`磁盘 ${disk.number} 设备指标`}>
          <h4><span>磁盘 {disk.number}</span><span data-locale-ignore>{disk.name || '名称未知'}</span></h4>
          <p className="host-disk-device-meta">总线 <span data-locale-ignore>{disk.bus || '未知'}</span> · 系统状态 <span data-locale-ignore>{disk.health || '未知'}</span></p>
          <p className="host-disk-device-meta">运行状态 <span data-locale-ignore>{disk.operational.length ? disk.operational.join('、') : '未知'}</span></p>
          <dl className="host-disk-metrics">
            {metrics.map((metric) => <div key={metric.label} className={metric.value == null ? 'is-unknown' : ''}>
              <dt>{metric.label}：</dt><dd>{reading(metric.value, metric.unit)}</dd>
            </div>)}
          </dl>
        </section>
      })}
      <p className="subtle-note">
        结果来自 Windows 存储提供程序，空字段表示设备未提供或当前权限无法读取。错误计数是设备历史值。
      </p>
    </section>
  );
}
