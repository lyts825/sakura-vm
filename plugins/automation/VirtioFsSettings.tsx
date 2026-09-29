import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = {
  policy: { enabled: boolean; hostPath: string; readOnly: boolean };
  guestPath: string;
  stopped: boolean;
  running: boolean;
  attached: boolean;
  mounted: boolean;
  observation: { at: string; mounted: boolean; error?: string } | null;
};

export function VirtioFsSettings({ vmId, request }: { vmId: string; request: Request }) {
  const path = `/vms/${vmId}/virtio-fs`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [hostPath, setHostPath] = useState('');
  const [readOnly, setReadOnly] = useState(true);
  useEffect(() => {
    if (!remote.data) return;
    setEnabled(remote.data.policy.enabled);
    setHostPath(remote.data.policy.hostPath);
    setReadOnly(remote.data.policy.readOnly);
  }, [vmId, remote.data?.policy?.enabled, remote.data?.policy?.hostPath,
    remote.data?.policy?.readOnly]);
  const run = (payload: unknown, message: string) => void action.run(async (signal) => {
    await request(path, 'POST', payload, signal);
    remote.reload();
  }, message);
  return <div className="feature-card" role="region" aria-label="Virtio-FS 共享目录">
    <h4>Virtio-FS 共享目录</h4>
    <p className="subtle-note">在支持的 Linux x86_64 宿主上，将目录直挂到客户机 {remote.data?.guestPath || '/mnt/sakura-virtiofs'}。先停止实例保存策略，启动后自动挂载；默认只读。</p>
    <Feedback error={remote.error || action.error || remote.data?.observation?.error}
      message={action.message} />
    <label className="checkbox-label">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      启用 Virtio-FS
    </label>
    <div className="inline-form">
      <label>Linux 宿主目录绝对路径
        <input value={hostPath} onChange={(event) => setHostPath(event.target.value)}
          placeholder="/home/me/projects" />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)} />
        只读挂载
      </label>
      <button className="secondary compact"
        disabled={action.busy || !remote.data?.stopped || enabled && !hostPath.trim()}
        onClick={() => run({ operation: 'configure',
          policy: { enabled, hostPath: hostPath.trim(), readOnly } }, 'Virtio-FS 策略已保存；下次启动时生效。')}>
        保存策略
      </button>
      <button className="secondary compact"
        disabled={action.busy || !remote.data?.running || !remote.data.attached || remote.data.mounted}
        onClick={() => run({ operation: 'mount' }, 'Virtio-FS 已挂载。')}>立即挂载</button>
      <button className="secondary compact" disabled={action.busy || !remote.data?.mounted}
        onClick={() => run({ operation: 'unmount' }, 'Virtio-FS 已卸载并停用。')}>
        卸载并停用
      </button>
    </div>
    <p role="status">{remote.data?.mounted ? '已挂载' : remote.data?.attached ?
      '设备已附加，等待挂载' : remote.data?.policy?.enabled ? '等待下次启动' : '未启用'} ·
      {remote.data?.policy?.readOnly ? '只读' : '可写'}</p>
  </div>;
}
