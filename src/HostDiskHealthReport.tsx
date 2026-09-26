import type { hostDiskHealth } from '../server/host-disk-health';

export function HostDiskHealthReport({ report }: { report: Awaited<ReturnType<typeof hostDiskHealth>> }) {
  const states: Record<string, string> = {
    healthy: '未发现已报告异常',
    warning: '存在检查提示',
    critical: '设备报告异常',
    unknown: '健康数据不完整',
  };
  const reading = (value: number | null | undefined, unit = '') => (value == null ? '未知' : value + unit);
  return (
    <div className="feature-card" aria-label="主机磁盘健康报告">
      <h4>{states[report.status]}</h4>
      <p>
        可用空间：{(report.capacity.availableBytes / 1024 ** 3).toFixed(1)} GiB ·{' '}
        {report.capacity.freePercent === null ? '比例未知' : report.capacity.freePercent.toFixed(1) + '%'}
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
