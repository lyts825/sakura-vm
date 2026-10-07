/**
 * 模块职责（中文）：“磁盘快照”插件的快照创建/恢复、克隆及差异/合并/救援/备份入口，使用宿主传入的实例、项目和请求上下文。
 * Module responsibility (English): UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles.
 * 详细范围（中文）：公开入口包括 SnapshotsPanel, tabs；职责覆盖快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SnapshotsPanel, tabs. The scope covers UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { embeddedPluginComponent } from '../../src/plugin-client';
import { formatDateTime } from '../../src/localization';
import { Copy, Download, Plus, Trash2 } from 'lucide-react';
import { Suspense, useState } from 'react';
import type { Snapshot } from '../../shared/contracts/vm.ts';
import { Feedback, download, useAction, type FeatureProps } from '../../src/feature-shared';
import '../../src/features.css';
import { PluginGate } from '../../src/plugin-context';
import { PluginBoundary } from '../../src/plugin-boundary';
import { GoldenImageLibrary } from './GoldenImages';
import { RescuePanel } from './RescuePanel';
import { SnapshotDiffPanel } from './SnapshotDiffPanel';
import { SnapshotMergePanel } from './SnapshotMergePanel';
import { SignedBundlesPanel } from './SignedBundles';
/**
 * 中文：懒加载 ../backups/client 并将指定导出适配为默认 React 组件，延后下载该功能界面所需代码
 * English: Lazily load ../backups/client and adapt its selected export as the default React component, deferring this feature's UI code download
 */
const loadBackupPanel = () =>
  import('../backups/client').then((module) => ({ default: module.BackupPanel }));

/**
 * 中文：呈现快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现中的 SnapshotsPanel 界面，组合 Plus、SnapshotDiffPanel、SnapshotMergePanel、Copy、Download、SignedBundlesPanel、RescuePanel、GoldenImageLibrary，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the SnapshotsPanel surface for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles and composing Plus, SnapshotDiffPanel, SnapshotMergePanel, Copy, Download, SignedBundlesPanel, RescuePanel, GoldenImageLibrary. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：props：签名所示 FeatureProps 业务值
 * English: Inputs: props: the FeatureProps domain value in the signature
 */
export function SnapshotsPanel(props: FeatureProps) {
  const { vm, request, refresh } = props;
  const [name, setName] = useState(''),
    [cloneName, setCloneName] = useState(vm.name.slice(0, 26) + '-copy'),
    [editing, setEditing] = useState<Snapshot | null>(null),
    [includeMemory, setIncludeMemory] = useState(false),
    [backup, setBackup] = useState(true);
  const action = useAction();
  const stopped = !vm.poweredOn;
  const running = vm.status === 'running';
  const memorySupported = running && vm.activeAccelerator === 'tcg' &&
    vm.sandbox?.storage !== 'discard-on-stop' && !vm.diskEncryption &&
    vm.firmware !== 'uefi';
  /**
   * 中文：提交 method /vms/{vm.id}{path}，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform method /vms/{vm.id}{path} for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：path：目标文件或请求路径；method：请求 HTTP 方法；body：待按操作契约编码的请求正文
   * English: Inputs: path: target file/request path; method: request HTTP method; body: request body to encode under the operation contract
   */
  const mutate = (path: string, method: string, body?: unknown) =>
    action.run(/** 中文：提交 method /vms/{vm.id}{path}，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform method /vms/{vm.id}{path} for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async () => {
      await request(`/vms/${vm.id}${path}`, method, body);
      await refresh();
    }, '操作完成');
  return (
    <div className="content-panel feature-panel">
      <div className="panel-heading">
        <div>
          <h3>快照与迁移</h3>
          <p>运行中可冻结文件系统创建磁盘快照，或保存包含 RAM 与进程的整机状态；磁盘恢复、克隆与导出需停止实例，整机状态恢复需先启动实例。</p>
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
          disabled={action.busy || !name.trim() || (!stopped && !running) ||
            (running && includeMemory && !memorySupported)}
          onClick={() => void mutate('/snapshots', 'POST', { name, online: running,
            ...(running && includeMemory ? { memory: true } : {}) })}
        >
          <Plus size={14} />
          {running && includeMemory ? '保存整机状态' : running ? '创建在线快照' : '创建快照'}
        </button>
      </div>
      {running && <label className="checkbox-label">
        <input type="checkbox" checked={includeMemory} disabled={!memorySupported}
          onChange={(event) => setIncludeMemory(event.target.checked)} />
        包含 RAM 与运行中进程（可能短暂暂停客户机）
      </label>}
      {running && !memorySupported && <p className="subtle-note">
        整机状态快照需要 TCG、持久明文磁盘与 BIOS；WHPX 实例请停机后切换加速器。
      </p>}
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
                {s.consistency === 'filesystem' ? ' · 文件系统一致性' :
                  s.consistency === 'vmstate' ? ' · 整机状态（RAM 与进程）' : ''}
                {s.note ? ` · ${s.note}` : ''}
              </p>
              <p className="subtle-note">
                {s.consistency === 'vmstate' ? '快照 ID（跨主机复制仅包含磁盘）：' :
                  '快照 ID（跨主机复制使用）：'}<code>{s.id}</code>
              </p>
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
                disabled={action.busy || (s.consistency === 'vmstate' ? !memorySupported : !stopped)}
                onClick={() => {
                  if (confirm(s.consistency === 'vmstate'
                    ? `恢复“${s.name}”的 RAM、进程和磁盘状态？当前运行状态将被覆盖。`
                    : `恢复“${s.name}”并覆盖当前磁盘状态？`))
                    void mutate(`/snapshots/${s.id}/restore`, 'POST', {
                      backup, memory: s.consistency === 'vmstate' });
                }}
              >
                {s.consistency === 'vmstate' ? '恢复整机状态' : '恢复'}
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
      <SnapshotMergePanel key={'merge-' + vm.id} {...props} />
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
                void action.run(/** 中文：提交 PATCH /vms/{vm.id}/snapshots/{editing.id}，完成快照、克隆、救援、黄金镜像和签名包的界面交互与状态呈现的数据交互并更新editing 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform PATCH /vms/{vm.id}/snapshots/{editing.id} for UI interaction and state presentation for snapshots, clones, rescue, golden images and signed bundles and update editing state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting | 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态 | English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state */ async () => {
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
        <PluginBoundary identity="official:backups" request={request} label="备份策略">
          {(scopedRequest, lifetime) => {
            const BackupPanel = embeddedPluginComponent('backups', 'backup-panel', lifetime, loadBackupPanel);
            return <Suspense fallback={<p role="status">正在加载备份策略…</p>}>
              <BackupPanel {...props} request={scopedRequest} />
            </Suspense>;
          }}
        </PluginBoundary>
      </PluginGate>
      <RescuePanel key={'rescue-' + vm.id} {...props} />
      <GoldenImageLibrary key={vm.id} request={request} refresh={refresh} vms={[vm]} sourceId={vm.id} />
    </div>
  );
}

export const tabs = { snapshots: SnapshotsPanel };
