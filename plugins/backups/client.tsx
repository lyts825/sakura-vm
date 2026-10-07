/**
 * 模块职责（中文）：“备份策略”插件的备份保留策略、加密设置、执行记录与文件恢复入口，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for backup policy, retention and file recovery.
 * 详细范围（中文）：公开入口包括 BackupPanel；职责覆盖备份策略、保留与文件恢复的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include BackupPanel. The scope covers UI interaction and state presentation for backup policy, retention and file recovery. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { formatDateTime } from '../../src/localization';
import { useEffect, useState } from 'react';
import type { BackupPolicy, BackupView } from './view-types';
import type { FeatureProps } from '../../src/feature-shared';
import { Feedback, formatBytes, JobLog, useAction, useRemote } from '../../src/feature-shared';
import '../../src/features.css';
import { FileRecovery } from './FileRecovery';

/**
 * 中文：呈现备份策略、保留与文件恢复的界面交互与状态呈现中的 BackupPanel 界面，订阅 /vms/{vm.id}/backups，组合 FileRecovery，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the BackupPanel surface for UI interaction and state presentation for backup policy, retention and file recovery, subscribing to /vms/{vm.id}/backups and composing FileRecovery. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ vm, request, refresh } 提供 vm（vm 状态）、request（带身份和权限作用域的传输能力）、refresh（refresh 状态） 上下文字段
 * English: Inputs: { vm, request, refresh } provides context fields vm (vm state), request (transport capability bound to identity/authority scope), refresh (refresh state)
 */
