/**
 * 模块职责（中文）：读取主机磁盘健康报告并呈现设备指标、告警及检查结果。
 * Module responsibility (English): Presenting host disk metrics, warnings and health reports.
 * 详细范围（中文）：公开入口包括 HostDiskHealthReport；职责覆盖显示主机磁盘指标、告警与健康报告，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HostDiskHealthReport. The scope covers Presenting host disk metrics, warnings and health reports. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from './localization';
import type { hostDiskHealth } from '../server/host-disk-health';

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
  return (
    <div className="feature-card" aria-label="主机磁盘健康报告">
      <h4>{states[report.status]}</h4>
      <p>
        可用空间：{formatDecimal((report.capacity.availableBytes / 1024 ** 3), 1)} GiB ·{' '}
        {report.capacity.freePercent === null ? '比例未知' : formatDecimal(report.capacity.freePercent, 1) + '%'}
      </p>
      <p className="subtle-note">
        数据目录：{report.directory} · 卷状态：{report.volume?.health || '未知'}
      </p>
      <ul>
        {report.findings.map((item, index) => (
          <li key={index}>
            {item.disk === undefined ? '' : `磁盘 ${item.disk}：`}
            {item.message}
          </li>
        ))}
      </ul>
      {report.disks.map((disk) => (
        <section className="feature-card" key={disk.number}>
          <h4>
            磁盘 {disk.number} · {disk.name}
          </h4>
          <p>
            {disk.bus} · 系统状态：{disk.health} · {disk.operational.join('、')}
          </p>
          <div className="feature-grid">
            <p>当前温度：{reading(disk.counters?.temperatureC, ' °C')}</p>
            <p>已消耗寿命：{reading(disk.counters?.wearPercent, '%')}</p>
            <p>通电时间：{reading(disk.counters?.powerOnHours, ' 小时')}</p>
            <p>不可纠正读错误：{reading(disk.counters?.readErrorsUncorrected)}</p>
            <p>不可纠正写错误：{reading(disk.counters?.writeErrorsUncorrected)}</p>
          </div>
        </section>
      ))}
      <p className="subtle-note">
        结果来自 Windows 存储提供程序，空字段表示设备未提供或当前权限无法读取。错误计数是设备历史值。
      </p>
    </div>
  );
}
