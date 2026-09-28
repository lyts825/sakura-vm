import { formatDecimal } from '../../src/localization';
import { formatDateTime } from '../../src/localization';
import { useState } from 'react';
import type { VMView } from '../../server/model';
import type { GoldenImages } from '../../server/golden-images';
import type { GoldenAction, GoldenResult } from '../../shared/golden-images';
import { Feedback, JobLog, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = Awaited<ReturnType<GoldenImages['view']>>;
export function GoldenImageLibrary({
  request,
  refresh,
  vms,
  sourceId = '',
}: {
  request: Request;
  refresh: () => Promise<unknown>;
  vms: VMView[];
  sourceId?: string;
}) {
  const remote = useRemote<View>(request, '/golden-images', true, 2500);
  const action = useAction();
  const cancellation = useAction();
  const [vmId, setVmId] = useState(sourceId),
    [name, setName] = useState(''),
    [note, setNote] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [instanceName, setInstanceName] = useState('from-golden');
  const source = vms.find((vm) => vm.id === vmId);
  const busy = action.busy || remote.data?.job?.status === 'running';
  const run = (input: GoldenAction, message: string) =>
    action.run(async (signal) => {
      await request<GoldenResult>('/golden-images', 'POST', input, signal);
      remote.reload();
      await refresh();
      if (input.action === 'create') setReviewed(false);
    }, message);
  return (
    <section className="feature-card golden-images" aria-label="黄金镜像库">
      <h3>黄金镜像库</h3>
      <p>将已准备好的停止实例保存为模板；以后可重复创建独立实例，源实例删除后模板仍可使用。</p>
      <p className="subtle-note">
        保留磁盘内的账户、文件和凭据，请先在源实例中清理不应复制的内容。新实例清空端口转发，首次启动更新
        Sakura 控制密钥；不自动清理其他账户密钥。
      </p>
      <Feedback
        error={action.error || cancellation.error || remote.error || remote.data?.persistenceError}
        message={action.message}
      />
      <fieldset disabled={busy}>
        <legend>制作黄金镜像</legend>
        <label>
          源实例
          <select
            aria-label="黄金镜像源实例"
            value={vmId}
            onChange={(event) => {
              setVmId(event.target.value);
              setReviewed(false);
            }}
          >
            <option value="">选择停止的实例</option>
            {vms
              .filter((vm) => !vm.sandbox)
              .map((vm) => (
                <option key={vm.id} value={vm.id} disabled={vm.poweredOn}>
                  {vm.name}
                  {vm.poweredOn ? '（请先停止）' : ''}
                </option>
              ))}
          </select>
        </label>
        <label>
          模板名称
          <input maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          模板备注
          <textarea maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
          已检查源实例内容，确认可复制为模板
        </label>
        <button
          className="primary compact"
          disabled={!source || source.poweredOn || !name.trim() || !reviewed}
          onClick={() =>
            void run({ action: 'create', vmId, name, note, sourceReviewed: true }, '黄金镜像已保存')
          }
        >
          保存黄金镜像
        </button>
      </fieldset>
      <button className="secondary compact" onClick={remote.reload}>
        刷新黄金镜像库
      </button>
      <p>
        {remote.data?.templates.length || 0} / 16 个模板 ·{' '}
        {formatDecimal(((remote.data?.templates.reduce((sum, row) => sum + row.bytes, 0) || 0) / 1024 ** 3), 2)} /
        128 GiB
      </p>
      <label>
        从模板创建的实例名称
        <input
          maxLength={32}
          pattern="[a-z][a-z0-9-]*"
          value={instanceName}
          disabled={busy}
          onChange={(event) => setInstanceName(event.target.value)}
        />
      </label>
      {remote.data?.templates.length === 0 && <p>尚未保存黄金镜像。</p>}
      <ul className="golden-image-list">
        {remote.data?.templates.map((entry) => (
          <li key={entry.id}>
            <h4>{entry.name}</h4>
            <p>{entry.note}</p>
            <p>
              {entry.distro} · {entry.sourceName} · {formatDateTime(new Date(entry.createdAt))} · 虚拟磁盘{' '}
              {entry.diskGiB} GiB · 模板 {formatDecimal((entry.bytes / 1024 ** 2), 1)} MiB
            </p>
            <p className="subtle-note">
              SHA-256：<code>{entry.sha256}</code>
            </p>
            <div className="feature-actions">
              <button
                className="primary compact"
                disabled={busy || !/^[a-z][a-z0-9-]{0,31}$/.test(instanceName)}
                onClick={() =>
                  void run(
                    { action: 'instantiate', id: entry.id, name: instanceName },
                    `实例 ${instanceName} 已创建，可在工作空间启动`,
                  )
                }
              >
                从 {entry.name} 创建实例
              </button>
              <button
                className="secondary compact"
                disabled={busy}
                onClick={() => void run({ action: 'verify', id: entry.id }, '模板 SHA-256 校验通过')}
              >
                校验 {entry.name}
              </button>
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => {
                  if (confirm(`删除黄金镜像“${entry.name}”？已创建的实例不受影响。`))
                    void run({ action: 'delete', id: entry.id }, '黄金镜像已删除');
                }}
              >
                删除模板 {entry.name}
              </button>
            </div>
          </li>
        ))}
        {remote.data?.issues.map((issue) => (
          <li key={issue.id}>
            <p role="alert">
              {issue.error} <code>{issue.id}</code>
            </p>
            <button
              className="text-button danger-text"
              disabled={busy}
              onClick={() => {
                if (confirm(`移除未完成或损坏的模板 ${issue.id}？请先保留需要检查的本机文件。`))
                  void run({ action: 'delete', id: issue.id }, '模板目录已移除');
              }}
            >
              移除未完成模板 {issue.id}
            </button>
          </li>
        ))}
      </ul>
      <JobLog job={remote.data?.job} />
      {remote.data?.job?.status === 'running' && remote.data.job.id && (
        <button
          className="secondary compact"
          disabled={cancellation.busy}
          onClick={() =>
            void cancellation.run(async () => {
              await request(`/jobs/${remote.data!.job!.id}/cancel`, 'POST');
              remote.reload();
            })
          }
        >
          取消镜像操作
        </button>
      )}
      <p className="subtle-note">
        制作需要实例保持停止，并预留两倍虚拟磁盘容量及 64 MiB
        临时空间。断开页面会请求取消；操作中断后请刷新核对结果，不自动重试。模板是完整独立副本，保存在 Sakura
        数据目录。
      </p>
    </section>
  );
}