export function BackupPanel({ vm, request, refresh }: FeatureProps) {
  const remote = useRemote<BackupView>(request, `/vms/${vm.id}/backups`, true, 2500);
  const [policy, setPolicy] = useState<BackupPolicy | null>(null),
    action = useAction();
  const [password, setPassword] = useState('');
  useEffect(/** 中文：当依赖 [policy, remote.data] 变化时策略草稿；effect 返回的清理只结束旧依赖这一轮所持资源，随后新依赖重新建立 | English: When dependencies [policy, remote.data] change, policy draft. Returned cleanup ends only the resources owned by the old dependency pass before the next establishes new ownership | 中文：结果：通过上述状态或资源副作用交付，不返回业务数据 | English: Result: deliver through the described state/resource effects without returning business data */ () => {
    if (!policy && remote.data) setPolicy(remote.data.policy);
  }, [policy, remote.data]);
  /**
   * 中文：提交 POST /vms/{vm.id}/backups，完成备份策略、保留与文件恢复的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST /vms/{vm.id}/backups for UI interaction and state presentation for backup policy, retention and file recovery. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：kind：签名所示 string 业务值；backupId：签名所示 string 业务值；name：目标名称或文件名
   * English: Inputs: kind: the string domain value in the signature; backupId: the string domain value in the signature; name: target name/filename
   */
  const run = (kind: string, backupId?: string, name?: string) =>
    action.run(/** 中文：提交 POST /vms/{vm.id}/backups，完成备份策略、保留与文件恢复的界面交互与状态呈现的数据交互并更新password 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/backups for UI interaction and state presentation for backup policy, retention and file recovery and update password state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
      await request(`/vms/${vm.id}/backups`, 'POST', {
        action: kind,
        backupId,
        name,
        password: password || undefined,
      });
      setPassword('');
      remote.reload();
      await refresh();
    });
  const busy = action.busy || remote.data?.job?.status === 'running';
  return (
    <div className="feature-card">
      <h3>备份与加密导出</h3>
      <p className="subtle-note">按周期生成独立备份包。实例运行时延后到关机；恢复会创建新实例。</p>
      {policy && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })}
            />
            启用自动备份
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!policy.deduplicate}
              onChange={(event) => setPolicy({ ...policy, deduplicate: event.target.checked })}
            />
            本机备份使用全局内容块去重
          </label>
          <p className="subtle-note">
            适用于未加密、本机目录的备份。下载时重组为独立实例包；共享块保留到最后一个引用删除。加密或外部目录备份需先关闭此项。
          </p>
          <div className="feature-grid">
            <label>
              间隔（小时）
              <input
                type="number"
                min={1}
                max={720}
                value={policy.intervalHours}
                onChange={(e) => setPolicy({ ...policy, intervalHours: +e.target.value })}
              />
            </label>
            <label>
              最多保留份数
              <input
                type="number"
                min={1}
                max={30}
                value={policy.keep}
                onChange={(e) => setPolicy({ ...policy, keep: +e.target.value })}
              />
            </label>
            <label>
              总容量上限（GiB）
              <input
                type="number"
                min={1}
                max={512}
                value={policy.maxGiB}
                onChange={(e) => setPolicy({ ...policy, maxGiB: +e.target.value })}
              />
            </label>
            <label>
              外部备份目录（可选）
              <input
                value={policy.directory || ''}
                onChange={(e) => setPolicy({ ...policy, directory: e.target.value || undefined })}
                placeholder="E:\SakuraBackups"
              />
            </label>
            <label>
              新备份保留锁（天，0 表示不锁定）
              <input
                type="number"
                min={0}
                max={3650}
                value={policy.lockDays || 0}
                onChange={(event) => setPolicy({ ...policy, lockDays: +event.target.value })}
              />
            </label>
            <label>
              备份输出限速（MiB/s，0 表示不限）
              <input
                type="number"
                min={0}
                max={10240}
                step={0.1}
                value={policy.bandwidthMiBps || 0}
                onChange={(event) => setPolicy({ ...policy, bandwidthMiBps: +event.target.value })}
              />
            </label>
            <label>
              自动加密密码引用（可选）
              <input
                value={policy.passwordSecret || ''}
                onChange={(e) => setPolicy({ ...policy, passwordSecret: e.target.value || undefined })}
                placeholder="backup-password"
              />
            </label>
          </div>
          <p className="subtle-note">
            加密密码引用来自“开发 → 私密配置”，至少 10 个字符。保留锁仅影响新备份，到期前禁止通过 Sakura
            删除或自动清理；修改策略不会缩短已有锁定期。
          </p>
          <label>
            本次加密 / 解密密码（可选）
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              maxLength={1024}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="留空时使用备份的密码引用"
            />
          </label>
          <div className="feature-actions">
            <button
              className="secondary compact"
              disabled={busy}
              onClick={() =>
                void action.run(/** 中文：提交 PUT /vms/{vm.id}/backups，完成备份策略、保留与文件恢复的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PUT /vms/{vm.id}/backups for UI interaction and state presentation for backup policy, retention and file recovery. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
                  await request(`/vms/${vm.id}/backups`, 'PUT', policy);
                  remote.reload();
                }, '备份策略已保存')
              }
            >
              保存策略
            </button>
            <button
              className="primary compact"
              disabled={busy || vm.poweredOn}
              onClick={() => void run('run')}
            >
              立即备份
            </button>
          </div>
        </>
      )}
      {remote.data?.waitingForShutdown && <p className="subtle-note">计划备份将在实例停止后检查并执行。</p>}
      {remote.data?.maintenance && <p className="subtle-note">当前处于维护窗口，暂停启动自动备份。</p>}
      <p>已用 {formatBytes(remote.data?.bytes || 0)}</p>
      {remote.data?.items.map((item) => (
        <div className="backup-row" key={item.id}>
          <div>
            <b>{formatDateTime(new Date(item.createdAt))}</b>
            <p className="subtle-note">
              {item.encrypted ? '已加密 · ' : ''}
              {item.storage === 'blocks' ? '内容块去重 · ' : ''}
              {formatBytes(item.bytes)} · {item.error || (item.verifiedAt ? '已通过校验' : '待校验')}
            </p>
            {item.directory && <p className="subtle-note wrap-path">{item.directory}</p>}
            {item.retainUntil && (
              <p className="subtle-note">保留锁到期：{formatDateTime(new Date(item.retainUntil))}</p>
            )}
          </div>
          <div className="feature-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void action.run(/** 中文：提交 POST /vms/{vm.id}/backup-download，完成备份策略、保留与文件恢复的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST /vms/{vm.id}/backup-download for UI interaction and state presentation for backup policy, retention and file recovery. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：拒绝原因：无效的下载地址。这些错误交给直接调用者或本函数 catch 处理 | English: Refusal reasons: 无效的下载地址. These errors reach the direct caller or this function's catch handler */ async (signal) => {
                  const { url } = await request<{ url: string }>(
                    `/vms/${vm.id}/backup-download`,
                    'POST',
                    { backupId: item.id },
                    signal,
                  );
                  if (!/^\/api\/downloads\/[a-f0-9]{64}$/.test(url)) throw new Error('无效的下载地址');
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = '';
                  link.referrerPolicy = 'no-referrer';
                  document.body.append(link);
                  link.click();
                  link.remove();
                }, '下载已开始')
              }
            >
              下载
            </button>
            <button className="text-button" disabled={busy} onClick={() => void run('verify', item.id)}>
              校验
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                const name = prompt('恢复为新实例，输入名称', `${vm.name.slice(0, 23)}-restore`);
                if (name) void run('restore', item.id, name);
              }}
            >
              恢复
            </button>
            <button
              className="text-button danger-text"
              disabled={busy || (!!item.retainUntil && Date.parse(item.retainUntil) > Date.now())}
              onClick={() => {
                if (confirm('删除这份备份？')) void run('delete', item.id);
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
      <Feedback error={action.error || remote.error} message={action.message} />
      <JobLog job={remote.data?.job} />
      <FileRecovery key={vm.id} vm={vm} request={request} refresh={refresh} items={remote.data?.items || []} />
    </div>
  );
}
