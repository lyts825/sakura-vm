/**
 * 模块职责（中文）：读取历史资源采样，将累计计数转换为速率并绘制可选择的指标序列。
 * Module responsibility (English): Computing rates from historical counters and plotting and exporting metric series.
 * 详细范围（中文）：公开入口包括 MetricHistory；职责覆盖从历史计数计算指标速率并绘制和导出序列，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include MetricHistory. The scope covers Computing rates from historical counters and plotting and exporting metric series. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDecimal } from './localization';
import { formatDateTime } from './localization';
import { useId, useState } from 'react';
import type { MetricPoint } from '../server/feature-suite';
import { formatBytes } from './feature-shared';
import { saveBlob, saveText } from './export-file';
import './metric-history.css';

const series = {
  cpu: { name: 'CPU 使用率', /** 中文：从本序列的采样点提取 CPU 百分比、内存/磁盘占比或收发速率；总量或速率缺失时保留 null，由图表表达缺样而非零值。 | English: Extract this series' CPU percentage, memory/disk ratio or receive/transmit rate from a sample. Preserve null for absent totals/rates so charts represent missing samples rather than zero. | 中文：输入：p：签名所示 MetricPoint 业务值 | English: Inputs: p: the MetricPoint domain value in the signature */ value: (p: MetricPoint) => p.cpuPercent, percent: true },
  memory: {
    name: '内存使用率',
    /**
     * 中文：从本序列的采样点提取 CPU 百分比、内存/磁盘占比或收发速率；总量或速率缺失时保留 null，由图表表达缺样而非零值。
     * English: Extract this series' CPU percentage, memory/disk ratio or receive/transmit rate from a sample. Preserve null for absent totals/rates so charts represent missing samples rather than zero.
     * 中文：输入：p：签名所示 MetricPoint 业务值
     * English: Inputs: p: the MetricPoint domain value in the signature
     */
    value: (p: MetricPoint) => (p.memoryTotal ? (p.memoryUsed / p.memoryTotal) * 100 : null),
    percent: true,
  },
  disk: {
    name: '磁盘使用率',
    /**
     * 中文：从本序列的采样点提取 CPU 百分比、内存/磁盘占比或收发速率；总量或速率缺失时保留 null，由图表表达缺样而非零值。
     * English: Extract this series' CPU percentage, memory/disk ratio or receive/transmit rate from a sample. Preserve null for absent totals/rates so charts represent missing samples rather than zero.
     * 中文：输入：p：签名所示 MetricPoint 业务值
     * English: Inputs: p: the MetricPoint domain value in the signature
     */
    value: (p: MetricPoint) => (p.diskTotal ? (p.diskUsed / p.diskTotal) * 100 : null),
    percent: true,
  },
  receive: {
    name: '网络接收速率',
    /**
     * 中文：从本序列的采样点提取 CPU 百分比、内存/磁盘占比或收发速率；总量或速率缺失时保留 null，由图表表达缺样而非零值。
     * English: Extract this series' CPU percentage, memory/disk ratio or receive/transmit rate from a sample. Preserve null for absent totals/rates so charts represent missing samples rather than zero.
     * 中文：输入：p：签名所示 MetricPoint 业务值
     * English: Inputs: p: the MetricPoint domain value in the signature
     */
    value: (p: MetricPoint) => p.networkReceiveBytesPerSecond ?? null,
    percent: false,
  },
  transmit: {
    name: '网络发送速率',
    /**
     * 中文：从本序列的采样点提取 CPU 百分比、内存/磁盘占比或收发速率；总量或速率缺失时保留 null，由图表表达缺样而非零值。
     * English: Extract this series' CPU percentage, memory/disk ratio or receive/transmit rate from a sample. Preserve null for absent totals/rates so charts represent missing samples rather than zero.
     * 中文：输入：p：签名所示 MetricPoint 业务值
     * English: Inputs: p: the MetricPoint domain value in the signature
     */
    value: (p: MetricPoint) => p.networkTransmitBytesPerSecond ?? null,
    percent: false,
  },
};
/**
 * 中文：未取得连续速率样本时显示等待提示，有样本时使用资源单位附每秒后缀。
 * English: Show a waiting message until consecutive rate samples exist; otherwise display resource units with a per-second suffix.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const rate = (value?: number | null) =>
  value === null || value === undefined ? '等待连续采样'
    : value < 1024 ? formatDecimal(value, 1) + ' B/s'
      : value < 1024 ** 2 ? formatDecimal(value / 1024, 1) + ' KiB/s' : formatBytes(value) + '/s';

/**
 * 中文：呈现从历史计数计算指标速率并绘制和导出序列中的 MetricHistory 界面，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MetricHistory surface for Computing rates from historical counters and plotting and exporting metric series. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ history } 提供 history（history 状态） 上下文字段
 * English: Inputs: { history } provides context fields history (history state)
 */
