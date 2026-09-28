import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = {
  policy: { enabled: boolean; hostPath: string; readOnly: boolean };
  guestPath: string;
  running: boolean;
  mounted: boolean;
  observation: { at: string; mounted: boolean; error?: string } | null;
};

export function HostMountSettings({ vmId, request }: { vmId: string; request: Request }) {
  const path = `/vms/${vmId}/host-mount`;
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
  return <div className="feature-card" role="region" aria-label="宿主目录挂载">
    <h4>宿主目录挂载</h4>
    <p className="subtle-note">把选定的 Windows 目录挂载到客户机 {remote.data?.guestPath || '/mnt/sakura-host'}。默认只读；启用后在实例启动时自动挂载。客户机首次使用需要安装 SSHFS 和 FUSE。</p>
    <Feedback error={remote.error || action.error || remote.data?.observation?.error}
      message={action.message} />
    <label className="checkbox-label">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      启用宿主目录挂载
    </label>
    <div className="inline-form">
      <label>Windows 目录绝对路径
        <input value={hostPath} onChange={(event) => setHostPath(event.target.value)}
          placeholder="C:\\Users\\me\\Projects" />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={readOnly}
          onChange={(event) => setReadOnly(event.target.checked)} />
        只读挂载
      </label>
      <button className="secondary compact" disabled={action.busy || enabled && !hostPath.trim()}
        onClick={() => run({ operation: 'configure',
          policy: { enabled, hostPath: hostPath.trim(), readOnly } }, '宿主目录挂载策略已保存。')}>
        保存挂载策略
      </button>
      <button className="secondary compact"
        disabled={action.busy || !remote.data?.running || !remote.data?.policy?.enabled || remote.data?.mounted}
        onClick={() => run({ operation: 'mount' }, '宿主目录已挂载。')}>立即挂载</button>
      <button className="secondary compact" disabled={action.busy || !remote.data?.mounted}
        onClick={() => run({ operation: 'unmount' }, '宿主目录已卸载并停用。')}>
        卸载并停用
      </button>
    </div>
    <p role="status">{remote.data?.mounted ? '已挂载' :
      remote.data?.policy?.enabled ? '等待实例运行或挂载重试' : '未启用'} ·
      {remote.data?.policy?.readOnly ? '只读' : '可写'}</p>
  </div>;
}
