import { useEffect, useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from '../../src/feature-shared';

type View = { policy: { enabled: boolean }; stopped: boolean; attached: boolean };
type Check = { ready: boolean; reason: string | null;
  guest: { efi: boolean; secureBootEnabled: boolean | null;
    setupMode: boolean | null; tpmDevicePresent: boolean } | null };

export function TrustedBootSettings({ vmId, request }: { vmId: string; request: Request }) {
  const path = `/vms/${vmId}/trusted-boot`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [enabled, setEnabled] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  useEffect(() => {
    setEnabled(remote.data?.policy?.enabled || false);
    setCheck(null);
  }, [vmId, remote.data?.policy?.enabled]);
  const configure = () => void action.run(async (signal) => {
    await request(path, 'POST', { operation: 'configure', policy: { enabled } }, signal);
    remote.reload();
  }, 'TPM 与安全启动策略已保存；下次启动时生效。');
  const inspect = () => void action.run(async (signal) => {
    setCheck(await request<Check>(path, 'POST', { operation: 'check' }, signal));
  });
  return <div className="feature-card" role="region" aria-label="TPM 与安全启动">
    <h4>TPM 与安全启动</h4>
    <p className="subtle-note">Linux x86_64 宿主上的 Debian 或 Ubuntu UEFI 实例可使用持久 vTPM 与预登记密钥的 OVMF 固件。停止实例后保存策略，重启并检查实际状态。当前磁盘备份与导出不包含 TPM 状态或安全启动 NVRAM。</p>
    <Feedback error={remote.error || action.error} message={action.message} />
    <label className="checkbox-label">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      启用 TPM 与安全启动
    </label>
    <div className="feature-actions">
      <button className="secondary compact" disabled={action.busy || !remote.data?.stopped}
        onClick={configure}>保存策略</button>
      <button className="secondary compact" disabled={action.busy || !remote.data?.attached}
        onClick={inspect}>检查客户机状态</button>
    </div>
    <p role="status">{remote.data?.attached ? 'vTPM 已附加' :
      remote.data?.policy?.enabled ? '等待下次启动' : '未启用'}</p>
    {check && <p role="status">{check.ready ? '客户机已启用安全启动并识别 TPM' :
      check.reason || '尚未确认安全启动与 TPM'}</p>}
  </div>;
}