export function MetricHistory({ history }: { history: MetricPoint[] }) {
  const [kind, setKind] = useState<keyof typeof series>('cpu');
  const chartDescriptionId = useId();
  const selected = series[kind],
    values = history.map((point) => selected.value(point)),
    maximum = selected.percent ? 100 : Math.max(1, ...values.map((value) => value ?? 0)),
    paths: string[][] = [],
    start = Date.parse(history[0]?.sampledAt || ''),
    duration = Date.parse(history.at(-1)?.sampledAt || '') - start;
  const validCount = values.filter((value) => value !== null && Number.isFinite(value)).length;
  const latest = values.at(-1);
  const latestLabel = latest == null || !Number.isFinite(latest)
    ? selected.percent ? '暂无有效值' : '等待连续采样'
    : selected.percent ? `${formatDecimal(latest, 1)}%` : rate(latest);
  values.forEach(/**
   * 中文功能：将有限采样值转换为图形坐标；空值、非有限值或超过两分钟的采样间隙切断折线，数值夹在展示范围内。
   * English: Convert finite samples to plot coordinates; null/nonfinite samples or gaps above two minutes split the line, and values are clamped to the display range.
   * 输入 / Inputs: value; index.
   * 结果：按上述用途返回界面/判定值或完成事件处理；不返回值的分支由状态与动作反馈观察。
   * Result: Return a view/decision or complete event handling as described; state/action feedback exposes branches without a returned value.
   * 设计思路：通过插入空路径分隔段，避免把缺失观测画成连续变化；时间轴按 duration 归一，零时长使用固定 x。
   * Design: Insert empty paths to separate segments instead of drawing continuous change through missing observations; normalize time by duration and use fixed x for zero duration.
   */
  (value, index) => {
    if (value === null || !Number.isFinite(value)) {
      paths.push([]);
      return;
    }
    if (!paths.length) paths.push([]);
    const time = Date.parse(history[index].sampledAt);
    if (index && time - Date.parse(history[index - 1].sampledAt) > 120000) paths.push([]);
    paths
      .at(-1)!
      .push(
        `${duration > 0 ? ((time - start) * 600) / duration : 0},${95 - (Math.max(0, Math.min(maximum, value)) / maximum) * 90}`,
      );
  });
  const fields: (keyof MetricPoint)[] = [
    'sampledAt',
    'cpuPercent',
    'memoryUsed',
    'memoryTotal',
    'diskUsed',
    'diskTotal',
    'networkReceivedBytes',
    'networkTransmittedBytes',
    'networkReceiveBytesPerSecond',
    'networkTransmitBytesPerSecond',
  ];
  /**
   * 中文：在从历史计数计算指标速率并绘制和导出序列流程中把二进制内容导出为下载；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Computing rates from historical counters and plotting and exporting metric series, export binary content through a download. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   */
  const csv = () =>
    saveBlob(
      'sakura-metrics.csv',
      new Blob(
        [
          fields.join(',') +
            '\r\n' +
            history.map((point) => fields.map((field) => point[field] ?? '').join(',')).join('\r\n'),
        ],
        { type: 'text/csv;charset=utf-8' },
      ),
    );
  return (
    <section className="metric-history" aria-label="历史资源指标">
      <div className="metric-history-toolbar">
      <label>
        趋势指标
        <select value={kind} onChange={(event) => setKind(event.target.value as keyof typeof series)}>
          {Object.entries(series).map(([key, item]) => (
            <option key={key} value={key}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <dl className="metric-history-summary" aria-live="polite">
        <div><dt>最近样本</dt><dd>{history.length ? latestLabel : '尚无采样'}</dd></div>
        <div><dt>当前指标有效样本</dt><dd>{validCount} / {history.length}</dd></div>
      </dl>
      </div>
      {!history.length ? <div className="metric-history-empty" role="status">
        <strong>暂无历史采样</strong><p>取得资源样本后，趋势与明细会显示在这里。</p>
      </div> : !validCount ? <div className="metric-history-empty" role="status">
        <strong>当前指标暂无有效样本</strong><p>已收到 {history.length} 次采样；缺失值保留为空，不作为零值绘制。</p>
      </div> : <figure className="metric-history-figure">
      <div className="metric-history-scale"><span>{selected.name}</span><span>上限 {selected.percent ? '100%' : rate(maximum)}</span></div>
      <svg className="cpu-history" viewBox="0 0 600 100" role="img" aria-label={selected.name + '历史趋势'} aria-describedby={chartDescriptionId}>
        <title>
          {selected.name}，纵轴上限 {selected.percent ? '100%' : rate(maximum)}
        </title>
        <path d="M0 95H600 M0 50H600 M0 5H600" stroke="var(--line)" fill="none" />
        {paths
          .filter((path) => path.length)
          .map((path, index) =>
            path.length === 1 ? (
              <circle
                key={index}
                cx={path[0].split(',')[0]}
                cy={path[0].split(',')[1]}
                r="2"
                fill="var(--accent)"
              />
            ) : (
              <polyline
                key={index}
                points={path.join(' ')}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
              />
            ),
          )}
      </svg>
      <figcaption id={chartDescriptionId}>缺失值或超过两分钟的采样间隙会断开折线。</figcaption>
      </figure>}
      {history.length > 0 && <p className="metric-history-range">
        <span>起始 <time dateTime={history[0].sampledAt}>{formatDateTime(new Date(history[0].sampledAt))}</time></span>
        <span>最新 <time dateTime={history.at(-1)!.sampledAt}>{formatDateTime(new Date(history.at(-1)!.sampledAt))}</time></span>
      </p>}
      <p className="subtle-note">
        {history.length} 次采样 · 纵轴上限 {selected.percent ? '100%' : rate(maximum)}。
        自动采样每 30 秒一次，持久保留最近 720 次。网络汇总除 lo
        外的接口；首次采样、重启或采样间断超过两分钟时速率未知。
      </p>
      <div className="feature-actions">
        <button className="secondary compact" disabled={!history.length} onClick={csv}>
          导出指标 CSV
        </button>
        <button
          className="secondary compact"
          disabled={!history.length}
          onClick={() => saveText('sakura-metrics.json', history)}
        >
          导出指标 JSON
        </button>
      </div>
      {history.length > 0 && <details>
        <summary>查看采样明细（{history.length}）</summary>
        <p className="metric-history-table-hint">最新样本在前。表格可横向滚动，聚焦后可使用方向键。</p>
        <div className="metric-history-table" role="region" aria-label="历史采样明细，可滚动" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">CPU</th>
                <th scope="col">内存使用</th>
                <th scope="col">磁盘使用</th>
                <th scope="col">接收</th>
                <th scope="col">发送</th>
              </tr>
            </thead>
            <tbody>
              {history
                .slice()
                .reverse()
                .map((point) => (
                  <tr key={point.sampledAt}>
                    <td>{formatDateTime(new Date(point.sampledAt))}</td>
                    <td>{formatDecimal(point.cpuPercent, 1)}%</td>
                    <td>{formatBytes(point.memoryUsed)}</td>
                    <td>{formatBytes(point.diskUsed)}</td>
                    <td>{rate(point.networkReceiveBytesPerSecond)}</td>
                    <td>{rate(point.networkTransmitBytesPerSecond)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>}
    </section>
  );
}
