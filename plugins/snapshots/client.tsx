import { formatDateTime } from '../../src/localization';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
import { lazy, useState } from 'react';
import type { Snapshot } from '../../server/model';
import { Feedback, download, useAction, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { PluginGate } from '../../src/plugin-context';
import { GoldenImageLibrary } from './GoldenImages';
import { RescuePanel } from './RescuePanel';
import { SnapshotDiffPanel } from './SnapshotDiffPanel';
import { SignedBundlesPanel } from './SignedBundles';
const BackupPanel = lazy(() =>
  import('../backups/client').then((module) => ({ default: module.BackupPanel })),
);

export function SnapshotsPanel(props: FeatureProps) {
  const { vm, request, refresh } = props;
  const [name, setName] = useState(''),
    [cloneName, setCloneName] = useState(vm.name.slice(0, 26) + '-copy'),
    [editing, setEditing] = useState<Snapshot | null>(null),
    [backup, setBackup] = useState(true);
  const action = useAction();
  const stopped = !vm.poweredOn;
  const running = vm.status === 'running';
  const mutate = (path: string, method: string, body?: unknown) =>
    action.run(async () => {
      await request(`/vms/${vm.id}${path}`, method, body);
      await refresh();
    }, '操作完成');
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>快照与迁移</h3>
          <p>运行中可通过客户机代理冻结文件系统并创建快照；恢复、克隆与导出仍需停止实例。</p>
        </div>
      </div>
      <Feedback error={action.error} message={action.message} />
      <div className="inline-form">
        <input
          aria-label="新快照名称"
          placeholder="快照名称"
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          className="primary compact"
          disabled={action.busy || !name.trim() || (!stopped && !running)}
          onClick={() => void mutate('/snapshots', 'POST', { name, online: running })}
        >
          <Plus size={14} />
          {running ? '创建在线快照' : '创建快照'}
        </button>
      </div>
      <label className="checkbox-label">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        恢复前自动保存当前状态（占用一个快照名额）
      </label>
      <div className="snapshot-list">
        {[...vm.snapshots].reverse().map((s) => (
          <div key={s.id}>
            <div>
              <b>{s.name}</b>
              <p>
                {formatDateTime(new Date(s.createdAt))}
                {s.consistency === 'filesystem' ? ' · 文件系统一致性' : ''}
                {s.note ? ` · ${s.note}` : ''}
              </p>
              <p className="subtle-note">快照 ID（跨主机复制使用）：<code>{s.id}</code></p>
            </div>
            <div className="feature-actions">
              <button
                className="text-button"
                disabled={action.busy || !stopped}
                onClick={() => setEditing(s)}
              >
                备注
              </button>
              <button
                className="secondary compact"
                disabled={action.busy || !stopped}
                onClick={() => {
                  if (confirm(`恢复“${s.name}”并覆盖当前磁盘状态？`))
                    void mutate(`/snapshots/${s.id}/restore`, 'POST', { backup });
                }}
              >
                恢复
              </button>
              <button
                className="text-button"
                disabled={action.busy || !stopped || !cloneName}
                onClick={() => void mutate('/clone', 'POST', { name: cloneName, snapshot: s.id })}
              >
                克隆
              </button>
              <button
                className="icon-button danger-text"
                aria-label={`删除快照 ${s.name}`}
                disabled={action.busy || !stopped}
                onClick={() => {
                  if (confirm(`删除快照“${s.name}”？`)) void mutate(`/snapshots/${s.id}`, 'DELETE');
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <SnapshotDiffPanel key={'diff-' + vm.id} {...props} />
      {editing && (
        <div className="feature-card">
          <label>
            名称
            <input
              maxLength={60}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label>
            备注
            <textarea
              maxLength={1000}
              value={editing.note || ''}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
            />
          </label>
          <div className="feature-actions">
            <button
              className="primary compact"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await request(`/vms/${vm.id}/snapshots/${editing.id}`, 'PATCH', {
                    name: editing.name,
                    note: editing.note || '',
                  });
                  setEditing((current) => (current === editing ? null : current));
                  await refresh();
                })
              }
            >
              保存备注
            </button>
            <button className="secondary compact" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </div>
      )}
      <div className="feature-card">
        <h4>复制环境与迁移</h4>
        <label>
          克隆后的实例名称
          <input
            pattern="[a-z][a-z0-9-]*"
            maxLength={32}
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
          />
        </label>
        <div className="feature-actions">
          <button
            className="secondary compact"
            disabled={!stopped || action.busy}
            onClick={() => void mutate('/clone', 'POST', { name: cloneName })}
          >
            <Copy size={14} />
            克隆当前状态
          </button>
          <button
            className="secondary compact"
            disabled={!stopped || action.busy}
            onClick={() =>
              void action.run(
                () => download(request, vm.id, { type: 'export' }),
                '导出已交给浏览器处理，准备磁盘可能需要一些时间。请在浏览器查看下载进度。',
              )
            }
          >
            <Download size={14} />
            导出实例
          </button>
        </div>
        <p className="subtle-note">
          导出包含当前磁盘和实例连接凭证，请妥善保存。快照历史不随导出迁移；克隆默认清空端口转发，首次启动更新密钥。
        </p>
      </div>
      <SignedBundlesPanel request={request} />
      <PluginGate id="backups">
        <BackupPanel {...props} />
      </PluginGate>
      <RescuePanel key={'rescue-' + vm.id} {...props} />
      <GoldenImageLibrary key={vm.id} request={request} refresh={refresh} vms={[vm]} sourceId={vm.id} />
    </div>
  );
}

export const tabs = { snapshots: SnapshotsPanel };
